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
# ADB states we surface in the dashboard and treat as "emulator appeared" during launch.
ADB_VISIBLE_STATUSES = frozenset({"device", "unauthorized", "offline", "authorizing"})


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
        return [d for d in devices if d.status in ADB_VISIBLE_STATUSES]

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

    async def _stop_emulator_via_host_agent(self, serial: str) -> dict[str, Any] | None:
        if not self.agent_url:
            return None
        try:
            status, body = await self._agent_post("/stop", {"serial": serial}, timeout=25)
        except aiohttp.ClientError as exc:
            return {
                "success": False,
                "serial": serial,
                "phase": "agent_unreachable",
                "message": f"emulator host agent unreachable: {exc}",
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "serial": serial,
                "phase": "agent_timeout",
                "message": "emulator host agent timed out on stop",
            }
        if status >= 400 or not body.get("success"):
            return {
                "success": False,
                "serial": serial,
                "phase": body.get("phase") or "stop_failed",
                "message": body.get("message") or body.get("error") or f"agent returned HTTP {status}",
            }
        return {
            "success": True,
            "serial": serial,
            "phase": body.get("phase") or "completed",
            "message": body.get("message") or "Emulator session ended",
        }

    async def _device_still_listed(self, serial: str) -> bool:
        remaining = await self.list_connected_emulators(include_non_device=True)
        return any(d.serial == serial for d in remaining)

    async def stop_emulator(self, serial: str) -> dict[str, Any]:
        """End the emulator session: kill local AVD or disconnect remote ADB target."""
        started = time.monotonic()
        devices = await self.list_connected_emulators(include_non_device=True)
        known_serials = {d.serial for d in devices}
        if serial not in known_serials:
            raise ValueError(f"unknown_emulator_serial:{serial}")

        avd_name = await self.get_emulator_avd_name(serial)
        stop_errors: list[str] = []
        stop_ok = False

        # ``emu kill`` must run on the host where the emulator console listens (not via
        # Docker ``adb -H host.docker.internal``, which fails with "TCP port 5556 refused").
        if serial.startswith("emulator-") and (self.agent_url or self.adb_host):
            agent_result = await self._stop_emulator_via_host_agent(serial)
            if agent_result is not None:
                if agent_result.get("success"):
                    stop_ok = True
                else:
                    stop_errors.append(str(agent_result.get("message") or "host agent stop failed"))

        try:
            if not stop_ok and serial.startswith("emulator-"):
                await self._adb(serial, "emu", "kill", timeout_seconds=12.0)
                stop_ok = True
            elif not stop_ok:
                proc = await asyncio.create_subprocess_exec(
                    *self._adb_base(),
                    "disconnect",
                    serial,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                out, err = await proc.communicate()
                if proc.returncode != 0:
                    detail = (err or out).decode(errors="ignore").strip()
                    raise RuntimeError(detail or f"adb disconnect {serial} failed")
                stop_ok = True
        except Exception as exc:
            msg = str(exc)
            stop_errors.append(msg)
            if not await self._device_still_listed(serial):
                stop_ok = True
            elif self.adb_host and not self.agent_url and serial.startswith("emulator-"):
                return {
                    "success": False,
                    "serial": serial,
                    "avd_name": avd_name,
                    "phase": "stop_failed",
                    "message": (
                        "Cannot stop emulator from Docker without the host agent. "
                        "Start emulator-controller/host_agent on the Windows host and set "
                        "EMULATOR_AGENT_URL (see host_agent/README.md). "
                        f"Last error: {msg}"
                    ),
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }

        if not stop_ok:
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "stop_failed",
                "message": "; ".join(stop_errors) or "stop failed",
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            remaining = await self.list_connected_emulators(include_non_device=True)
            if not any(d.serial == serial for d in remaining):
                break
            await asyncio.sleep(1)

        still = await self.list_connected_emulators(include_non_device=True)
        if any(d.serial == serial for d in still):
            return {
                "success": False,
                "serial": serial,
                "avd_name": avd_name,
                "phase": "still_connected",
                "message": (
                    f"{serial} is still visible to ADB after stop; "
                    "close the emulator window on the host if it remains open"
                ),
                "elapsed_ms": int((time.monotonic() - started) * 1000),
            }

        return {
            "success": True,
            "serial": serial,
            "avd_name": avd_name,
            "phase": "completed",
            "message": "Emulator session ended",
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
        wait_for_device_seconds: int | None = None,
        boot_wait_seconds: int | None = None,
    ) -> dict[str, Any]:
        if wait_for_device_seconds is None:
            wait_for_device_seconds = int(os.getenv("EMULATOR_LAUNCH_WAIT_SECONDS", "25"))
        if boot_wait_seconds is None:
            boot_wait_seconds = int(os.getenv("EMULATOR_BOOT_WAIT_SECONDS", "12"))
        wait_for_device_seconds = max(5, min(120, wait_for_device_seconds))
        boot_wait_seconds = max(0, min(90, boot_wait_seconds))
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

        deadline = time.monotonic() + wait_for_device_seconds
        new_serial: str | None = None
        new_status: str | None = None
        poll_interval = 1.0
        while time.monotonic() < deadline:
            current = await self.list_connected_emulators(include_non_device=True)
            for d in current:
                if d.serial not in existing_serials and d.status in ADB_VISIBLE_STATUSES:
                    new_serial = d.serial
                    new_status = d.status
                    break
            if new_serial is not None:
                break
            await asyncio.sleep(poll_interval)

        elapsed_ms = int((time.monotonic() - started) * 1000)

        if new_serial and new_status == "unauthorized":
            return {
                "success": True,
                "avd_name": avd_name,
                "serial": new_serial,
                "phase": "unauthorized",
                "message": (
                    f"Emulator {new_serial} is running but ADB is unauthorized. "
                    "Uncheck Headless, relaunch the AVD, and accept the USB debugging "
                    "prompt on the emulator window (or run: adb -s "
                    f"{new_serial} emu kill and try again)."
                ),
                "elapsed_ms": elapsed_ms,
            }

        if new_serial is None:
            return {
                "success": True,
                "avd_name": avd_name,
                "serial": None,
                "phase": "pending",
                "message": (
                    "Emulator launch started; ADB has not listed a new device yet. "
                    "Refresh the emulator list in 30–60s."
                ),
                "elapsed_ms": elapsed_ms,
            }

        if boot_wait_seconds <= 0:
            return {
                "success": True,
                "avd_name": avd_name,
                "serial": new_serial,
                "phase": "booting",
                "message": (
                    f"Emulator process started ({new_serial}). "
                    "It may take a minute to finish booting."
                ),
                "elapsed_ms": elapsed_ms,
            }

        ready = await self.wait_for_status(
            new_serial,
            expected_status="device",
            timeout_seconds=boot_wait_seconds,
        )
        return {
            "success": True,
            "avd_name": avd_name,
            "serial": new_serial,
            "phase": "completed" if ready else "booting",
            "message": (
                "Emulator launched and ready"
                if ready
                else (
                    f"Emulator {new_serial} is starting; refresh the list if it is not "
                    "ready yet."
                )
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

    async def _adb(
        self,
        serial: str,
        *args: str,
        timeout_seconds: float | None = 15.0,
    ) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *self._adb_base(),
            "-s",
            serial,
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            if timeout_seconds is None:
                out, err = await proc.communicate()
            else:
                out, err = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=timeout_seconds,
                )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError(
                f"adb {' '.join(args)} timed out after {timeout_seconds}s on {serial}"
            )
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

    async def input_keyevent(self, serial: str, keycode: int) -> None:
        await self._adb(serial, "shell", "input", "keyevent", str(keycode))

    @staticmethod
    def is_app_drawer_key(key: str | int | None) -> bool:
        if key is None:
            return False
        return str(key).strip().lower() in ("app_drawer", "menu", "drawer")

    async def input_app_drawer(
        self,
        serial: str,
        width: int | None = None,
        height: int | None = None,
    ) -> dict[str, int]:
        """Open the launcher app drawer (All apps grid).

        Primary: ``am start -a android.intent.action.ALL_APPS`` (Nexus/Pixel Launcher).
        Fallback: HOME + long upward swipe (gesture nav often ignores short ``input swipe``).
        """
        size = await self.get_screen_size(serial)
        if size:
            width, height = size
        elif width is None or height is None:
            width, height = 1080, 2400

        x = width // 2
        y1 = height - 1
        y2 = max(80, int(height * 0.10))
        duration = 1200

        await self.input_keyevent(serial, 3)
        await asyncio.sleep(0.5)

        method = "intent"
        try:
            await self._adb(
                serial,
                "shell",
                "am",
                "start",
                "-a",
                "android.intent.action.ALL_APPS",
            )
        except RuntimeError as exc:
            logger.warning("ALL_APPS intent failed for %s: %s; using swipe fallback", serial, exc)
            method = "swipe"
            await self.input_swipe(serial, x, y1, x, y2, duration)
            await asyncio.sleep(0.15)
            # Second swipe from workspace (above search bar) for launchers that ignore edge swipes.
            mid_y1 = int(height * 0.72)
            mid_y2 = int(height * 0.18)
            await self.input_swipe(serial, x, mid_y1, x, mid_y2, 900)

        return {
            "method": method,
            "width": width,
            "height": height,
            "x1": x,
            "y1": y1,
            "x2": x,
            "y2": y2,
            "duration": duration,
        }

    @staticmethod
    def resolve_keyevent_code(key: str | int | None, keycode: int | None = None) -> int:
        if keycode is not None:
            return int(keycode)
        names: dict[str, int] = {
            "back": 4,
            "home": 3,
            "recent": 187,
            "app_switch": 187,
        }
        if key is None:
            raise ValueError("key or keycode required")
        if isinstance(key, int):
            return key
        normalized = str(key).strip().lower()
        if normalized.isdigit():
            return int(normalized)
        if normalized not in names:
            raise ValueError(f"unknown key name: {key}")
        return names[normalized]

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

    async def _package_installed(self, serial: str, package: str) -> bool:
        try:
            _, out, _ = await self._adb(serial, "shell", "pm", "path", package)
        except RuntimeError:
            return False
        return bool(out.strip())

    async def _resolve_launch_component(self, serial: str, package: str) -> str | None:
        """Return package/activity from the system launcher intent, if resolvable."""
        _, out, _ = await self._adb(
            serial,
            "shell",
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "-c",
            "android.intent.category.LAUNCHER",
            package,
        )
        for line in out.splitlines():
            candidate = line.strip()
            if not candidate or candidate == "No activity found":
                continue
            if "/" in candidate:
                return candidate
        return None

    async def _start_launcher_intent(self, serial: str, package: str) -> None:
        await self._adb(
            serial,
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            "-p",
            package,
        )

    async def _start_component(self, serial: str, component: str) -> None:
        await self._adb(serial, "shell", "am", "start", "-n", component)

    async def _start_monkey_launcher(self, serial: str, package: str) -> None:
        await self._adb(
            serial,
            "shell",
            "monkey",
            "-p",
            package,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        )

    async def launch_app(
        self,
        serial: str,
        package: str,
        activity: str | None = None,
    ) -> None:
        pkg = str(package or "").strip()
        if not pkg:
            raise ValueError("package is required")

        if not await self._package_installed(serial, pkg):
            raise RuntimeError(
                f"{pkg} is not installed on {serial}. "
                "Install the app APK on the emulator (Play Store or adb install) and retry."
            )

        errors: list[str] = []
        configured = str(activity or "").strip()
        if configured:
            component = configured if "/" in configured else f"{pkg}/{configured}"
            try:
                await self._start_component(serial, component)
                return
            except RuntimeError as exc:
                errors.append(f"configured activity: {exc}")

        resolved = await self._resolve_launch_component(serial, pkg)
        if resolved and resolved not in {configured, f"{pkg}/{configured}"}:
            try:
                await self._start_component(serial, resolved)
                return
            except RuntimeError as exc:
                errors.append(f"resolved launcher: {exc}")

        try:
            await self._start_launcher_intent(serial, pkg)
            return
        except RuntimeError as exc:
            errors.append(f"launcher intent: {exc}")

        try:
            await self._start_monkey_launcher(serial, pkg)
            return
        except RuntimeError as exc:
            errors.append(f"monkey launcher: {exc}")

        detail = "; ".join(errors) if errors else "no launch method succeeded"
        raise RuntimeError(f"Failed to launch {pkg} on {serial}: {detail}")

    async def launch_instagram(self, serial: str) -> None:
        package = os.getenv("ANDROID_APP_PACKAGE", "com.instagram.android").strip()
        activity = os.getenv(
            "ANDROID_APP_ACTIVITY",
            "com.instagram.mainactivity.LauncherActivity",
        ).strip()
        await self.launch_app(serial, package, activity)

    async def get_screen_size(self, serial: str) -> tuple[int, int] | None:
        try:
            _, out, _ = await self._adb(
                serial, "shell", "wm", "size", timeout_seconds=4.0
            )
        except RuntimeError as exc:
            logger.debug("wm size failed for %s: %s", serial, exc)
            return None
        # Example: "Physical size: 1080x2400" or "Override size: 1080x2400"
        match = re.search(r"(\d+)x(\d+)", out)
        if not match:
            return None
        return int(match.group(1)), int(match.group(2))
