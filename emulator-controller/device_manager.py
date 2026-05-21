import asyncio
import logging
import os
import re
import shutil
import time
from dataclasses import dataclass
from typing import Any, List


logger = logging.getLogger(__name__)


@dataclass
class EmulatorDevice:
    serial: str
    status: str
    model: str | None = None
    transport_id: str | None = None


class DeviceManager:
    def __init__(self, adb_path: str | None = None) -> None:
        self.adb_path = adb_path or os.getenv("ADB_PATH", "adb")
        self.adb_host = os.getenv("ADB_HOST", "").strip()
        self.adb_port = os.getenv("ADB_PORT", "5037").strip()
        self.emulator_path = os.getenv("EMULATOR_PATH", "emulator").strip()

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
            if not serial.startswith("emulator-"):
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

    async def launch_app(
        self,
        serial: str,
        package: str,
        activity: str | None = None,
    ) -> None:
        pkg = str(package or "").strip()
        if not pkg:
            raise ValueError("package is required")
        act = str(activity or "").strip()
        if act:
            if "/" in act:
                component = act
            else:
                component = f"{pkg}/{act}"
            await self._adb(serial, "shell", "am", "start", "-W", "-n", component)
            return
        await self._adb(
            serial,
            "shell",
            "monkey",
            "-p",
            pkg,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        )

    async def launch_instagram(self, serial: str) -> None:
        package = os.getenv("ANDROID_APP_PACKAGE", "com.instagram.android").strip()
        activity = os.getenv(
            "ANDROID_APP_ACTIVITY",
            "com.instagram.mainactivity.MainActivity",
        ).strip()
        await self.launch_app(serial, package, activity)

    async def get_screen_size(self, serial: str) -> tuple[int, int] | None:
        _, out, _ = await self._adb(serial, "shell", "wm", "size")
        # Example: "Physical size: 1080x2400"
        match = re.search(r"(\d+)x(\d+)", out)
        if not match:
            return None
        return int(match.group(1)), int(match.group(2))
