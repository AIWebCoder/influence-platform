import asyncio
import json
import logging
from typing import Any, Optional

import httpx

from src.core.config import settings
from src.services.pipeline_trace import emit

logger = logging.getLogger(__name__)


def _extract_video_url_from_payload(payload: dict[str, Any]) -> Optional[str]:
    """Handle multiple Kie response shapes for generated media URL."""
    if not isinstance(payload, dict):
        return None

    data = payload.get("data") or {}
    candidates: list[Any] = [
        ((data.get("response") or {}).get("resultUrls") or [None])[0] if isinstance((data.get("response") or {}).get("resultUrls"), list) else None,
        (data.get("response") or {}).get("resultUrl"),
        data.get("resultUrl"),
        data.get("result_url"),
        data.get("videoUrl"),
        data.get("video_url"),
        data.get("url"),
    ]

    outputs = data.get("output")
    if isinstance(outputs, list) and outputs:
        first = outputs[0] if isinstance(outputs[0], dict) else {}
        candidates.extend([first.get("url"), first.get("video_url"), first.get("videoUrl")])
    elif isinstance(outputs, dict):
        candidates.extend([outputs.get("url"), outputs.get("video_url"), outputs.get("videoUrl")])

    # Kie can return the final URL inside a JSON-encoded string field: data.resultJson
    result_json = data.get("resultJson") or data.get("result_json")
    if isinstance(result_json, str) and result_json.strip():
        try:
            parsed = json.loads(result_json)
            if isinstance(parsed, dict):
                urls = parsed.get("resultUrls") or parsed.get("result_urls")
                if isinstance(urls, list) and urls:
                    candidates.append(urls[0])
                candidates.extend(
                    [
                        parsed.get("resultUrl"),
                        parsed.get("result_url"),
                        parsed.get("url"),
                        parsed.get("videoUrl"),
                        parsed.get("video_url"),
                    ]
                )
        except Exception:
            # Keep best-effort extraction resilient.
            pass

    for val in candidates:
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


class SeedanceService:
    def __init__(self) -> None:
        self.base_url = (settings.SEEDANCE_BASE_URL or "").rstrip("/")
        self.api_key = settings.resolved_seedance_api_key()
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def generate_video(
        self,
        prompt: str,
        duration: int = 5,
        aspect_ratio: str = "9:16",
        trace: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        tb = trace or {}
        if not self.api_key:
            return {"video_url": None, "status": "failed", "error": "NO_SEEDANCE_API_KEY"}
        if not self.base_url:
            return {"video_url": None, "status": "failed", "error": "NO_SEEDANCE_BASE_URL"}

        create_url = f"{self.base_url}/api/v1/jobs/createTask"
        payload = {
            "model": "bytedance/seedance-2",
            "input": {
                "prompt": (prompt or "").strip(),
                "aspect_ratio": aspect_ratio,
                "duration": int(duration),
                "resolution": "720p",
                "generate_audio": False,
            },
        }

        emit(
            "seedance_video_request",
            job_id=tb.get("job_id"),
            step=tb.get("step"),
            endpoint=create_url,
            model=payload["model"],
            prompt_preview=(payload["input"]["prompt"][:500] + "...")
            if len(payload["input"]["prompt"]) > 500
            else payload["input"]["prompt"],
            aspect_ratio=aspect_ratio,
            duration=int(duration),
        )

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                create_resp = await client.post(create_url, json=payload, headers=self.headers)
                create_body = (create_resp.text or "")[:1200]
                emit(
                    "seedance_video_create_response",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    status_code=create_resp.status_code,
                    body_preview=create_body,
                )
                if create_resp.status_code >= 400:
                    return {"video_url": None, "status": "failed", "error": f"HTTP_{create_resp.status_code}"}

                data = create_resp.json()
                if not isinstance(data, dict):
                    return {"video_url": None, "status": "failed", "error": "INVALID_CREATE_RESPONSE"}

                kie_code = data.get("code")
                if kie_code not in (None, 200, "200"):
                    msg = str(data.get("msg") or data.get("message") or "CREATE_TASK_FAILED")
                    return {"video_url": None, "status": "failed", "error": f"KIE_{kie_code}:{msg}"}

                d = data.get("data") or {}
                task_id = (
                    d.get("taskId")
                    or d.get("taskID")
                    or d.get("task_id")
                    or d.get("jobId")
                    or d.get("job_id")
                    or data.get("taskId")
                    or data.get("taskID")
                    or data.get("task_id")
                    or data.get("jobId")
                    or data.get("job_id")
                )
                if not task_id:
                    msg = str(data.get("msg") or data.get("message") or "NO_TASK_ID")
                    return {"video_url": None, "status": "failed", "error": f"NO_TASK_ID:{msg}"}

                poll_url = f"{self.base_url}/api/v1/jobs/recordInfo?taskId={task_id}"
                max_polls = max(1, int(getattr(settings, "GENERATION_KIE_MAX_POLLS", 60)))
                for attempt in range(max_polls):
                    await asyncio.sleep(5)
                    poll_resp = await client.get(poll_url, headers=self.headers)
                    poll_body = (poll_resp.text or "")[:1200]
                    emit(
                        "seedance_video_poll",
                        job_id=tb.get("job_id"),
                        step=tb.get("step"),
                        task_id=task_id,
                        attempt=attempt + 1,
                        status_code=poll_resp.status_code,
                        body_preview=poll_body,
                    )
                    if poll_resp.status_code >= 400:
                        continue
                    pdata = poll_resp.json()
                    if not isinstance(pdata, dict):
                        continue

                    data_obj = pdata.get("data") or {}
                    raw_status = (
                        data_obj.get("status")
                        or data_obj.get("state")
                        or pdata.get("status")
                        or pdata.get("state")
                    )
                    normalized_status = str(raw_status or "").strip().upper()

                    if normalized_status in ("SUCCESS", "SUCCEEDED", "DONE", "COMPLETED"):
                        video_url = _extract_video_url_from_payload(pdata)
                        if video_url:
                            return {"video_url": str(video_url), "status": "success", "error": None}
                        emit(
                            "seedance_video_success_no_url",
                            job_id=tb.get("job_id"),
                            step=tb.get("step"),
                            task_id=task_id,
                            body_preview=(poll_resp.text or "")[:1200],
                            level="warning",
                        )
                        return {"video_url": None, "status": "failed", "error": "NO_VIDEO_URL"}

                    if normalized_status in ("FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"):
                        return {"video_url": None, "status": "failed", "error": f"TASK_{normalized_status}"}

                return {"video_url": None, "status": "failed", "error": "TIMEOUT"}
        except Exception as e:
            logger.error("Seedance video generation failed: %s", e)
            emit(
                "seedance_video_exception",
                job_id=tb.get("job_id"),
                step=tb.get("step"),
                error=str(e),
                level="error",
            )
            return {"video_url": None, "status": "failed", "error": str(e)}
