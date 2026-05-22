from __future__ import annotations

import asyncio
import collections
import json
import logging
import os
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from time import monotonic
from typing import Any

import asyncpg
from aiohttp import web
from dotenv import load_dotenv
from prometheus_client import Counter, Gauge, Histogram, start_http_server
from redis import asyncio as redis_async

from api_client import DistributionApiClient
from api_client import CircuitOpenError
from content_generator import ContentGenerator
from device_manager import DeviceManager, EmulatorDevice, is_valid_emulator_serial
from instagram_bot import InstagramBot
from proxy_bridge_manager import ProxyBridgeManager, UpstreamProxy


load_dotenv()


def _emulator_lock_is_busy(lock: asyncio.Lock) -> bool:
    """Return True if the per-emulator lock is already held.

    asyncio.Lock.locked() exists only on Python 3.12+; the container image uses 3.11.
    """
    locked_fn = getattr(lock, "locked", None)
    if callable(locked_fn):
        return bool(locked_fn())
    try:
        acquired = lock.acquire(blocking=False)
    except RuntimeError:
        return True
    if acquired:
        lock.release()
        return False
    return True


def _setup_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    log_dir = os.getenv("LOG_DIR", "/app/logs")
    os.makedirs(log_dir, exist_ok=True)

    class JsonFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
            }
            for key in ("device_id", "account_id", "action", "status", "duration"):
                if hasattr(record, key):
                    payload[key] = getattr(record, key)
            return json.dumps(payload, ensure_ascii=True)

    formatter = JsonFormatter()
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    root.addHandler(stream)

    file_handler = logging.FileHandler(os.path.join(log_dir, "emulator-controller.log"))
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)


logger = logging.getLogger("emulator-controller")


@dataclass
class Settings:
    distribution_base_url: str
    distribution_auth_username: str
    distribution_auth_password: str
    request_timeout_seconds: int
    poll_interval_seconds: int
    idle_poll_interval_seconds: int
    database_url: str
    redis_url: str
    anthropic_api_key: str
    claude_model: str
    appium_server_url: str
    android_app_package: str
    android_app_activity: str
    max_parallel_emulators: int
    min_human_delay_seconds: float
    max_human_delay_seconds: float
    metrics_port: int
    screenshot_server_port: int
    screenshot_dir: str
    screenshot_only_if_missing_ai: bool
    proxy_bridge_listen_host: str
    proxy_bridge_public_host: str
    proxy_bridge_port_start: int
    proxy_bridge_port_end: int

    @staticmethod
    def from_env() -> "Settings":
        return Settings(
            distribution_base_url=os.getenv("DISTRIBUTION_ENGINE_BASE_URL", "http://distribution-engine:3001"),
            distribution_auth_username=os.getenv("DISTRIBUTION_API_USERNAME", ""),
            distribution_auth_password=os.getenv("DISTRIBUTION_API_PASSWORD", ""),
            request_timeout_seconds=int(os.getenv("REQUEST_TIMEOUT_SECONDS", "15")),
            poll_interval_seconds=int(os.getenv("POLL_INTERVAL_SECONDS", "30")),
            idle_poll_interval_seconds=int(os.getenv("IDLE_POLL_INTERVAL_SECONDS", "300")),
            database_url=os.getenv("DATABASE_URL", ""),
            redis_url=os.getenv("REDIS_URL", "redis://redis:6379"),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            claude_model=os.getenv("CLAUDE_MODEL", "claude-3-5-sonnet-20241022"),
            appium_server_url=os.getenv("APPIUM_SERVER_URL", "http://host.docker.internal:4723"),
            android_app_package=os.getenv("ANDROID_APP_PACKAGE", "com.instagram.android"),
            android_app_activity=os.getenv(
                "ANDROID_APP_ACTIVITY", "com.instagram.mainactivity.LauncherActivity"
            ),
            max_parallel_emulators=int(os.getenv("MAX_PARALLEL_EMULATORS", "5")),
            min_human_delay_seconds=float(os.getenv("MIN_HUMAN_DELAY_SECONDS", "1.2")),
            max_human_delay_seconds=float(os.getenv("MAX_HUMAN_DELAY_SECONDS", "4.5")),
            metrics_port=int(os.getenv("METRICS_PORT", "9101")),
            screenshot_server_port=int(os.getenv("SCREENSHOT_SERVER_PORT", "9102")),
            screenshot_dir=os.getenv("LOG_DIR", "/app/logs"),
            screenshot_only_if_missing_ai=os.getenv("SCREENSHOT_ONLY_IF_MISSING_AI", "true").lower() == "true",
            proxy_bridge_listen_host=os.getenv("PROXY_BRIDGE_LISTEN_HOST", "0.0.0.0"),
            proxy_bridge_public_host=os.getenv("PROXY_BRIDGE_PUBLIC_HOST", "10.0.2.2"),
            proxy_bridge_port_start=int(os.getenv("PROXY_BRIDGE_PORT_START", "19100")),
            proxy_bridge_port_end=int(os.getenv("PROXY_BRIDGE_PORT_END", "19199")),
        )


class ActionLogger:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def log_action(
        self,
        *,
        account_id: str,
        action_type: str,
        success: bool,
        target_username: str | None = None,
        target_id: str | None = None,
        error_message: str | None = None,
    ) -> None:
        query = """
            INSERT INTO account_actions (
                account_id, action_type, target_id, target_username, success, error_message
            ) VALUES ($1, $2, $3, $4, $5, $6)
        """
        async with self.pool.acquire() as conn:
            await conn.execute(
                query,
                account_id,
                action_type,
                target_id,
                target_username,
                success,
                error_message,
            )


class EmulatorOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.device_manager = DeviceManager()
        self.api_client = DistributionApiClient(
            base_url=settings.distribution_base_url,
            timeout_seconds=settings.request_timeout_seconds,
            auth_username=settings.distribution_auth_username,
            auth_password=settings.distribution_auth_password,
            database_url=settings.database_url,
        )
        self.content_generator = ContentGenerator(
            api_key=settings.anthropic_api_key,
            model=settings.claude_model,
        )
        self.db_pool: asyncpg.Pool | None = None
        self.redis: redis_async.Redis | None = None
        self.action_logger: ActionLogger | None = None
        self.stop_event = asyncio.Event()
        self.screenshot_runner: web.AppRunner | None = None
        self.emulator_locks: dict[str, asyncio.Lock] = {}
        self.action_timestamps: dict[str, collections.deque[float]] = {}
        self.proxy_locks: dict[str, asyncio.Lock] = {}
        self.proxy_last_reconfigure_at: dict[str, float] = {}
        self.proxy_bridge_manager = ProxyBridgeManager(
            listen_host=settings.proxy_bridge_listen_host,
            public_host=settings.proxy_bridge_public_host,
            bridge_port_start=settings.proxy_bridge_port_start,
            bridge_port_end=settings.proxy_bridge_port_end,
        )

        self.actions_total = Counter(
            "actions_total",
            "Total emulator actions",
            ["account_id", "action_type", "status"],
        )
        self.emulator_active = Gauge(
            "emulator_active",
            "Active emulator workers",
            ["device_id"],
        )
        self.api_request_duration = Histogram(
            "api_request_duration",
            "Distribution API request duration seconds",
            ["endpoint"],
        )
        self.proxy_bridge_events = Counter(
            "proxy_bridge_events_total",
            "Proxy bridge operations",
            ["status", "operation"],
        )

    async def start(self) -> None:
        start_http_server(self.settings.metrics_port)
        await self._start_screenshot_server()

        if not self.settings.anthropic_api_key and self.settings.screenshot_only_if_missing_ai:
            logger.warning("ANTHROPIC_API_KEY missing, running in screenshot-only mode.")
            while not self.stop_event.is_set():
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=60)
                except asyncio.TimeoutError:
                    pass
            return

        if not self.settings.distribution_auth_username or not self.settings.distribution_auth_password:
            raise RuntimeError("DISTRIBUTION_API_USERNAME and DISTRIBUTION_API_PASSWORD are required.")
        if not self.settings.database_url:
            raise RuntimeError("DATABASE_URL is required.")
        if not self.settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is required.")

        self.db_pool = await asyncpg.create_pool(dsn=self.settings.database_url, min_size=1, max_size=10)
        self.redis = redis_async.from_url(self.settings.redis_url, decode_responses=True)
        self.action_logger = ActionLogger(self.db_pool)
        await self.api_client.startup()
        await self._startup_health_check()
        await self._reconcile_proxy_bindings()
        logger.info("Emulator orchestrator started.")

        while not self.stop_event.is_set():
            sleep_seconds = await self.run_once()
            try:
                await asyncio.wait_for(self.stop_event.wait(), timeout=sleep_seconds)
            except asyncio.TimeoutError:
                pass

    async def shutdown(self) -> None:
        if self.screenshot_runner is not None:
            await self.screenshot_runner.cleanup()
        await self.proxy_bridge_manager.close()
        await self.api_client.close()
        if self.redis is not None:
            await self.redis.aclose()
        if self.db_pool is not None:
            await self.db_pool.close()

    async def run_once(self) -> int:
        if self.api_client.is_circuit_open():
            logger.warning("Circuit breaker open, pausing workers")
            return self.settings.idle_poll_interval_seconds

        accounts_start = time.perf_counter()
        accounts, campaigns, devices = await asyncio.gather(
            self._timed_api(self.api_client.get_accounts, "/accounts"),
            self._timed_api(self.api_client.get_campaigns, "/campaigns"),
            self.device_manager.list_connected_emulators(),
            return_exceptions=False,
        )
        cycle_errors = 0

        if not devices:
            logger.warning("No connected emulators found.")
            return self.settings.idle_poll_interval_seconds
        if not accounts:
            logger.info("No accounts from distribution-engine.")
            return self.settings.idle_poll_interval_seconds

        active_accounts = [a for a in accounts if a.get("status") in {"active", "warming"}]
        if not active_accounts:
            logger.info("No active/warming accounts available.")
            return self.settings.idle_poll_interval_seconds
        if not campaigns:
            logger.info("No active campaigns. Sleeping on idle interval.")
            return self.settings.idle_poll_interval_seconds

        # Pair accounts to available emulators deterministically
        work_items = list(zip(active_accounts, devices))
        work_items = work_items[: self.settings.max_parallel_emulators]

        tasks = [
            self._run_account_on_device(account, device, campaigns)
            for account, device in work_items
        ]

        # One emulator failure must not crash others.
        results = await asyncio.gather(*tasks, return_exceptions=True)
        executed = 0
        for idx, result in enumerate(results):
            if isinstance(result, Exception):
                account_id = str(work_items[idx][0].get("id"))
                logger.exception("Worker failed for account=%s", account_id, exc_info=result)
                cycle_errors += 1
            else:
                executed += int(bool(result))

        duration = round(time.perf_counter() - accounts_start, 2)
        logger.info(
            "Cycle complete: %s accounts processed, %s actions executed, %s errors",
            len(work_items),
            executed,
            cycle_errors,
            extra={"status": "cycle", "duration": duration},
        )
        return self.settings.poll_interval_seconds

    async def _run_account_on_device(
        self,
        account: dict[str, Any],
        device: EmulatorDevice,
        campaigns: list[dict[str, Any]],
    ) -> bool:
        assert self.action_logger is not None
        assert self.redis is not None

        account_id = str(account.get("id"))
        niche = self._extract_account_niche(account)
        tone = self._extract_account_tone(account)
        campaign = self._pick_campaign_for_account(account, campaigns)

        bot = InstagramBot(
            appium_server_url=self.settings.appium_server_url,
            device_serial=device.serial,
            app_package=self.settings.android_app_package,
            app_activity=self.settings.android_app_activity,
            min_human_delay=self.settings.min_human_delay_seconds,
            max_human_delay=self.settings.max_human_delay_seconds,
        )

        try:
            self.emulator_active.labels(device_id=device.serial).set(1)
            if not await self._passes_rate_limit(account_id, "post"):
                logger.info("Skipping account due to post rate limit account=%s", account_id)
                return False

            await self._enforce_proxy(account_id=account_id, device=device)
            await bot.connect()
            content = await self.content_generator.generate_for_account(
                niche=niche,
                tone=tone,
                campaign=campaign,
            )
            composed_caption = f"{content['caption']}\n\n{' '.join(content['hashtags'])}".strip()
            image_path = self._pick_image_path(account, campaign)
            result = await bot.publish_post(image_path=image_path, caption=composed_caption)
            await self._increment_rate_counter(account_id, "post")

            await self.action_logger.log_action(
                account_id=account_id,
                action_type="post",
                success=bool(result.get("success")),
                target_username=str(account.get("username", "")),
            )

            await self.api_client.report_execute(
                account_id=account_id,
                payload={
                    "action_type": "post",
                    "success": bool(result.get("success")),
                    "metadata": {
                        "device_serial": device.serial,
                        "niche": niche,
                        "campaign_id": campaign.get("id") if campaign else None,
                    },
                },
            )
            self.actions_total.labels(account_id=account_id, action_type="post", status="success").inc()
            logger.info("Account %s completed action on device %s", account_id, device.serial)
            return True
        except CircuitOpenError:
            logger.warning("API circuit open while processing account=%s", account_id)
            return False
        except Exception as exc:
            await self.action_logger.log_action(
                account_id=account_id,
                action_type="post",
                success=False,
                target_username=str(account.get("username", "")),
                error_message=str(exc),
            )
            # Report failure without stopping the global orchestrator.
            try:
                await self.api_client.report_execute(
                    account_id=account_id,
                    payload={
                        "action_type": "post",
                        "success": False,
                        "error": str(exc),
                        "metadata": {"device_serial": device.serial},
                    },
                )
            except Exception:
                logger.exception("Failed to report error for account=%s", account_id)
            self.actions_total.labels(account_id=account_id, action_type="post", status="error").inc()
            logger.exception("Account %s failed on device %s", account_id, device.serial)
            return False
        finally:
            self.emulator_active.labels(device_id=device.serial).set(0)
            await bot.close()

    async def _startup_health_check(self) -> None:
        ok_api = await self.api_client.health_check()
        if not ok_api:
            raise RuntimeError("distribution-engine health check failed")
        devices = await self.device_manager.list_connected_emulators()
        if not devices:
            logger.warning("Startup health check: no ADB emulators currently connected")
        assert self.db_pool is not None
        async with self.db_pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        logger.info("Startup health check passed")

    async def _start_screenshot_server(self) -> None:
        os.makedirs(self.settings.screenshot_dir, exist_ok=True)

        async def list_screenshots(_request: web.Request) -> web.Response:
            files = []
            for name in os.listdir(self.settings.screenshot_dir):
                if not name.lower().endswith(".png"):
                    continue
                path = os.path.join(self.settings.screenshot_dir, name)
                try:
                    stat = os.stat(path)
                    files.append(
                        {
                            "name": name,
                            "size": stat.st_size,
                            "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z",
                            "url": f"/screenshots/file/{name}",
                        }
                    )
                except OSError:
                    continue

            files.sort(key=lambda x: x["modified_at"], reverse=True)
            return web.json_response({"count": len(files), "items": files[:100]})

        async def _emulator_list_item(device) -> dict[str, Any]:
            try:
                size = await asyncio.wait_for(
                    self.device_manager.get_screen_size(device.serial),
                    timeout=5.0,
                )
            except Exception:
                size = None
            lock = self._get_emulator_lock(device.serial)
            return {
                "serial": device.serial,
                "status": device.status,
                "model": device.model,
                "busy": _emulator_lock_is_busy(lock),
                "screen_size": (
                    {"width": size[0], "height": size[1]} if size else None
                ),
            }

        async def list_emulators(_request: web.Request) -> web.Response:
            try:
                devices = await self.device_manager.list_connected_emulators()
                if devices:
                    items = await asyncio.gather(
                        *[_emulator_list_item(d) for d in devices]
                    )
                else:
                    items = []
                return web.json_response(
                    {
                        "count": len(items),
                        "items": items,
                    }
                )
            except Exception as exc:
                logger.exception("list_emulators_failed")
                return web.json_response(
                    {"count": 0, "items": [], "error": str(exc)},
                    status=500,
                )

        async def emulator_frame(request: web.Request) -> web.StreamResponse:
            serial = request.match_info.get("serial", "")
            if not is_valid_emulator_serial(serial):
                return web.json_response({"error": "Invalid emulator serial"}, status=400)

            try:
                png = await self.device_manager.capture_screenshot_png(serial)
            except Exception as exc:
                return web.json_response({"error": str(exc)}, status=500)

            return web.Response(
                body=png,
                content_type="image/png",
                headers={
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                },
            )

        async def input_tap(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            try:
                payload = await request.json()
                x = int(payload.get("x"))
                y = int(payload.get("y"))
            except Exception:
                return web.json_response(
                    {
                        "status": "error",
                        "execution_time_ms": int((monotonic() - started) * 1000),
                        "error": "Invalid JSON body; expected {x:number,y:number}",
                    },
                    status=400,
                )

            return await self._execute_input_action(
                serial=serial,
                action_type="tap",
                data={"x": x, "y": y},
                runner=lambda: self.device_manager.input_tap(serial, x, y),
                started=started,
            )

        async def input_swipe(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            try:
                payload = await request.json()
                x1 = int(payload.get("x1"))
                y1 = int(payload.get("y1"))
                x2 = int(payload.get("x2"))
                y2 = int(payload.get("y2"))
                duration = int(payload.get("duration", 250))
            except Exception:
                return web.json_response(
                    {
                        "status": "error",
                        "execution_time_ms": int((monotonic() - started) * 1000),
                        "error": "Invalid JSON body; expected {x1,y1,x2,y2,duration}",
                    },
                    status=400,
                )

            return await self._execute_input_action(
                serial=serial,
                action_type="swipe",
                data={"x1": x1, "y1": y1, "x2": x2, "y2": y2, "duration": duration},
                runner=lambda: self.device_manager.input_swipe(serial, x1, y1, x2, y2, duration),
                started=started,
            )

        async def input_key(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            try:
                payload = await request.json()
                key = payload.get("key")
                if self.device_manager.is_app_drawer_key(key):
                    width = payload.get("width")
                    height = payload.get("height")
                    w = int(width) if width is not None else None
                    h = int(height) if height is not None else None
                    return await self._execute_input_action(
                        serial=serial,
                        action_type="app_drawer",
                        data={"key": str(key), "width": w, "height": h},
                        runner=lambda: self.device_manager.input_app_drawer(serial, w, h),
                        started=started,
                    )
                code = self.device_manager.resolve_keyevent_code(
                    key,
                    payload.get("keycode"),
                )
            except (TypeError, ValueError) as exc:
                return web.json_response(
                    {
                        "status": "error",
                        "execution_time_ms": int((monotonic() - started) * 1000),
                        "error": str(exc)
                        or 'Invalid JSON body; expected {"key":"app_drawer"} or {"keycode":4}',
                    },
                    status=400,
                )

            return await self._execute_input_action(
                serial=serial,
                action_type="key",
                data={"keycode": code},
                runner=lambda: self.device_manager.input_keyevent(serial, code),
                started=started,
            )

        async def list_avds(_request: web.Request) -> web.Response:
            try:
                names = await self.device_manager.list_avds()
            except RuntimeError as exc:
                return web.json_response(
                    {"count": 0, "items": [], "error": str(exc)},
                    status=503,
                )
            except Exception as exc:
                logger.exception("list_avds_failed")
                return web.json_response(
                    {"count": 0, "items": [], "error": str(exc)},
                    status=500,
                )
            return web.json_response({"count": len(names), "items": names})

        async def preflight(_request: web.Request) -> web.Response:
            try:
                result = await self.device_manager.preflight()
            except Exception as exc:
                logger.exception("preflight_failed")
                return web.json_response(
                    {"ready": False, "verdict": "internal_error", "message": str(exc)},
                    status=500,
                )
            status_code = 200 if result.get("ready") else 503
            return web.json_response(result, status=status_code)

        async def add_emulator(request: web.Request) -> web.Response:
            started = monotonic()
            try:
                payload = await request.json()
            except Exception:
                return web.json_response(
                    {
                        "success": False,
                        "phase": "validation_failed",
                        "message": "Invalid JSON body",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=400,
                )

            mode = str(payload.get("mode") or "").strip().lower()
            if mode not in {"launch_avd", "adb_connect"}:
                return web.json_response(
                    {
                        "success": False,
                        "phase": "validation_failed",
                        "message": "mode must be 'launch_avd' or 'adb_connect'",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=400,
                )

            try:
                if mode == "launch_avd":
                    avd_name = str(payload.get("avd_name") or "").strip()
                    if not avd_name:
                        return web.json_response(
                            {
                                "success": False,
                                "phase": "validation_failed",
                                "message": "avd_name is required",
                                "elapsed_ms": int((monotonic() - started) * 1000),
                            },
                            status=400,
                        )
                    headless = bool(payload.get("headless", True))
                    result = await self.device_manager.launch_avd(
                        avd_name, headless=headless
                    )
                else:
                    host_port = str(payload.get("host_port") or "").strip()
                    if not host_port:
                        return web.json_response(
                            {
                                "success": False,
                                "phase": "validation_failed",
                                "message": "host_port is required",
                                "elapsed_ms": int((monotonic() - started) * 1000),
                            },
                            status=400,
                        )
                    result = await self.device_manager.adb_connect(host_port)
            except ValueError as exc:
                return web.json_response(
                    {
                        "success": False,
                        "phase": "validation_failed",
                        "message": str(exc),
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=400,
                )
            except Exception as exc:
                logger.exception("add_emulator_failed mode=%s", mode)
                return web.json_response(
                    {
                        "success": False,
                        "phase": "internal_error",
                        "message": str(exc),
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=500,
                )

            status_code = 200 if result.get("success") else 500
            logger.info(
                "emulator_add mode=%s phase=%s success=%s elapsed_ms=%s",
                mode,
                result.get("phase"),
                result.get("success"),
                result.get("elapsed_ms"),
            )
            return web.json_response(result, status=status_code)

        async def restart_emulator(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            if not is_valid_emulator_serial(serial):
                return web.json_response(
                    {
                        "success": False,
                        "serial": serial,
                        "phase": "validation_failed",
                        "message": "Invalid emulator serial",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=400,
                )

            lock = self._get_emulator_lock(serial)
            if _emulator_lock_is_busy(lock):
                return web.json_response(
                    {
                        "success": False,
                        "serial": serial,
                        "phase": "busy",
                        "message": "Emulator is busy",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=409,
                )

            async with lock:
                try:
                    result = await self.device_manager.restart_emulator(serial)
                except ValueError as exc:
                    return web.json_response(
                        {
                            "success": False,
                            "serial": serial,
                            "phase": "validation_failed",
                            "message": str(exc),
                            "elapsed_ms": int((monotonic() - started) * 1000),
                        },
                        status=404,
                    )
                except Exception as exc:
                    logger.exception("emulator_restart_failed serial=%s", serial)
                    return web.json_response(
                        {
                            "success": False,
                            "serial": serial,
                            "phase": "restart_failed",
                            "message": str(exc),
                            "elapsed_ms": int((monotonic() - started) * 1000),
                        },
                        status=500,
                    )

                status_code = 200 if result.get("success") else 500
                logger.info(
                    "emulator_restart serial=%s phase=%s success=%s elapsed_ms=%s",
                    serial,
                    result.get("phase"),
                    result.get("success"),
                    result.get("elapsed_ms"),
                )
                return web.json_response(result, status=status_code)

        async def stop_emulator(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            if not is_valid_emulator_serial(serial):
                return web.json_response(
                    {
                        "success": False,
                        "serial": serial,
                        "phase": "validation_failed",
                        "message": "Invalid emulator serial",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=400,
                )

            lock = self._get_emulator_lock(serial)
            if _emulator_lock_is_busy(lock):
                return web.json_response(
                    {
                        "success": False,
                        "serial": serial,
                        "phase": "busy",
                        "message": "Emulator is busy",
                        "elapsed_ms": int((monotonic() - started) * 1000),
                    },
                    status=409,
                )

            async with lock:
                try:
                    result = await self.device_manager.stop_emulator(serial)
                except ValueError as exc:
                    return web.json_response(
                        {
                            "success": False,
                            "serial": serial,
                            "phase": "validation_failed",
                            "message": str(exc),
                            "elapsed_ms": int((monotonic() - started) * 1000),
                        },
                        status=404,
                    )
                except Exception as exc:
                    logger.exception("emulator_stop_failed serial=%s", serial)
                    return web.json_response(
                        {
                            "success": False,
                            "serial": serial,
                            "phase": "stop_failed",
                            "message": str(exc),
                            "elapsed_ms": int((monotonic() - started) * 1000),
                        },
                        status=500,
                    )

            if serial in self.emulator_locks:
                del self.emulator_locks[serial]

            status_code = 200 if result.get("success") else 500
            logger.info(
                "emulator_stop serial=%s phase=%s success=%s elapsed_ms=%s",
                serial,
                result.get("phase"),
                result.get("success"),
                result.get("elapsed_ms"),
            )
            return web.json_response(result, status=status_code)

        async def launch_instagram_app(request: web.Request) -> web.Response:
            serial = request.match_info.get("serial", "")
            started = monotonic()
            return await self._execute_input_action(
                serial=serial,
                action_type="launch_instagram",
                data={"package": self.settings.android_app_package},
                runner=lambda: self.device_manager.launch_instagram(serial),
                started=started,
            )

        app = web.Application()
        app.router.add_get("/screenshots", list_screenshots)
        app.router.add_get("/emulators", list_emulators)
        app.router.add_get("/avds", list_avds)
        app.router.add_get("/emulators/preflight", preflight)
        app.router.add_post("/emulators/actions/add", add_emulator)
        app.router.add_get("/emulators/{serial}/frame.png", emulator_frame)
        app.router.add_post("/emulators/{serial}/input/tap", input_tap)
        app.router.add_post("/emulators/{serial}/input/swipe", input_swipe)
        app.router.add_post("/emulators/{serial}/input/key", input_key)
        app.router.add_post("/emulators/{serial}/apps/instagram", launch_instagram_app)
        app.router.add_post("/emulators/{serial}/actions/restart", restart_emulator)
        app.router.add_post("/emulators/{serial}/actions/stop", stop_emulator)
        app.router.add_static("/screenshots/file/", self.settings.screenshot_dir, show_index=False)

        self.screenshot_runner = web.AppRunner(app)
        await self.screenshot_runner.setup()
        site = web.TCPSite(self.screenshot_runner, "0.0.0.0", self.settings.screenshot_server_port)
        await site.start()
        logger.info("Screenshot server started on port %s", self.settings.screenshot_server_port)

    async def _execute_input_action(
        self,
        *,
        serial: str,
        action_type: str,
        data: dict[str, Any],
        runner,
        started: float,
    ) -> web.Response:
        if not is_valid_emulator_serial(serial):
            return web.json_response(
                {
                    "status": "error",
                    "execution_time_ms": int((monotonic() - started) * 1000),
                    "error": "Invalid emulator serial",
                },
                status=400,
            )

        if not self._consume_action_token(serial):
            return web.json_response(
                {
                    "status": "error",
                    "execution_time_ms": int((monotonic() - started) * 1000),
                    "error": "Rate limit exceeded for emulator",
                },
                status=429,
            )

        lock = self._get_emulator_lock(serial)
        if _emulator_lock_is_busy(lock):
            return web.json_response(
                {
                    "status": "error",
                    "execution_time_ms": int((monotonic() - started) * 1000),
                    "error": "Emulator is busy",
                },
                status=409,
            )

        async with lock:
            try:
                await runner()
                duration_ms = int((monotonic() - started) * 1000)
                logger.info(
                    "emulator_input_action serial=%s action=%s data=%s duration_ms=%s",
                    serial,
                    action_type,
                    json.dumps(data, ensure_ascii=True),
                    duration_ms,
                )
                return web.json_response(
                    {
                        "status": "success",
                        "execution_time_ms": duration_ms,
                    }
                )
            except Exception as exc:
                duration_ms = int((monotonic() - started) * 1000)
                logger.error(
                    "emulator_input_action_failed serial=%s action=%s data=%s error=%s duration_ms=%s",
                    serial,
                    action_type,
                    json.dumps(data, ensure_ascii=True),
                    str(exc),
                    duration_ms,
                )
                return web.json_response(
                    {
                        "status": "error",
                        "execution_time_ms": duration_ms,
                        "error": str(exc),
                    },
                    status=500,
                )

    def _get_emulator_lock(self, serial: str) -> asyncio.Lock:
        lock = self.emulator_locks.get(serial)
        if lock is None:
            lock = asyncio.Lock()
            self.emulator_locks[serial] = lock
        return lock

    def _consume_action_token(self, serial: str) -> bool:
        # Basic per-emulator rate limit: max 10 actions / second
        now = monotonic()
        bucket = self.action_timestamps.get(serial)
        if bucket is None:
            bucket = collections.deque()
            self.action_timestamps[serial] = bucket

        while bucket and (now - bucket[0]) > 1.0:
            bucket.popleft()

        if len(bucket) >= 10:
            return False

        bucket.append(now)
        return True

    async def _timed_api(self, func, endpoint: str):
        start = time.perf_counter()
        result = await func()
        self.api_request_duration.labels(endpoint=endpoint).observe(time.perf_counter() - start)
        return result

    async def _passes_rate_limit(self, account_id: str, action_type: str) -> bool:
        assert self.db_pool is not None
        assert self.redis is not None
        limits = await self._get_rate_limits(account_id)

        if action_type == "post":
            count = await self._get_counter(account_id, "post", "day")
            return count < limits["max_posts_per_day"]
        if action_type == "like":
            count = await self._get_counter(account_id, "like", "hour")
            return count < limits["max_likes_per_hour"]
        if action_type == "follow":
            count = await self._get_counter(account_id, "follow", "day")
            return count < limits["max_follows_per_day"]
        return True

    async def _get_rate_limits(self, account_id: str) -> dict[str, int]:
        assert self.db_pool is not None
        query = """
            SELECT max_posts_per_day, max_likes_per_hour, max_follows_per_day
            FROM account_rate_limits WHERE account_id = $1
        """
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(query, account_id)
        if row:
            return {
                "max_posts_per_day": int(row["max_posts_per_day"]),
                "max_likes_per_hour": int(row["max_likes_per_hour"]),
                "max_follows_per_day": int(row["max_follows_per_day"]),
            }
        return {
            "max_posts_per_day": int(os.getenv("DEFAULT_MAX_POSTS_PER_DAY", "3")),
            "max_likes_per_hour": int(os.getenv("DEFAULT_MAX_LIKES_PER_HOUR", "20")),
            "max_follows_per_day": int(os.getenv("DEFAULT_MAX_FOLLOWS_PER_DAY", "15")),
        }

    async def _get_counter(self, account_id: str, action_type: str, window: str) -> int:
        assert self.redis is not None
        key = self._counter_key(account_id, action_type, window)
        value = await self.redis.get(key)
        return int(value or 0)

    async def _increment_rate_counter(self, account_id: str, action_type: str) -> None:
        assert self.redis is not None
        windows = ["day"] if action_type in {"post", "follow"} else ["hour"]
        for window in windows:
            key = self._counter_key(account_id, action_type, window)
            ttl = 86400 if window == "day" else 3600
            pipeline = self.redis.pipeline()
            pipeline.incr(key, 1)
            pipeline.expire(key, ttl, nx=True)
            await pipeline.execute()

    def _counter_key(self, account_id: str, action_type: str, window: str) -> str:
        return f"rate:{account_id}:{action_type}:{window}"

    async def _enforce_proxy(self, *, account_id: str, device: EmulatorDevice) -> None:
        assert self.action_logger is not None
        lock = self._get_proxy_lock(device.serial)
        async with lock:
            if not self._allow_proxy_reconfigure(account_id):
                self.proxy_bridge_events.labels(status="throttled", operation="assign").inc()
                raise RuntimeError("Proxy reconfiguration throttled for account")
            proxy = await self.api_client.get_proxy_credentials(account_id)
            bridge_runtime = await self._ensure_proxy_bridge(
                account_id=account_id,
                emulator_serial=device.serial,
                proxy=proxy,
            )
            await self.device_manager.apply_http_proxy(
                device.serial,
                host=self.settings.proxy_bridge_public_host,
                port=bridge_runtime.listen_port,
            )
            expected = f"{self.settings.proxy_bridge_public_host}:{bridge_runtime.listen_port}"
            ok_setting = await self.device_manager.verify_http_proxy_value(device.serial, expected)
            ok_bridge = await self.proxy_bridge_manager.health_check(bridge_runtime.bridge_id)
            ok = ok_setting and ok_bridge
            if not ok:
                await self.api_client.rotate_proxy(account_id)
                proxy = await self.api_client.get_proxy_credentials(account_id)
                bridge_runtime = await self._ensure_proxy_bridge(
                    account_id=account_id,
                    emulator_serial=device.serial,
                    proxy=proxy,
                )
                await self.device_manager.apply_http_proxy(
                    device.serial,
                    host=self.settings.proxy_bridge_public_host,
                    port=bridge_runtime.listen_port,
                )
                expected = f"{self.settings.proxy_bridge_public_host}:{bridge_runtime.listen_port}"
                ok_setting = await self.device_manager.verify_http_proxy_value(device.serial, expected)
                ok_bridge = await self.proxy_bridge_manager.health_check(bridge_runtime.bridge_id)
                if not (ok_setting and ok_bridge):
                    await self._upsert_proxy_binding(
                        account_id=account_id,
                        emulator_serial=device.serial,
                        proxy_id=str(proxy.get("proxy_id", "")),
                        bridge_host=self.settings.proxy_bridge_public_host,
                        bridge_port=bridge_runtime.listen_port,
                        bridge_id=bridge_runtime.bridge_id,
                        status="error",
                        last_error="Bridge not healthy after proxy rotation",
                    )
                    self.proxy_bridge_events.labels(status="error", operation="assign").inc()
                    raise RuntimeError("Proxy bridge unreachable after rotation")
            await self._upsert_proxy_binding(
                account_id=account_id,
                emulator_serial=device.serial,
                proxy_id=str(proxy.get("proxy_id", "")),
                bridge_host=self.settings.proxy_bridge_public_host,
                bridge_port=bridge_runtime.listen_port,
                bridge_id=bridge_runtime.bridge_id,
                status="active",
                last_error=None,
            )
            self.proxy_bridge_events.labels(status="success", operation="assign").inc()
        await self.action_logger.log_action(
            account_id=account_id,
            action_type="proxy_assign",
            success=True,
            target_id=str(proxy.get("proxy_id")),
            target_username=device.serial,
        )

    async def _ensure_proxy_bridge(
        self,
        *,
        account_id: str,
        emulator_serial: str,
        proxy: dict[str, Any],
    ):
        upstream = UpstreamProxy(
            proxy_id=str(proxy.get("proxy_id")),
            host=str(proxy["host"]),
            port=int(proxy["port"]),
            proxy_type=str(proxy.get("proxy_type") or "http").lower(),
            username=(str(proxy["username"]) if proxy.get("username") else None),
            password=(str(proxy["password"]) if proxy.get("password") else None),
        )
        return await self.proxy_bridge_manager.ensure_bridge(
            account_id=account_id,
            emulator_serial=emulator_serial,
            upstream=upstream,
        )

    async def _upsert_proxy_binding(
        self,
        *,
        account_id: str,
        emulator_serial: str,
        proxy_id: str,
        bridge_host: str,
        bridge_port: int,
        bridge_id: str,
        status: str,
        last_error: str | None,
    ) -> None:
        assert self.db_pool is not None
        query = """
            INSERT INTO emulator_proxy_bindings (
                emulator_serial, account_id, proxy_id, bridge_host, bridge_port, bridge_id, status, last_error, last_applied_at
            ) VALUES ($1, $2, NULLIF($3, '')::uuid, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (emulator_serial)
            DO UPDATE SET
                account_id = EXCLUDED.account_id,
                proxy_id = EXCLUDED.proxy_id,
                bridge_host = EXCLUDED.bridge_host,
                bridge_port = EXCLUDED.bridge_port,
                bridge_id = EXCLUDED.bridge_id,
                status = EXCLUDED.status,
                last_error = EXCLUDED.last_error,
                last_applied_at = NOW()
        """
        async with self.db_pool.acquire() as conn:
            await conn.execute(
                query,
                emulator_serial,
                account_id,
                proxy_id,
                bridge_host,
                bridge_port,
                bridge_id,
                status,
                last_error,
            )

    async def _reconcile_proxy_bindings(self) -> None:
        assert self.db_pool is not None
        devices = await self.device_manager.list_connected_emulators()
        serials = {d.serial for d in devices}
        if not serials:
            return
        query = """
            SELECT emulator_serial, account_id
            FROM emulator_proxy_bindings
            WHERE status = 'active'
        """
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(query)

        restored = 0
        for row in rows:
            serial = str(row["emulator_serial"])
            if serial not in serials:
                continue
            account_id = str(row["account_id"])
            try:
                proxy = await self.api_client.get_proxy_credentials(account_id)
                bridge = await self._ensure_proxy_bridge(
                    account_id=account_id,
                    emulator_serial=serial,
                    proxy=proxy,
                )
                await self.device_manager.apply_http_proxy(
                    serial,
                    host=self.settings.proxy_bridge_public_host,
                    port=bridge.listen_port,
                )
                expected = f"{self.settings.proxy_bridge_public_host}:{bridge.listen_port}"
                if await self.device_manager.verify_http_proxy_value(serial, expected):
                    restored += 1
                    self.proxy_bridge_events.labels(status="success", operation="reconcile").inc()
                else:
                    self.proxy_bridge_events.labels(status="error", operation="reconcile").inc()
            except Exception as exc:
                self.proxy_bridge_events.labels(status="error", operation="reconcile").inc()
                logger.warning("proxy_binding_reconcile_failed serial=%s account=%s err=%s", serial, account_id, exc)

        if rows:
            logger.info("proxy_binding_reconcile_complete restored=%s attempted=%s", restored, len(rows))

    def _get_proxy_lock(self, serial: str) -> asyncio.Lock:
        lock = self.proxy_locks.get(serial)
        if lock is None:
            lock = asyncio.Lock()
            self.proxy_locks[serial] = lock
        return lock

    def _allow_proxy_reconfigure(self, account_id: str, min_interval_seconds: float = 3.0) -> bool:
        now = monotonic()
        last = self.proxy_last_reconfigure_at.get(account_id, 0.0)
        if (now - last) < min_interval_seconds:
            return False
        self.proxy_last_reconfigure_at[account_id] = now
        return True

    @staticmethod
    def _pick_image_path(account: dict[str, Any], campaign: dict[str, Any] | None) -> str:
        metadata = account.get("metadata") or {}
        if campaign and isinstance(campaign.get("settings"), dict):
            image = campaign["settings"].get("image_path")
            if image:
                return str(image)
        if isinstance(metadata, dict) and metadata.get("image_path"):
            return str(metadata["image_path"])
        return "/app/assets/default.jpg"

    @staticmethod
    def _extract_account_niche(account: dict[str, Any]) -> str:
        metadata = account.get("metadata") or {}
        if isinstance(metadata, dict) and metadata.get("niche"):
            return str(metadata["niche"])
        return str(account.get("niche") or "general")

    @staticmethod
    def _extract_account_tone(account: dict[str, Any]) -> str:
        metadata = account.get("metadata") or {}
        if isinstance(metadata, dict) and metadata.get("tone"):
            return str(metadata["tone"])
        return "friendly and informative"

    @staticmethod
    def _pick_campaign_for_account(
        account: dict[str, Any],
        campaigns: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        account_niche = str(account.get("niche") or "")
        for campaign in campaigns:
            if campaign.get("target_account_id") == account.get("id"):
                return campaign
            if account_niche and campaign.get("target_niche") == account_niche:
                return campaign
        return campaigns[0] if campaigns else None


async def _async_main() -> None:
    settings = Settings.from_env()
    orchestrator = EmulatorOrchestrator(settings)
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        logger.info("Shutdown signal received")
        orchestrator.stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            pass
    try:
        await orchestrator.start()
    finally:
        await orchestrator.shutdown()


if __name__ == "__main__":
    _setup_logging()
    asyncio.run(_async_main())
