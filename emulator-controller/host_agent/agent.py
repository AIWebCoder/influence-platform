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

logger = logging.getLogger("emulator-host-agent")


def _resolve_emulator_binary() -> str | None:
    explicit = os.getenv("EMULATOR_PATH", "").strip()
    if explicit:
        if os.path.isfile(explicit) and os.access(explicit, os.X_OK):
            return explicit
        which = shutil.which(explicit)
        if which:
            return which
    discovered = shutil.which("emulator")
    if discovered:
        return discovered
    for root_env in ("ANDROID_SDK_ROOT", "ANDROID_HOME"):
        root = os.getenv(root_env, "").strip()
        if not root:
            continue
        candidate = os.path.join(root, "emulator", "emulator")
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


def _detect_kvm() -> dict[str, Any]:
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
        "has_virt_flag": has_virt_flag,
        "dev_kvm_exists": dev_kvm_exists,
        "dev_kvm_readable": dev_kvm_rw,
        "message": message,
    }


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
        kvm = _detect_kvm()
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

        ready = bool(binary) and kvm["ready"] and bool(avds)
        if ready:
            verdict = "ready"
        elif not binary:
            verdict = "no_emulator_binary"
        elif not kvm["ready"]:
            verdict = "no_kvm"
        elif not avds:
            verdict = "no_avd"
        else:
            verdict = "unknown"

        return web.json_response(
            {
                "ready": ready,
                "verdict": verdict,
                "emulator_binary": binary,
                "kvm": kvm,
                "avds": avds,
                "avds_error": avds_error,
            }
        )

    app = web.Application()
    app.router.add_get("/healthz", healthz)
    app.router.add_get("/avds", list_avds)
    app.router.add_get("/preflight", preflight)
    app.router.add_post("/launch", launch)
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
