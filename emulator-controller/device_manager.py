import asyncio
import logging
import os
import re
import shutil
import time
from dataclasses import dataclass
from typing import Any, List

import aiohttp


# Accepts host:port forms like "192.168.1.10:5555", "host.local:5555",
# "10.0.2.2:21503". Hostname segment is restricted to letters/digits/._- to
# avoid surprises before we hand the value to adb.
ADB_CONNECT_TARGET_RE = re.compile(r"^(?P<host>[A-Za-z0-9._-]+):(?P<port>\d{1,5})$")
AVD_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


logger = logging.getLogger(__name__)


@dataclass
class EmulatorDevice:
    serial: str
    status: str
    model: str | None = None
    transport_id: str | None = None


def is_valid_emulator_serial(serial: str) -> bool:
    """Return True for local emulators (emulator-XXXX) and adb-connect targets
    (host:port). These are the two ways the controller surfaces a device, so
    anything else should be rejected before being passed to adb."""
    if not serial:
        return False
    if serial.startswith("emulator-"):
        return True
    return bool(ADB_CONNECT_TARGET_RE.match(serial))


class DeviceManager:
    def __init__(self, adb_path: str | None = None) -> None:
        self.adb_path = adb_path or os.getenv("ADB_PATH", "adb")
        self.adb_host = os.getenv("ADB_HOST", "").strip()
        self.adb_port = os.getenv("ADB_PORT", "5037").strip()
        self.emulator_path = os.getenv("EMULATOR_PATH", "emulator").strip()
        self.agent_url = os.getenv("EMULATOR_AGENT_URL", "").strip().rstrip("/")
        self.agent_token = os.getenv("EMULATOR_AGENT_TOKEN", "").strip()

    def _agent_headers(self) -> dict[str, str]:
        if self.agent_token:
            return {"Authorization": f"Bearer {self.agent_token}"}
        return {}

    async def _agent_get(self, path: str, *, timeout: int = 15) -> tuple[int, dict[str, Any]]:
        assert self.agent_url, "agent_url must be set"
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            async with session.get(
                f"{self.agent_url}{path}", headers=self._agent_headers()
            ) as resp:
                body = await resp.json(content_type=None)
                return resp.status, body if isinstance(body, dict) else {"raw": body}

    async def _agent_post(
        self, path: str, payload: dict[str, Any], *, timeout: int = 30
    ) -> tuple[int, dict[str, Any]]:
        assert self.agent_url, "agent_url must be set"
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
            async with session.post(
                f"{self.agent_url}{path}",
                json=payload,
                headers=self._agent_headers(),
            ) as resp:
                body = await resp.json(content_type=None)
                return resp.status, body if isinstance(body, dict) else {"raw": body}

    def _adb_base(self) -> list[str]:
        cmd = [self.adb_path]
        if self.adb_host:
            cmd.extend(["-H", self.adb_host])
            if self.adb_port:
                cmd.extend(["-P", self.adb_port])
        return cmd

    async def list_connected_emulators(self, include_non_device: bool = False) -> List[EmulatorDevice]:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "devices",
            "-l",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()

        if proc.returncode != 0:
            error_msg = err.decode(errors='ignore').strip()
            logger.warning("adb devices failed, assuming 0 connectable devices: %s", error_msg)
            return []

        lines = out.decode(errors='ignore').splitlines()
        devices: List[EmulatorDevice] = []
        for line in lines[1:]:
            raw = line.strip()
            if not raw:
                continue
            parts = raw.split()
            serial = parts[0]
            status = parts[1] if len(parts) > 1 else "unknown"
            if not is_valid_emulator_serial(serial):
                continue

            model = None
            transport_id = None
            for part in parts[2:]:
                if part.startswith("model:"):
                    model = part.split(":", 1)[1]
                if part.startswith("transport_id:"):
                    transport_id = part.split(":", 1)[1]

            devices.append(
                EmulatorDevice(
                    serial=serial,
                    status=status,
                    model=model,
                    transport_id=transport_id,
                )
            )

        logger.info("Detected %s emulator(s)", len(devices))
        if include_non_device:
            return devices
        return [d for d in devices if d.status == "device"]

    async def wait_for_device(self, serial: str, timeout_seconds: int = 60) -> bool:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            "wait-for-device",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
            return proc.returncode == 0
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return False

    async def wait_for_status(self, serial: str, expected_status: str = "device", timeout_seconds: int = 90) -> bool:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            devices = await self.list_connected_emulators(include_non_device=True)
            for d in devices:
                if d.serial == serial and d.status == expected_status:
                    return True
            await asyncio.sleep(2)
        return False

    async def get_emulator_avd_name(self, serial: str) -> str | None:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            "emu",
            "avd",
            "name",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        if proc.returncode != 0:
            logger.warning(
                "Could not resolve AVD name for serial=%s: %s",
                serial,
                err.decode(errors="ignore").strip(),
            )
            return None
        value = out.decode(errors="ignore").strip()
        return value or None

    async def restart_emulator(self, serial: str, timeout_seconds: int = 120) -> dict[str, Any]:
        started = time.monotonic()
        devices = await self.list_connected_emulators(include_non_device=True)
        known_serials = {d.serial for d in devices}
        if serial not in known_serials:
            raise ValueError(f"unknown_emulator_serial:{serial}")

        avd_name = await self.get_emulator_avd_name(serial)
        last_phase = "reboot"
        try:
            await self._adb(serial, "reboot")
            if await self.wait_for_status(serial, expected_status="device", timeout_seconds=timeout_seconds):
                return {
                    "success": True,
                    "serial": serial,
                    "avd_name": avd_name,
                    "phase": "completed",
                    "message": "Emulator rebooted successfully",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "timeout_waiting_device",
                "message": "Reboot command sent but emulator did not return to device state before timeout",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }
        except Exception as reboot_error:
            last_phase = "kill_and_relaunch"
            logger.warning("Emulator reboot failed for serial=%s: %s", serial, reboot_error)

        try:
            await self._adb(serial, "emu", "kill")
        except Exception as kill_error:
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "kill_failed",
                "message": str(kill_error),
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        resolved_emulator = shutil.which(self.emulator_path) if self.emulator_path else None
        if not resolved_emulator:
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "launch_failed",
                "message": "Emulator binary not found; set EMULATOR_PATH to enable relaunch",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }
        if not avd_name:
            return {
                "success": False,
                "serial": serial,
                "avd_name": None,
                "phase": "launch_failed",
                "message": "Unable to resolve AVD name for relaunch",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        launch_proc = await asyncio.create_subprocess_exec(
            resolved_emulator,
            "-avd",
            avd_name,
            "-no-snapshot-load",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        if launch_proc.returncode not in (None, 0):
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "launch_failed",
                "message": f"Relaunch process exited immediately with code {launch_proc.returncode}",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        if await self.wait_for_status(serial, expected_status="device", timeout_seconds=timeout_seconds):
            return {
                "success": True,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "completed",
                "message": "Emulator relaunched successfully",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        return {
            "success": False,
            "serial": serial,
            "avd_name": avd_name,
            "phase": "timeout_waiting_device",
            "message": f"Reached timeout after phase {last_phase}",
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }

    async def preflight(self, timeout_seconds: int = 15) -> dict[str, Any]:
        if self.agent_url:
            try:
                status, body = await self._agent_get("/preflight", timeout=timeout_seconds + 5)
            except aiohttp.ClientError as exc:
                return {
                    "ready": False,
                    "verdict": "agent_unreachable",
                    "message": f"emulator host agent unreachable: {exc}",
                }
            except asyncio.TimeoutError:
                return {
                    "ready": False,
                    "verdict": "agent_timeout",
                    "message": "emulator host agent timed out on preflight",
                }
            if status >= 400:
                return {
                    "ready": False,
                    "verdict": body.get("verdict") or "agent_error",
                    "message": body.get("message") or body.get("error") or f"agent returned HTTP {status}",
                    **{k: body.get(k) for k in ("kvm", "emulator_binary", "avds") if k in body},
                }
            return body

        binary = shutil.which(self.emulator_path) if self.emulator_path else None
        return {
            "ready": False,
            "verdict": "no_agent_configured",
            "message": (
                "Launching AVDs requires a host-agent. Set EMULATOR_AGENT_URL in "
                "the controller's environment (see emulator-controller/host_agent/README.md)."
                if not binary
                else "Configure EMULATOR_AGENT_URL to delegate launches to a host-agent."
            ),
            "emulator_binary": binary,
        }

    async def list_avds(self, timeout_seconds: int = 10) -> list[str]:
        if self.agent_url:
            try:
                status, body = await self._agent_get("/avds", timeout=timeout_seconds + 5)
            except aiohttp.ClientError as exc:
                raise RuntimeError(f"emulator host agent unreachable: {exc}") from exc
            except asyncio.TimeoutError as exc:
                raise RuntimeError("emulator host agent timed out listing AVDs") from exc
            if status >= 400:
                raise RuntimeError(
                    body.get("error")
                    or f"emulator host agent returned HTTP {status} for /avds"
                )
            items = body.get("items") or []
            return [str(name) for name in items if isinstance(name, str) and AVD_NAME_RE.match(name)]

        resolved_emulator = shutil.which(self.emulator_path) if self.emulator_path else None
        if not resolved_emulator:
            raise RuntimeError(
                "Emulator binary not found inside the controller and no "
                "EMULATOR_AGENT_URL configured. Run the host-agent (see "
                "emulator-controller/host_agent/README.md) or set EMULATOR_PATH."
            )

        proc = await asyncio.create_subprocess_exec(
            resolved_emulator,
            "-list-avds",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError("Listing AVDs timed out") from None

        if proc.returncode != 0:
            raise RuntimeError(
                f"emulator -list-avds failed: {err.decode(errors='ignore').strip()}"
            )

        names: list[str] = []
        for line in out.decode(errors="ignore").splitlines():
            name = line.strip()
            # The emulator binary sometimes prints "INFO    | ..." preamble lines;
            # only keep tokens that look like real AVD identifiers.
            if name and AVD_NAME_RE.match(name):
                names.append(name)
        return names

    async def launch_avd(
        self,
        avd_name: str,
        *,
        headless: bool = True,
        wait_for_device_seconds: int = 60,
    ) -> dict[str, Any]:
        started = time.monotonic()
        if not AVD_NAME_RE.match(avd_name):
            raise ValueError(f"invalid_avd_name:{avd_name}")

        available = await self.list_avds()
        if avd_name not in available:
            raise ValueError(f"unknown_avd_name:{avd_name}")

        before = await self.list_connected_emulators(include_non_device=True)
        existing_serials = {d.serial for d in before}

        if self.agent_url:
            try:
                status, body = await self._agent_post(
                    "/launch",
                    {"avd_name": avd_name, "headless": headless},
                    timeout=30,
                )
            except aiohttp.ClientError as exc:
                return {
                    "success": False,
                    "avd_name": avd_name,
                    "phase": "launch_failed",
                    "message": f"emulator host agent unreachable: {exc}",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
            except asyncio.TimeoutError:
                return {
                    "success": False,
                    "avd_name": avd_name,
                    "phase": "launch_failed",
                    "message": "emulator host agent timed out launching AVD",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
            if status >= 400 or not body.get("success"):
                base_message = body.get("error") or f"emulator host agent returned HTTP {status}"
                tail = (body.get("log_tail") or "").strip()
                if tail and tail not in base_message:
                    last_line = tail.splitlines()[-1] if tail else ""
                    if last_line and last_line not in base_message:
                        base_message = f"{base_message} — {last_line}"
                return {
                    "success": False,
                    "avd_name": avd_name,
                    "phase": "launch_failed",
                    "message": base_message,
                    "log_path": body.get("log_path"),
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
        else:
            resolved_emulator = (
                shutil.which(self.emulator_path) if self.emulator_path else None
            )
            if not resolved_emulator:
                return {
                    "success": False,
                    "avd_name": avd_name,
                    "phase": "launch_failed",
                    "message": (
                        "Emulator binary not found inside the controller. Configure "
                        "EMULATOR_AGENT_URL to delegate to a host-side agent, or set "
                        "EMULATOR_PATH if the SDK is mounted into this container."
                    ),
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }

            args = [resolved_emulator, "-avd", avd_name, "-no-snapshot-load"]
            if headless:
                args.extend(["-no-window", "-no-audio"])

            # start_new_session detaches from the orchestrator's process group so
            # the emulator survives if the controller is restarted.
            launch_proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )

            await asyncio.sleep(0.5)
            if launch_proc.returncode not in (None, 0):
                return {
                    "success": False,
                    "avd_name": avd_name,
                    "phase": "launch_failed",
                    "message": (
                        f"emulator process exited immediately with code "
                        f"{launch_proc.returncode}"
                    ),
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }

        deadline = time.monotonic() + max(1, wait_for_device_seconds)
        new_serial: str | None = None
        while time.monotonic() < deadline:
            current = await self.list_connected_emulators(include_non_device=True)
            for d in current:
                if d.serial not in existing_serials:
                    new_serial = d.serial
                    break
            if new_serial is not None:
                break
            await asyncio.sleep(2)

        if new_serial is None:
            return {
                "success": True,
                "avd_name": avd_name,
                "serial": None,
                "phase": "pending",
                "message": (
                    "Emulator launch started but no new ADB serial appeared yet; "
                    "the device should come online shortly"
                ),
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        ready = await self.wait_for_status(
            new_serial,
            expected_status="device",
            timeout_seconds=max(1, int(deadline - time.monotonic())),
        )
        return {
            "success": True,
            "avd_name": avd_name,
            "serial": new_serial,
            "phase": "completed" if ready else "booting",
            "message": (
                "Emulator launched successfully"
                if ready
                else "Emulator launched; still booting"
            ),
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }

    async def adb_connect(
        self,
        host_port: str,
        *,
        wait_for_device_seconds: int = 15,
    ) -> dict[str, Any]:
        started = time.monotonic()
        match = ADB_CONNECT_TARGET_RE.match(host_port.strip())
        if not match:
            raise ValueError(f"invalid_adb_target:{host_port}")
        port = int(match.group("port"))
        if not (1 <= port <= 65535):
            raise ValueError(f"invalid_adb_port:{port}")

        target = f"{match.group('host')}:{port}"

        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "connect",
            target,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=15)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {
                "success": False,
                "target": target,
                "phase": "connect_timeout",
                "message": "adb connect timed out",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        stdout_s = out.decode(errors="ignore").strip()
        stderr_s = err.decode(errors="ignore").strip()
        combined = (stdout_s + "\n" + stderr_s).lower()

        # adb returns 0 even for failed connects; rely on the message.
        if proc.returncode != 0 or "failed" in combined or "cannot connect" in combined or "no route" in combined:
            return {
                "success": False,
                "target": target,
                "phase": "connect_failed",
                "message": stdout_s or stderr_s or "adb connect failed",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        # adb attaches remote devices using their host:port as the serial.
        ready = await self.wait_for_status(
            target,
            expected_status="device",
            timeout_seconds=max(1, wait_for_device_seconds),
        )
        return {
            "success": True,
            "target": target,
            "serial": target,
            "phase": "completed" if ready else "pending",
            "message": stdout_s or "Connected",
            "elapsed_ms": int((time.monotonic() - started) * 1000),
        }

    async def get_device_ip(self, serial: str) -> str | None:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            "shell",
            "ip",
            "route",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return None

        text = out.decode().strip()
        for token in text.split():
            if token.count(".") == 3:
                return token
        return None

    async def clear_http_proxy(self, serial: str) -> None:
        await self._adb(serial, "shell", "settings", "put", "global", "http_proxy", ":0")

    async def apply_http_proxy(
        self,
        serial: str,
        *,
        host: str,
        port: int,
    ) -> None:
        await self._adb(
            serial,
            "shell",
            "settings",
            "put",
            "global",
            "http_proxy",
            f"{host}:{port}",
        )
        logger.info("Applied emulator HTTP proxy serial=%s proxy=%s:%s", serial, host, port)

    async def get_http_proxy(self, serial: str) -> str:
        _, out, _ = await self._adb(serial, "shell", "settings", "get", "global", "http_proxy")
        return out.strip()

    async def verify_http_proxy_value(self, serial: str, expected: str) -> bool:
        current = await self.get_http_proxy(serial)
        return current == expected

    async def verify_proxy_reachable(self, serial: str, timeout_seconds: int = 8) -> bool:
        # Light probe from emulator namespace to ensure network path is alive.
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            "shell",
            "ping",
            "-c",
            "1",
            "8.8.8.8",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
            return proc.returncode == 0
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return False

    async def _adb(self, serial: str, *args: str) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await proc.communicate()
        out_s = out.decode(errors="ignore").strip()
        err_s = err.decode(errors="ignore").strip()
        if proc.returncode != 0:
            raise RuntimeError(f"adb {' '.join(args)} failed: {err_s or out_s}")
        return proc.returncode, out_s, err_s

    async def capture_screenshot_png(self, serial: str, timeout_seconds: int = 10) -> bytes:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            "exec-out",
            "screencap",
            "-p",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError(f"screencap timed out for {serial}") from None

        if proc.returncode != 0:
            raise RuntimeError(
                f"screencap failed for {serial}: {(err or b'').decode(errors='ignore').strip()}"
            )
        return out

    async def input_tap(self, serial: str, x: int, y: int) -> None:
        await self._adb(serial, "shell", "input", "tap", str(x), str(y))

    async def input_swipe(
        self,
        serial: str,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration: int,
    ) -> None:
        await self._adb(
            serial,
            "shell",
            "input",
            "swipe",
            str(x1),
            str(y1),
            str(x2),
            str(y2),
            str(duration),
        )

    async def get_screen_size(self, serial: str) -> tuple[int, int] | None:
        _, out, _ = await self._adb(serial, "shell", "wm", "size")
        # Example: "Physical size: 1080x2400"
        match = re.search(r"(\d+)x(\d+)", out)
        if not match:
            return None
        return int(match.group(1)), int(match.group(2))
