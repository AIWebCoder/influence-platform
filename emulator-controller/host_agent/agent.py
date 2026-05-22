"""Host-side helper that exposes the local Android SDK ``emulator`` binary
over HTTP, so the dockerized ``emulator-controller`` can list and launch
AVDs that live on the host machine.

Run this on the same machine as the Android SDK (the one with
``$ANDROID_SDK_ROOT/emulator/emulator`` available). The dockerized
controller reaches it via ``host.docker.internal`` (Docker Desktop) or via
the host gateway IP on Linux (``--add-host=host.docker.internal:host-gateway``
is set by default in compose).

Endpoints:
    GET  /healthz          -> {"ok": true}
    GET  /avds             -> {"count": N, "items": ["Pixel_5_API_34", ...]}
    POST /launch           -> {"success": true, "avd_name": "...", "pid": 1234}
        body: {"avd_name": "Pixel_5_API_34", "headless": true, "extra_args": []}
    POST /stop             -> {"success": true, "serial": "emulator-5556"}
        body: {"serial": "emulator-5556"}  (runs host-local ``adb emu kill``)

All non-health endpoints require ``Authorization: Bearer <token>`` if the
``EMULATOR_AGENT_TOKEN`` environment variable is set.

Config (env vars):
    EMULATOR_AGENT_HOST   bind host (default 127.0.0.1, set 0.0.0.0 for Docker)
    EMULATOR_AGENT_PORT   bind port (default 19200)
    EMULATOR_AGENT_TOKEN  required bearer token; if empty, auth is disabled
    EMULATOR_PATH         path to the ``emulator`` binary (default: discover via PATH)
    ANDROID_SDK_ROOT      forwarded to the launched emulator process
    ANDROID_AVD_HOME      forwarded to the launched emulator process
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import sys
import tempfile
import time
from typing import Any

from aiohttp import web


LAUNCH_LOG_DIR = os.getenv("EMULATOR_AGENT_LAUNCH_LOG_DIR", "/tmp/emulator-host-agent")


AVD_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
EMULATOR_SERIAL_RE = re.compile(r"^emulator-\d+$")
ADB_CONNECT_TARGET_RE = re.compile(r"^(?P<host>[A-Za-z0-9._-]+):(?P<port>\d{1,5})$")

logger = logging.getLogger("emulator-host-agent")


def _sdk_emulator_candidates(root: str) -> list[str]:
    emu_dir = os.path.join(root, "emulator")
    if sys.platform == "win32":
        return [os.path.join(emu_dir, "emulator.exe"), os.path.join(emu_dir, "emulator")]
    return [os.path.join(emu_dir, "emulator")]


def _resolve_adb_binary() -> str | None:
    explicit = os.getenv("ADB_PATH", "").strip()
    if explicit:
        if os.path.isfile(explicit):
            return explicit
        which = shutil.which(explicit)
        if which:
            return which
    discovered = shutil.which("adb") or (
        shutil.which("adb.exe") if sys.platform == "win32" else None
    )
    if discovered:
        return discovered
    for root_env in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        root = os.getenv(root_env, "").strip()
        if not root:
            continue
        platform_tools = os.path.join(root, "platform-tools", "adb")
        if sys.platform == "win32":
            platform_tools = platform_tools + ".exe"
        if os.path.isfile(platform_tools):
            return platform_tools
    return None


def _valid_stop_serial(serial: str) -> bool:
    if not serial:
        return False
    if EMULATOR_SERIAL_RE.match(serial):
        return True
    return bool(ADB_CONNECT_TARGET_RE.match(serial))


def _resolve_emulator_binary() -> str | None:
    explicit = os.getenv("EMULATOR_PATH", "").strip()
    if explicit:
        if os.path.isfile(explicit) and os.access(explicit, os.X_OK):
            return explicit
        which = shutil.which(explicit)
        if which:
            return which
    discovered = shutil.which("emulator") or (
        shutil.which("emulator.exe") if sys.platform == "win32" else None
    )
    if discovered:
        return discovered
    for root_env in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        root = os.getenv(root_env, "").strip()
        if not root:
            continue
        for candidate in _sdk_emulator_candidates(root):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return None


def _emulator_env() -> dict[str, str]:
    return os.environ.copy()


def _require_auth(request: web.Request, expected_token: str | None) -> web.Response | None:
    if not expected_token:
        return None
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return web.json_response({"error": "missing_bearer_token"}, status=401)
    token = header.split(" ", 1)[1].strip()
    if token != expected_token:
        return web.json_response({"error": "invalid_token"}, status=403)
    return None


async def healthz(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "emulator": _resolve_emulator_binary()})


def _detect_linux_kvm() -> dict[str, Any]:
    cpu_flags: list[str] = []
    try:
        with open("/proc/cpuinfo") as fh:
            for line in fh:
                if line.startswith(("flags", "Features")):
                    cpu_flags = line.split(":", 1)[1].strip().split()
                    break
    except OSError:
        pass

    has_virt_flag = any(flag in cpu_flags for flag in ("vmx", "svm"))
    dev_kvm_exists = os.path.exists("/dev/kvm")
    dev_kvm_rw = False
    if dev_kvm_exists:
        try:
            dev_kvm_rw = os.access("/dev/kvm", os.R_OK | os.W_OK)
        except OSError:
            dev_kvm_rw = False

    ready = has_virt_flag and dev_kvm_exists and dev_kvm_rw

    if ready:
        message = "KVM is available."
    elif not has_virt_flag:
        message = (
            "CPU does not expose vmx/svm. The hypervisor running this host has "
            "not enabled nested virtualization for this VM."
        )
    elif not dev_kvm_exists:
        message = (
            "/dev/kvm is missing. CPU exposes virt extensions but the kvm module "
            "may not be loaded (try `modprobe kvm_intel` or `modprobe kvm_amd`)."
        )
    else:
        message = "/dev/kvm exists but is not readable/writable by the agent process."

    return {
        "ready": ready,
        "backend": "kvm",
        "host_platform": "linux",
        "has_virt_flag": has_virt_flag,
        "dev_kvm_exists": dev_kvm_exists,
        "dev_kvm_readable": dev_kvm_rw,
        "message": message,
    }


async def _detect_acceleration(binary: str | None) -> dict[str, Any]:
    """Platform-aware virtualization check (KVM on Linux, emulator -accel-check elsewhere)."""
    if sys.platform == "win32":
        backend = "whpx"
        if not binary:
            return {
                "ready": False,
                "backend": backend,
                "host_platform": "windows",
                "message": "emulator binary not found on Windows host",
            }
        proc = await asyncio.create_subprocess_exec(
            binary,
            "-accel-check",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=_emulator_env(),
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {
                "ready": False,
                "backend": backend,
                "host_platform": "windows",
                "message": "emulator -accel-check timed out",
            }
        text = out.decode(errors="ignore").strip()
        ready = proc.returncode == 0 and "usable" in text.lower()
        return {
            "ready": ready,
            "backend": backend,
            "host_platform": "windows",
            "message": text or "emulator -accel-check returned no output",
            "accel_check_exit_code": proc.returncode,
        }

    if sys.platform == "darwin":
        backend = "hvf"
        if not binary:
            return {
                "ready": False,
                "backend": backend,
                "host_platform": "darwin",
                "message": "emulator binary not found on macOS host",
            }
        proc = await asyncio.create_subprocess_exec(
            binary,
            "-accel-check",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=_emulator_env(),
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {
                "ready": False,
                "backend": backend,
                "host_platform": "darwin",
                "message": "emulator -accel-check timed out",
            }
        text = out.decode(errors="ignore").strip()
        ready = proc.returncode == 0 and (
            "usable" in text.lower() or "hvf" in text.lower() or "enabled" in text.lower()
        )
        return {
            "ready": ready,
            "backend": backend,
            "host_platform": "darwin",
            "message": text or "emulator -accel-check returned no output",
            "accel_check_exit_code": proc.returncode,
        }

    linux = _detect_linux_kvm()
    linux["host_platform"] = "linux"
    return linux


def make_app(expected_token: str | None) -> web.Application:
    async def list_avds(request: web.Request) -> web.Response:
        unauthorized = _require_auth(request, expected_token)
        if unauthorized is not None:
            return unauthorized

        binary = _resolve_emulator_binary()
        if not binary:
            return web.json_response(
                {
                    "count": 0,
                    "items": [],
                    "error": (
                        "emulator binary not found on host; set EMULATOR_PATH or "
                        "ANDROID_SDK_ROOT before starting the agent"
                    ),
                },
                status=503,
            )

        proc = await asyncio.create_subprocess_exec(
            binary,
            "-list-avds",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_emulator_env(),
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=15)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return web.json_response(
                {"count": 0, "items": [], "error": "emulator -list-avds timed out"},
                status=504,
            )

        if proc.returncode != 0:
            return web.json_response(
                {
                    "count": 0,
                    "items": [],
                    "error": err.decode(errors="ignore").strip()
                    or f"emulator -list-avds exited with {proc.returncode}",
                },
                status=500,
            )

        names: list[str] = []
        for line in out.decode(errors="ignore").splitlines():
            name = line.strip()
            if name and AVD_NAME_RE.match(name):
                names.append(name)
        return web.json_response({"count": len(names), "items": names})

    async def launch(request: web.Request) -> web.Response:
        unauthorized = _require_auth(request, expected_token)
        if unauthorized is not None:
            return unauthorized

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json_body"}, status=400)

        avd_name = str(payload.get("avd_name") or "").strip()
        if not AVD_NAME_RE.match(avd_name):
            return web.json_response({"error": "invalid_avd_name"}, status=400)

        headless = bool(payload.get("headless", True))
        extra_args = payload.get("extra_args") or []
        if not isinstance(extra_args, list) or not all(isinstance(a, str) for a in extra_args):
            return web.json_response({"error": "invalid_extra_args"}, status=400)

        binary = _resolve_emulator_binary()
        if not binary:
            return web.json_response(
                {"error": "emulator_binary_not_found"},
                status=503,
            )

        args = [binary, "-avd", avd_name, "-no-snapshot-load", "-no-metrics"]
        if headless:
            args.extend(["-no-window", "-no-audio", "-no-boot-anim", "-gpu", "swiftshader_indirect"])
        args.extend(extra_args)

        os.makedirs(LAUNCH_LOG_DIR, exist_ok=True)
        log_fd, log_path = tempfile.mkstemp(
            prefix=f"{avd_name}-",
            suffix=".log",
            dir=LAUNCH_LOG_DIR,
        )

        import subprocess

        try:
            proc = subprocess.Popen(
                args,
                stdout=log_fd,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
                env=_emulator_env(),
            )
        finally:
            os.close(log_fd)

        await asyncio.sleep(0.8)
        if proc.poll() not in (None, 0):
            tail = ""
            best_line = ""
            try:
                with open(log_path, "rb") as fh:
                    raw = fh.read()[-4096:]
                tail = raw.decode("utf-8", errors="replace").strip()
                for line in tail.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        continue
                    upper = stripped.upper()
                    if "FATAL" in upper or "ERROR" in upper:
                        best_line = stripped
                        break
                if not best_line and tail:
                    for line in reversed(tail.splitlines()):
                        stripped = line.strip()
                        if stripped:
                            best_line = stripped
                            break
            except OSError:
                pass

            return web.json_response(
                {
                    "success": False,
                    "avd_name": avd_name,
                    "pid": proc.pid,
                    "exit_code": proc.returncode,
                    "error": (
                        f"emulator exited immediately with {proc.returncode}"
                        + (f": {best_line}" if best_line else "")
                    ),
                    "log_path": log_path,
                    "log_tail": tail,
                },
                status=500,
            )

        logger.info(
            "emulator_launched avd=%s pid=%s headless=%s log=%s",
            avd_name,
            proc.pid,
            headless,
            log_path,
        )
        return web.json_response(
            {
                "success": True,
                "avd_name": avd_name,
                "pid": proc.pid,
                "headless": headless,
                "started_at": int(time.time()),
                "log_path": log_path,
            }
        )

    async def preflight(request: web.Request) -> web.Response:
        unauthorized = _require_auth(request, expected_token)
        if unauthorized is not None:
            return unauthorized

        binary = _resolve_emulator_binary()
        accel = await _detect_acceleration(binary)
        kvm = accel
        avds: list[str] = []
        avds_error: str | None = None
        if binary:
            proc = await asyncio.create_subprocess_exec(
                binary,
                "-list-avds",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=_emulator_env(),
            )
            try:
                out, err = await asyncio.wait_for(proc.communicate(), timeout=10)
                if proc.returncode == 0:
                    for line in out.decode(errors="ignore").splitlines():
                        n = line.strip()
                        if n and AVD_NAME_RE.match(n):
                            avds.append(n)
                else:
                    avds_error = err.decode(errors="ignore").strip() or "list-avds failed"
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
                avds_error = "list-avds timed out"

        ready = bool(binary) and accel["ready"] and bool(avds)
        if ready:
            verdict = "ready"
        elif not binary:
            verdict = "no_emulator_binary"
        elif not accel["ready"]:
            verdict = "no_accel" if sys.platform in ("win32", "darwin") else "no_kvm"
        elif not avds:
            verdict = "no_avd"
        else:
            verdict = "unknown"

        return web.json_response(
            {
                "ready": ready,
                "verdict": verdict,
                "host_platform": accel.get("host_platform"),
                "emulator_binary": binary,
                "kvm": kvm,
                "acceleration": accel,
                "avds": avds,
                "avds_error": avds_error,
            }
        )

    app = web.Application()
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/avds", list_avds)
    app.router.add_get("/preflight", preflight)
    async def stop(request: web.Request) -> web.Response:
        """Stop an emulator via host-local adb (required for ``emu kill`` from Docker)."""
        unauthorized = _require_auth(request, expected_token)
        if unauthorized is not None:
            return unauthorized

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "invalid_json_body"}, status=400)

        serial = str(payload.get("serial") or "").strip()
        if not _valid_stop_serial(serial):
            return web.json_response({"error": "invalid_serial"}, status=400)

        adb = _resolve_adb_binary()
        if not adb:
            return web.json_response(
                {"success": False, "serial": serial, "error": "adb_binary_not_found"},
                status=503,
            )

        started = time.monotonic()
        if serial.startswith("emulator-"):
            proc = await asyncio.create_subprocess_exec(
                adb,
                "-s",
                serial,
                "emu",
                "kill",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        else:
            proc = await asyncio.create_subprocess_exec(
                adb,
                "disconnect",
                serial,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=20)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return web.json_response(
                {
                    "success": False,
                    "serial": serial,
                    "phase": "stop_timeout",
                    "message": "adb stop timed out",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                },
                status=504,
            )

        stdout_s = out.decode(errors="ignore").strip()
        stderr_s = err.decode(errors="ignore").strip()
        combined = (stdout_s + "\n" + stderr_s).lower()
        elapsed_ms = int((time.monotonic() - started) * 1000)

        if proc.returncode == 0:
            return web.json_response(
                {
                    "success": True,
                    "serial": serial,
                    "phase": "completed",
                    "message": stdout_s or stderr_s or "Emulator session ended",
                    "elapsed_ms": elapsed_ms,
                }
            )

        # Emulator may already be gone (stale adb entry).
        if "connection refused" in combined or "not found" in combined or "unknown" in combined:
            return web.json_response(
                {
                    "success": True,
                    "serial": serial,
                    "phase": "already_stopped",
                    "message": (
                        f"{serial} is no longer reachable via adb "
                        f"({stderr_s or stdout_s or 'already stopped'})"
                    ),
                    "elapsed_ms": elapsed_ms,
                }
            )

        return web.json_response(
            {
                "success": False,
                "serial": serial,
                "phase": "stop_failed",
                "message": stderr_s or stdout_s or f"adb exited with {proc.returncode}",
                "elapsed_ms": elapsed_ms,
            },
            status=500,
        )

    app.router.add_post("/launch", launch)
    app.router.add_post("/stop", stop)
    return app


def main() -> int:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    host = os.getenv("EMULATOR_AGENT_HOST", "127.0.0.1").strip() or "127.0.0.1"
    try:
        port = int(os.getenv("EMULATOR_AGENT_PORT", "19200"))
    except ValueError:
        logger.error("EMULATOR_AGENT_PORT must be an integer")
        return 2

    expected_token = os.getenv("EMULATOR_AGENT_TOKEN", "").strip() or None
    if not expected_token:
        logger.warning(
            "EMULATOR_AGENT_TOKEN is empty; agent is running without auth. "
            "Bind to 127.0.0.1 or set a token before exposing it."
        )

    binary = _resolve_emulator_binary()
    if binary:
        logger.info("emulator binary: %s", binary)
    else:
        logger.warning(
            "emulator binary not found at startup; /avds and /launch will return 503 "
            "until EMULATOR_PATH or ANDROID_SDK_ROOT is configured."
        )

    app = make_app(expected_token)
    logger.info("emulator-host-agent listening on %s:%s", host, port)
    web.run_app(app, host=host, port=port, print=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
