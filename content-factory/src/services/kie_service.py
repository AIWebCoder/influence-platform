import logging
import asyncio
import httpx
import json
from typing import Any, Optional

from src.core.config import settings
from src.services.pipeline_trace import emit

logger = logging.getLogger(__name__)

KIE_BASE = "https://api.kie.ai"
POLL_INTERVAL_SECONDS = 5

_KIE_VIDEO_ASPECT_RATIOS = frozenset({"9:16", "16:9", "1:1", "4:3", "3:4", "2:3"})


def _normalize_duration(duration: int | str) -> str:
    if isinstance(duration, str):
        duration = int(duration.strip())
    if duration not in (3, 4, 5):
        raise ValueError("Invalid duration")
    return str(int(duration))


def _kie_video_retryable_terminal(terminal_status: str) -> bool:
    if terminal_status in ("TIMEOUT", "SUCCESS_NO_URLS"):
        return True
    if terminal_status.startswith("KIE_HTTP_"):
        suffix = terminal_status[9:]  # after "KIE_HTTP_"
        if suffix.isdigit():
            return int(suffix) >= 500
    return False


def _kie_video_result(
    url: Optional[str],
    polls: int,
    terminal_status: str,
    task_id: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "url": url,
        "polls": polls,
        "terminal_status": terminal_status,
        "task_id": task_id,
        "retryable": _kie_video_retryable_terminal(terminal_status),
    }


def _headers_for_log(headers: dict[str, str]) -> dict[str, str]:
    out = {k: v for k, v in headers.items() if k.lower() != "authorization"}
    auth = headers.get("Authorization") or ""
    out["Authorization"] = "Bearer ***" if auth.startswith("Bearer ") else "(set)"
    return out


def _payload_for_log(payload: dict[str, Any], prompt_max: int = 600) -> dict[str, Any]:
    """Copy payload with truncated prompt for logs (no secrets in body)."""
    out = json.loads(json.dumps(payload))
    inp = out.get("input") or {}
    if isinstance(inp, dict) and "prompt" in inp:
        p = str(inp.get("prompt") or "")
        inp = {**inp, "prompt": (p[:prompt_max] + "…") if len(p) > prompt_max else p}
        out["input"] = inp
    return out


def _validate_kie_video_inputs(prompt: str, aspect_ratio: str) -> Optional[str]:
    """Return terminal_status for client error, or None if inputs are OK (duration via _normalize_duration)."""
    if not (prompt or "").strip():
        return "INVALID_PROMPT"
    if aspect_ratio not in _KIE_VIDEO_ASPECT_RATIOS:
        return "INVALID_ASPECT_RATIO"
    return None


def _kie_max_polls() -> int:
    n = max(1, int(getattr(settings, "GENERATION_KIE_MAX_POLLS", 60)))
    if getattr(settings, "GENERATION_DEMO_MODE", False):
        cap = max(1, int(getattr(settings, "GENERATION_DEMO_KIE_MAX_POLLS", 12)))
        n = min(n, cap)
    return n


def _video_success_wait_polls() -> int:
    return max(1, int(getattr(settings, "GENERATION_VIDEO_SUCCESS_WAIT_POLLS", 8)))


class KieService:
    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {settings.KIE_API_KEY}",
            "Content-Type": "application/json",
        }

    def _trace_base(self, trace: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not trace:
            return {}
        keys = ("job_id", "scene_id", "step", "scene_index")
        return {k: trace[k] for k in keys if k in trace}

    def _emit_video_create(self, event: str, trace: Optional[dict[str, Any]], **extra: Any) -> None:
        emit(event, **self._trace_base(trace), **{k: v for k, v in extra.items() if v is not None})

    async def generate_image(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        trace: Optional[dict[str, Any]] = None,
    ) -> str | None:
        """
        Generate an image via Kie.ai 4o Image API.
        """
        if not settings.KIE_API_KEY:
            logger.error("KIE_API_KEY is missing.")
            return None

        url = f"{KIE_BASE}/api/v1/gpt4o-image/generate"
        payload = {
            "prompt": prompt,
            "size": aspect_ratio,
            "isEnhance": False,
        }
        tb = self._trace_base(trace)

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                emit(
                    "kie_image_request",
                    endpoint=url,
                    prompt_len=len(prompt),
                    aspect_ratio=aspect_ratio,
                    **tb,
                )
                resp = await client.post(url, json=payload, headers=self.headers)
                resp.raise_for_status()
                data = resp.json()

                if data.get("code") != 200:
                    emit(
                        "kie_image_response_error",
                        endpoint=url,
                        kie_code=data.get("code"),
                        response_summary=str(data)[:800],
                        level="error",
                        **tb,
                    )
                    if data.get("code") == 402:
                        return "ERROR: INSUFFICIENT_CREDITS"
                    return None

                task_id = data.get("data", {}).get("taskId")
                if not task_id:
                    emit(
                        "kie_image_no_task_id",
                        endpoint=url,
                        response_summary=str(data)[:800],
                        level="error",
                        **tb,
                    )
                    return None

                emit("kie_image_task_created", endpoint=url, task_id=task_id, **tb)
                out, polls, terminal = await self._poll_image_task(client, task_id, trace)
                emit(
                    "kie_image_poll_finished",
                    task_id=task_id,
                    poll_attempts=polls,
                    terminal_status=terminal,
                    has_url=bool(out and out != "ERROR: INSUFFICIENT_CREDITS"),
                    **tb,
                )
                return out
            except Exception as e:
                emit("kie_image_exception", error=str(e), level="error", **tb)
                logger.error(f"[KieService] Error starting image generation: {e}")
                return None

    async def _poll_image_task(
        self, client: httpx.AsyncClient, task_id: str, trace: Optional[dict[str, Any]] = None
    ) -> tuple[str | None, int, str]:
        poll_url = f"{KIE_BASE}/api/v1/gpt4o-image/record-info?taskId={task_id}"
        tb = self._trace_base(trace)
        max_polls = _kie_max_polls()

        for attempt in range(max_polls):
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            try:
                resp = await client.get(poll_url, headers=self.headers)
                resp.raise_for_status()
                data = resp.json()

                if data.get("code") != 200:
                    logger.warning(f"[KieService] Unexpected poll response: {data}")
                    continue

                status = data.get("data", {}).get("status")
                last_status = str(status or "UNKNOWN")
                if status == "SUCCESS":
                    result_urls = data.get("data", {}).get("response", {}).get("resultUrls", [])
                    if result_urls:
                        return result_urls[0], attempt + 1, "SUCCESS"
                    return None, attempt + 1, "SUCCESS_NO_URLS"
                elif status in ["FAILED", "FAIL", "ERROR", "CANCELED"]:
                    logger.error(f"[KieService] Image task failed: {data}")
                    return None, attempt + 1, str(status)
            except Exception as e:
                logger.warning(f"[KieService] Poll error (attempt {attempt + 1}): {e}")
                emit(
                    "kie_image_poll_error",
                    task_id=task_id,
                    attempt=attempt + 1,
                    error=str(e),
                    level="warning",
                    **tb,
                )

        emit(
            "kie_image_timeout",
            task_id=task_id,
            max_polls=max_polls,
            level="error",
            **tb,
        )
        logger.error(f"[KieService] Image job {task_id} timed out after {max_polls * POLL_INTERVAL_SECONDS}s")
        return None, max_polls, "TIMEOUT"

    async def generate_video(
        self,
        prompt: str,
        duration: int | str = 5,
        aspect_ratio: str = "9:16",
        trace: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """
        Generate a video via Kie.ai jobs API.

        Returns a dict: url (str|None), polls, terminal_status, task_id, retryable.
        url may be \"ERROR: INSUFFICIENT_CREDITS\" when Kie returns 402.
        """
        if not settings.KIE_API_KEY:
            logger.error("KIE_API_KEY is missing.")
            return _kie_video_result(None, 0, "NO_API_KEY", None)
            
        logger.warning(
            "[DEBUG] BEFORE NORMALIZE duration=%r type=%s prompt_len=%s scene=%s",
            duration,
            type(duration).__name__,
            len(prompt or ""),
            trace.get("scene_index") if trace else None,
        )

        try:
            duration = _normalize_duration(duration)
        except (TypeError, ValueError):
            self._emit_video_create(
                "kie_video_request_failed",
                trace,
                attempt=0,
                status_code=None,
                kie_code=None,
                reason="validation",
                terminal_status="INVALID_DURATION",
                level="error",
            )
            logger.error(
                "[KieService] Kie video create rejected (validation): INVALID_DURATION "
                "prompt_len=%s duration=%r aspect_ratio=%s",
                len(prompt or ""),
                duration,
                aspect_ratio,
            )
            return _kie_video_result(None, 0, "INVALID_DURATION", None)

        invalid = _validate_kie_video_inputs(prompt, aspect_ratio)
        if invalid:
            self._emit_video_create(
                "kie_video_request_failed",
                trace,
                attempt=0,
                status_code=None,
                kie_code=None,
                reason="validation",
                terminal_status=invalid,
                level="error",
            )
            logger.error(
                "[KieService] Kie video create rejected (validation): %s prompt_len=%s duration=%s aspect_ratio=%s",
                invalid,
                len(prompt or ""),
                duration,
                aspect_ratio,
            )
            return _kie_video_result(None, 0, invalid, None)

        url = f"{KIE_BASE}/api/v1/jobs/createTask"
        payload = {
            "model": "kling-2.6/text-to-video",
            "input": {
                "prompt": prompt.strip(),
                "sound": False,
                "aspect_ratio": aspect_ratio,
                "duration": str(duration),
            },
        }
        tb = self._trace_base(trace)
        max_attempts = max(1, int(getattr(settings, "GENERATION_KIE_VIDEO_CREATE_MAX_ATTEMPTS", 3)))

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                task_id: Optional[str] = None
                for attempt in range(1, max_attempts + 1):
                    logger.error(
                        "[KIE_DEBUG] Sending duration=%s type=%s",
                        payload["input"]["duration"],
                        type(payload["input"]["duration"]),
                    )
                    # TEMP: verbose create-task logging (safe: no raw API key; prompt truncated in payload copy)
                    logger.info(
                        "[KieService] TEMP kie_video_create_debug attempt=%s url=%s headers=%s payload=%s",
                        attempt,
                        url,
                        json.dumps(_headers_for_log(self.headers)),
                        json.dumps(_payload_for_log(payload)),
                    )
                    self._emit_video_create(
                        "kie_video_request_sent",
                        trace,
                        attempt=attempt,
                        prompt_len=len(prompt),
                        duration=duration,
                        aspect_ratio=aspect_ratio,
                        endpoint=url,
                        model=payload["model"],
                    )
                    try:
                        emit(
                            "kie_video_http_request",
                            job_id=tb.get("job_id"),
                            step=tb.get("step"),
                            scene_id=tb.get("scene_id"),
                            scene_index=tb.get("scene_index"),
                            attempt=attempt,
                            method="POST",
                            url=url,
                            payload=_payload_for_log(payload),
                        )
                        emit(
                            "kie_video_payload_final",
                            duration=duration,
                            duration_type=type(duration).__name__,
                            aspect_ratio=aspect_ratio,
                            model=payload["model"],
                            prompt_len=len(prompt),
                            **tb,
                        )
                        resp = await client.post(url, json=payload, headers=self.headers)
                        emit(
                            "kie_video_http_response",
                            job_id=tb.get("job_id"),
                            step=tb.get("step"),
                            scene_id=tb.get("scene_id"),
                            scene_index=tb.get("scene_index"),
                            attempt=attempt,
                            status_code=resp.status_code,
                            body=(resp.text or "")[:1000],
                        )
                    except httpx.RequestError as e:
                        emit(
                            "kie_video_http_response",
                            job_id=tb.get("job_id"),
                            step=tb.get("step"),
                            scene_id=tb.get("scene_id"),
                            scene_index=tb.get("scene_index"),
                            attempt=attempt,
                            status_code=None,
                            body=f"{type(e).__name__}: {str(e)[:900]}",
                            transport_error=True,
                            level="error",
                        )
                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            prompt_len=len(prompt),
                            duration=duration,
                            status_code=None,
                            error=type(e).__name__,
                            message=str(e)[:500],
                            level="error",
                        )
                        logger.error(
                            "[KieService] Kie video create transport error: %s: %s",
                            type(e).__name__,
                            e,
                        )
                        if attempt < max_attempts:
                            delay = 2 ** (attempt - 1)
                            self._emit_video_create(
                                "kie_video_request_retry",
                                trace,
                                attempt=attempt,
                                next_attempt=attempt + 1,
                                delay_seconds=delay,
                                reason="request_error",
                            )
                            await asyncio.sleep(delay)
                            continue
                        return _kie_video_result(None, 0, "EXCEPTION", None)

                    if resp.status_code >= 500:
                        raw = (resp.text or "")[:8000]
                        try:
                            err_json = resp.json()
                        except Exception:
                            err_json = None
                        logger.error(
                            "[KieService] Kie video create HTTP %s url=%s body=%s json=%s",
                            resp.status_code,
                            url,
                            raw[:2000],
                            err_json,
                        )
                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            prompt_len=len(prompt),
                            duration=duration,
                            status_code=resp.status_code,
                            response_text_preview=raw[:1500],
                            response_json=err_json,
                            level="error",
                        )
                        if attempt < max_attempts:
                            delay = 2 ** (attempt - 1)
                            self._emit_video_create(
                                "kie_video_request_retry",
                                trace,
                                attempt=attempt,
                                next_attempt=attempt + 1,
                                delay_seconds=delay,
                                status_code=resp.status_code,
                                reason="http_5xx",
                            )
                            await asyncio.sleep(delay)
                            continue
                        return _kie_video_result(None, 0, f"KIE_HTTP_{resp.status_code}", None)

                    if resp.status_code >= 400:
                        raw = (resp.text or "")[:8000]
                        try:
                            err_json = resp.json()
                        except Exception:
                            err_json = None
                        logger.error(
                            "[KieService] Kie video create HTTP %s url=%s body=%s json=%s",
                            resp.status_code,
                            url,
                            raw[:2000],
                            err_json,
                        )
                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            prompt_len=len(prompt),
                            duration=duration,
                            status_code=resp.status_code,
                            response_text_preview=raw[:1500],
                            response_json=err_json,
                            level="error",
                        )
                        return _kie_video_result(None, 0, f"KIE_HTTP_{resp.status_code}", None)

                    try:
                        data: dict[str, Any] = resp.json()
                    except json.JSONDecodeError as je:
                        raw = (resp.text or "")[:2000]
                        logger.error(
                            "[KieService] Kie video create JSON decode error: %s body=%s",
                            je,
                            raw,
                        )
                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            status_code=resp.status_code,
                            reason="invalid_json",
                            response_text_preview=raw[:1500],
                            level="error",
                        )
                        return _kie_video_result(None, 0, "INVALID_RESPONSE", None)

                    if data.get("code") != 200:
                        kc = data.get("code")
                        msg = str(data.get("msg", "")).lower()
                        summary = str(data)[:8000]
                        logger.error(
                            "[KieService] Kie video create API code=%s url=%s response=%s",
                            kc,
                            url,
                            summary[:2000],
                        )
                        emit(
                            "kie_video_response_error",
                            endpoint=url,
                            kie_code=kc,
                            response_summary=str(data)[:2000],
                            level="error",
                            **tb,
                        )
                        if "duration" in msg:
                            self._emit_video_create(
                                "kie_video_request_failed",
                                trace,
                                attempt=attempt,
                                prompt_len=len(prompt),
                                duration=duration,
                                status_code=resp.status_code,
                                kie_code=kc,
                                terminal_status="INVALID_DURATION",
                                response_summary=summary[:1500],
                                reason="kie_msg_duration_validation",
                                level="error",
                            )
                            return _kie_video_result(None, 0, "INVALID_DURATION", None)

                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            prompt_len=len(prompt),
                            duration=duration,
                            status_code=resp.status_code,
                            kie_code=kc,
                            response_summary=summary[:1500],
                            level="error",
                        )
                        kie_int: Optional[int] = None
                        if isinstance(kc, int):
                            kie_int = kc
                        elif isinstance(kc, str) and str(kc).strip().lstrip("-").isdigit():
                            kie_int = int(kc)
                        if kie_int == 402:
                            return _kie_video_result("ERROR: INSUFFICIENT_CREDITS", 0, "INSUFFICIENT_CREDITS", None)
                        if (
                            kie_int is not None
                            and kie_int >= 500
                            and "duration" not in msg
                            and attempt < max_attempts
                        ):
                            delay = 2 ** (attempt - 1)
                            self._emit_video_create(
                                "kie_video_request_retry",
                                trace,
                                attempt=attempt,
                                next_attempt=attempt + 1,
                                delay_seconds=delay,
                                kie_code=kie_int,
                                reason="kie_code_5xx",
                            )
                            await asyncio.sleep(delay)
                            continue
                        return _kie_video_result(None, 0, "KIE_API_ERROR", None)

                    tid = data.get("data", {}).get("taskId")
                    if not tid:
                        emit(
                            "kie_video_no_task_id",
                            response_summary=str(data)[:800],
                            level="error",
                            **tb,
                        )
                        self._emit_video_create(
                            "kie_video_request_failed",
                            trace,
                            attempt=attempt,
                            kie_code=data.get("code"),
                            reason="no_task_id",
                            response_summary=str(data)[:1500],
                            level="error",
                        )
                        return _kie_video_result(None, 0, "NO_TASK_ID", None)

                    task_id = str(tid)
                    break

                if not task_id:
                    return _kie_video_result(None, 0, "KIE_HTTP_UNKNOWN", None)

                emit("kie_video_task_created", endpoint=url, task_id=task_id, **tb)
                out, polls, terminal = await self._poll_video_task(client, task_id, trace)
                emit(
                    "kie_video_poll_finished",
                    task_id=task_id,
                    poll_attempts=polls,
                    polls=polls,
                    terminal_status=terminal,
                    has_url=bool(out and out != "ERROR: INSUFFICIENT_CREDITS"),
                    success=bool(out and out != "ERROR: INSUFFICIENT_CREDITS"),
                    **tb,
                )
                return _kie_video_result(out, polls, terminal, task_id)
            except Exception as e:
                emit("kie_video_exception", error=str(e), level="error", **tb)
                logger.error(f"[KieService] Error starting video generation: {e}")
                return _kie_video_result(None, 0, "EXCEPTION", None)

    async def _poll_video_task(
        self, client: httpx.AsyncClient, task_id: str, trace: Optional[dict[str, Any]] = None
    ) -> tuple[str | None, int, str]:
        poll_url = f"{KIE_BASE}/api/v1/jobs/recordInfo?taskId={task_id}"
        tb = self._trace_base(trace)
        max_polls = _kie_max_polls()
        success_wait_polls = _video_success_wait_polls()
        first_success_poll: Optional[int] = None

        for attempt in range(max_polls):
            if attempt > 0:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
            try:
                resp = await client.get(poll_url, headers=self.headers)
                resp.raise_for_status()
                payload = resp.json()

                if payload.get("code") != 200:
                    logger.warning(f"[KieService] Unexpected poll response: {payload}")
                    emit(
                        "kie_video_poll",
                        job_id=tb.get("job_id"),
                        step=tb.get("step"),
                        scene_id=tb.get("scene_id"),
                        scene_index=tb.get("scene_index"),
                        task_id=task_id,
                        attempt=attempt + 1,
                        state="poll_http_bad_code",
                        kie_code=payload.get("code"),
                        level="warning",
                    )
                    continue

                data = payload.get("data", {})
                raw_state = data.get("state")
                state = (raw_state or "").lower()
                emit(
                    "kie_video_poll",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    scene_id=tb.get("scene_id"),
                    scene_index=tb.get("scene_index"),
                    task_id=task_id,
                    attempt=attempt + 1,
                    state=raw_state or state or None,
                    kie_code=payload.get("code"),
                )

                if state == "processing":
                    first_success_poll = None

                if state == "success":
                    result_urls = []
                    resp_dict = data.get("response") or {}

                    if "resultUrls" in resp_dict:
                        result_urls = resp_dict.get("resultUrls", [])

                    if not result_urls:
                        result_json_str = data.get("resultJson", "{}")
                        try:
                            if result_json_str:
                                result_dict = json.loads(result_json_str)
                                result_urls = result_dict.get("resultUrls", [])
                        except json.JSONDecodeError:
                            logger.error(f"[KieService] Failed to parse resultJson: {result_json_str}")

                    if result_urls:
                        emit(
                            "kie_video_url_ready",
                            task_id=task_id,
                            attempt=attempt + 1,
                            **tb,
                        )
                        return result_urls[0], attempt + 1, "SUCCESS"

                    if first_success_poll is None:
                        first_success_poll = attempt

                    waited_polls = attempt - first_success_poll
                    emit(
                        "kie_video_empty_success_wait",
                        task_id=task_id,
                        attempt=attempt + 1,
                        waited_polls=waited_polls,
                        **tb,
                    )

                    if waited_polls >= success_wait_polls:
                        emit(
                            "kie_video_success_timeout",
                            task_id=task_id,
                            waited_polls=waited_polls,
                            success_wait_polls=success_wait_polls,
                            level="error",
                            **tb,
                        )
                        logger.error(
                            f"[KieService] Video task state=success but no resultUrls after "
                            f"{waited_polls} empty-success polls (cap={success_wait_polls}): {data}"
                        )
                        return None, attempt + 1, "SUCCESS_NO_URLS"
                    continue
                elif state in ["failed", "fail", "error", "canceled"]:
                    fail_msg = data.get("failMsg", "Unknown failure")
                    logger.error(f"[KieService] Video task failed: {fail_msg}")
                    return None, attempt + 1, str(state)
            except Exception as e:
                logger.warning(f"[KieService] Poll error (attempt {attempt + 1}): {e}")
                emit(
                    "kie_video_poll_error",
                    task_id=task_id,
                    attempt=attempt + 1,
                    error=str(e),
                    level="warning",
                    **tb,
                )

        emit(
            "kie_video_timeout",
            task_id=task_id,
            max_polls=max_polls,
            level="error",
            **tb,
        )
        logger.error(f"[KieService] Video job {task_id} timed out after {max_polls * POLL_INTERVAL_SECONDS}s")
        return None, max_polls, "TIMEOUT"
