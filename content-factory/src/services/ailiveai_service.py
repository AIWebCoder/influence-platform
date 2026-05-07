"""AliveAI image-to-video: POST /prompts/image-to-video, GET /prompts/{promptId}."""
import asyncio
import logging
from typing import Any, Optional

import httpx

from src.core.config import settings
from src.services.pipeline_trace import emit

logger = logging.getLogger(__name__)
_VALID_VIDEO_MODELS = frozenset({"DEFAULT", "AUDIO", "GROK", "SEEDANCE"})
_ALIVEAI_CREATE_API = "https://api.aliveai.app"
_ALIVEAI_POLL_API = "https://api-server.aliveai.app"


def _normalize_aliveai_create_base(raw: str) -> str:
    """OpenAPI: POST ``/prompts`` and ``/prompts/image-to-video`` are served from ``api.aliveai.app`` only."""
    u = (raw or "").strip().rstrip("/")
    if not u:
        return _ALIVEAI_CREATE_API
    if "api-server.aliveai.app" in u.lower().replace("http://", "https://"):
        logger.warning(
            "AILIVEAI_BASE_URL must not be api-server (GET/poll host); using %s for POST creates (was %s)",
            _ALIVEAI_CREATE_API,
            raw,
        )
        return _ALIVEAI_CREATE_API
    return u


def _looks_like_jwt(secret: str) -> bool:
    """AliveAI member ``accessToken`` is typically a JWT (header segment often starts with ``eyJ``)."""
    v = (secret or "").strip()
    parts = v.split(".")
    if len(parts) != 3 or not all(parts):
        return False
    return parts[0].startswith("eyJ")


def _effective_auth_mode(secret: str, *, credential_from_api_token_env: bool) -> str:
    """``AILIVEAI_API_TOKEN`` is always sent as Bearer (member accessToken). ``AILIVEAI_API_KEY``-only honors AUTH_MODE."""
    mode = str(getattr(settings, "AILIVEAI_AUTH_MODE", "auto") or "auto").strip().lower()
    if credential_from_api_token_env:
        return "bearer"
    if mode == "bearer":
        return "bearer"
    if mode == "key":
        return "key"
    return "bearer" if _looks_like_jwt(secret) else "key"


def _auth_header_value(api_key: str, *, credential_from_api_token_env: bool) -> str:
    if not (api_key or "").strip():
        return "Key "
    mode = _effective_auth_mode(api_key, credential_from_api_token_env=credential_from_api_token_env)
    if mode == "bearer":
        return f"Bearer {api_key.strip()}"
    return f"Key {api_key.strip()}"


def _http_error_message(status_code: int, auth_mode: str, *, request_url: str = "") -> str:
    if status_code == 401:
        return (
            f"HTTP_401 (AliveAI unauthorized; Authorization used {auth_mode} style). "
            "Dashboard API key: put it in AILIVEAI_API_KEY and AILIVEAI_AUTH_MODE=key (or auto). "
            "Member accessToken: put it in AILIVEAI_API_TOKEN (always Bearer; AILIVEAI_AUTH_MODE does not apply to that var). "
            "Strip any literal 'Bearer ' or 'Key ' prefix from the value in .env."
        )
    if status_code == 405:
        hint = f" Request URL: {request_url}." if request_url else ""
        return (
            "HTTP_405 (AliveAI: method/path not allowed on this host — usually AILIVEAI_BASE_URL=api-server)."
            f"{hint} "
            "Set AILIVEAI_BASE_URL=https://api.aliveai.app for POST /prompts and /prompts/image-to-video; "
            "keep AILIVEAI_POLL_BASE_URL=https://api-server.aliveai.app for GET /prompts/{promptId}."
        )
    return f"HTTP_{status_code}"


def _video_length_for_aliveai(duration_seconds: int) -> str:
    """AliveAI VideoLength: SHORT (~5s) or MEDIUM (~10s) only."""
    return "SHORT" if int(duration_seconds) <= 5 else "MEDIUM"


def _medias_list_from_container(container: dict[str, Any]) -> list[Any]:
    """OpenAPI uses ``medias``; some payloads use ``media`` (array or single object)."""
    medias = container.get("medias")
    if isinstance(medias, list):
        return medias
    alt = container.get("media")
    if isinstance(alt, list):
        return alt
    if isinstance(alt, dict):
        return [alt]
    return []


def _first_image_media_id_from_container(container: dict[str, Any]) -> Optional[str]:
    for m in _medias_list_from_container(container):
        if not isinstance(m, dict):
            continue
        if str(m.get("mediaType") or "").upper() == "IMAGE":
            mid = m.get("id")
            if mid is not None and str(mid).strip():
                return str(mid).strip()
    return None


def _first_video_url_from_container(container: dict[str, Any]) -> Optional[str]:
    for m in _medias_list_from_container(container):
        if not isinstance(m, dict):
            continue
        if str(m.get("mediaType") or "").upper() == "VIDEO":
            url = m.get("mediaUrl")
            if isinstance(url, str) and url.strip():
                return url.strip()
    return None


def _normalize_video_model(raw: Optional[str]) -> str:
    v = (raw or getattr(settings, "AILIVEAI_VIDEO_MODEL", None) or "SEEDANCE").strip().upper()
    return v if v in _VALID_VIDEO_MODELS else "SEEDANCE"


class AiliveaiService:
    def __init__(self) -> None:
        self.create_base = _normalize_aliveai_create_base(settings.AILIVEAI_BASE_URL or "")
        poll_raw = (getattr(settings, "AILIVEAI_POLL_BASE_URL", None) or "").strip()
        self.poll_base = poll_raw.rstrip("/") if poll_raw else _ALIVEAI_POLL_API
        self.api_key = settings.resolved_ailiveai_api_key()
        self._from_api_token_env = settings.ailiveai_using_api_token_env()
        self._auth_mode_resolved = _effective_auth_mode(
            self.api_key, credential_from_api_token_env=self._from_api_token_env
        )
        self.headers: dict[str, str] = {
            "Authorization": _auth_header_value(
                self.api_key, credential_from_api_token_env=self._from_api_token_env
            ),
            "Content-Type": "application/json",
        }

    def _headers_blocking(self) -> dict[str, str]:
        h = dict(self.headers)
        h["x-aliveai-request-blocking"] = "true"
        return h

    async def create_blocking_source_image(
        self,
        appearance: str,
        *,
        name: str,
        detail_level: str = "MEDIUM",
        gender: Optional[str] = "FEMALE",
        aspect_ratio_aliveai: Optional[str] = None,
        server_id: Optional[str] = None,
        trace: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """POST /prompts with blocking header; return first IMAGE media ``id`` from ``promptContainer``."""
        tb = trace or {}
        if not self.api_key:
            return {"media_id": None, "status": "failed", "error": "NO_AILIVEAI_API_KEY"}
        if not self.create_base:
            return {"media_id": None, "status": "failed", "error": "NO_AILIVEAI_BASE_URL"}
        app = (appearance or "").strip()
        if not app:
            return {"media_id": None, "status": "failed", "error": "EMPTY_APPEARANCE"}
        dl = (detail_level or "MEDIUM").strip().upper()
        if dl not in ("MEDIUM", "HIGH"):
            dl = "MEDIUM"
        body: dict[str, Any] = {
            "name": (name or "Character")[:200],
            "appearance": app[:1500],
            "detailLevel": dl,
        }
        g = (gender or "").strip().upper()
        if g in ("MALE", "FEMALE", "TRANS"):
            body["gender"] = g
        if aspect_ratio_aliveai in ("DEFAULT", "SQUARE", "PORTRAIT", "LANDSCAPE"):
            body["aspectRatio"] = aspect_ratio_aliveai
        url = f"{self.create_base}/prompts"
        params: dict[str, str] = {}
        if server_id and str(server_id).strip():
            params["serverId"] = str(server_id).strip()
        emit(
            "ailiveai_image_blocking_request",
            job_id=tb.get("job_id"),
            step=tb.get("step"),
            endpoint=url,
            appearance_len=len(app),
        )
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    url,
                    json=body,
                    headers=self._headers_blocking(),
                    params=params or None,
                )
                preview = (resp.text or "")[:1200]
                emit(
                    "ailiveai_image_blocking_response",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    status_code=resp.status_code,
                    body_preview=preview,
                )
                if resp.status_code >= 400:
                    return {
                        "media_id": None,
                        "status": "failed",
                        "error": _http_error_message(
                            resp.status_code, self._auth_mode_resolved, request_url=url
                        ),
                    }
                data = resp.json()
                if not isinstance(data, dict):
                    return {"media_id": None, "status": "failed", "error": "INVALID_IMAGE_RESPONSE"}
                pc = data.get("promptContainer")
                if not isinstance(pc, dict) and _medias_list_from_container(data):
                    pc = data
                if not isinstance(pc, dict):
                    return {"media_id": None, "status": "failed", "error": "NO_PROMPT_CONTAINER"}
                mid = _first_image_media_id_from_container(pc)
                if not mid:
                    return {"media_id": None, "status": "failed", "error": "NO_IMAGE_MEDIA_ID"}
                emit(
                    "ailiveai_image_media_ready",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    media_id_preview=(mid[:8] + "...") if len(mid) > 8 else mid,
                )
                return {"media_id": mid, "status": "completed", "error": None}
        except Exception as e:
            logger.error("AILIVEAI blocking image failed: %s", e)
            emit(
                "ailiveai_image_blocking_exception",
                job_id=tb.get("job_id"),
                step=tb.get("step"),
                error=str(e),
                level="error",
            )
            return {"media_id": None, "status": "failed", "error": str(e)}

    async def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        duration: int = 5,
        *,
        media_id: Optional[str] = None,
        image_name: Optional[str] = None,
        image_appearance: Optional[str] = None,
        image_detail_level: Optional[str] = None,
        image_gender: Optional[str] = None,
        aliveai_aspect: Optional[str] = None,
        video_model: Optional[str] = None,
        scene: Optional[str] = None,
        server_id: Optional[str] = None,
        last_frame_media_id: Optional[str] = None,
        video_quality: Optional[str] = None,
        trace: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        _ = aspect_ratio
        tb = trace or {}
        if not self.api_key:
            return {"video_url": None, "status": "failed", "error": "NO_AILIVEAI_API_KEY"}
        if not self.create_base:
            return {"video_url": None, "status": "failed", "error": "NO_AILIVEAI_BASE_URL"}
        mid = (media_id or "").strip()
        if not mid:
            app = (image_appearance or prompt or "").strip()
            nm = (image_name or "Character").strip()[:200]
            img = await self.create_blocking_source_image(
                app,
                name=nm,
                detail_level=image_detail_level or "MEDIUM",
                gender=image_gender,
                aspect_ratio_aliveai=aliveai_aspect,
                server_id=server_id,
                trace=tb,
            )
            if img.get("error") or not img.get("media_id"):
                return {
                    "video_url": None,
                    "status": "failed",
                    "error": str(img.get("error") or "SOURCE_IMAGE_FAILED"),
                }
            mid = str(img["media_id"]).strip()
        vm = _normalize_video_model(video_model)
        text = (prompt or "").strip()
        if not text:
            return {"video_url": None, "status": "failed", "error": "EMPTY_TEXT_PROMPT"}
        d = 5 if int(duration) <= 5 else 10
        body: dict[str, Any] = {
            "videoModel": vm,
            "mediaId": mid,
            "text": text[:1500],
            "videoLength": _video_length_for_aliveai(d),
        }
        if scene and str(scene).strip():
            body["scene"] = str(scene).strip()[:600]
        vq = (video_quality or "").strip()
        if vm == "GROK" and vq in ("V_480P", "V_720P"):
            body["videoQuality"] = vq
        lf = (last_frame_media_id or "").strip()
        if lf:
            body["lastFrameMediaId"] = lf
        create_path = f"{self.create_base}/prompts/image-to-video"
        params: dict[str, str] = {}
        if server_id and str(server_id).strip():
            params["serverId"] = str(server_id).strip()
        emit(
            "ailiveai_video_request",
            job_id=tb.get("job_id"),
            step=tb.get("step"),
            endpoint=create_path,
            video_model=vm,
            video_length=body["videoLength"],
        )
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                create_resp = await client.post(
                    create_path, json=body, headers=self.headers, params=params or None
                )
                create_body = (create_resp.text or "")[:1200]
                emit(
                    "ailiveai_video_create_response",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    status_code=create_resp.status_code,
                    body_preview=create_body,
                )
                if create_resp.status_code >= 400:
                    return {
                        "video_url": None,
                        "status": "failed",
                        "error": _http_error_message(
                            create_resp.status_code,
                            self._auth_mode_resolved,
                            request_url=create_path,
                        ),
                    }
                data = create_resp.json()
                if not isinstance(data, dict):
                    return {"video_url": None, "status": "failed", "error": "INVALID_CREATE_RESPONSE"}
                prompt_id = data.get("promptId")
                if not prompt_id:
                    return {"video_url": None, "status": "failed", "error": "NO_PROMPT_ID"}
                prompt_id = str(prompt_id).strip()
                pc = data.get("promptContainer")
                if isinstance(pc, dict):
                    early = _first_video_url_from_container(pc)
                    if early:
                        emit(
                            "ailiveai_video_sync_complete",
                            job_id=tb.get("job_id"),
                            step=tb.get("step"),
                            prompt_id=prompt_id,
                        )
                        return {"video_url": early, "status": "completed", "error": None}
                poll_path = f"{self.poll_base}/prompts/{prompt_id}"
                max_polls = max(1, int(getattr(settings, "GENERATION_AILIVEAI_MAX_POLLS", 60)))
                poll_interval_s = 5
                for attempt in range(max_polls):
                    await asyncio.sleep(poll_interval_s)
                    poll_resp = await client.get(poll_path, headers=self.headers)
                    poll_body = (poll_resp.text or "")[:1200]
                    emit(
                        "ailiveai_video_poll",
                        job_id=tb.get("job_id"),
                        step=tb.get("step"),
                        prompt_id=prompt_id,
                        attempt=attempt + 1,
                        status_code=poll_resp.status_code,
                        body_preview=poll_body,
                    )
                    if poll_resp.status_code >= 400:
                        continue
                    try:
                        pdata = poll_resp.json()
                    except Exception:
                        continue
                    if not isinstance(pdata, dict):
                        continue
                    video_url = _first_video_url_from_container(pdata)
                    if not video_url:
                        nested = pdata.get("promptContainer")
                        if isinstance(nested, dict):
                            video_url = _first_video_url_from_container(nested)
                    if video_url:
                        return {"video_url": video_url, "status": "completed", "error": None}
                emit(
                    "ailiveai_video_poll_exhausted",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    prompt_id=prompt_id,
                    max_polls=max_polls,
                    poll_interval_s=poll_interval_s,
                    level="warning",
                )
                return {"video_url": None, "status": "failed", "error": f"TIMEOUT ({max_polls} polls)"}
        except Exception as e:
            logger.error("AILIVEAI video generation failed: %s", e)
            emit(
                "ailiveai_video_exception",
                job_id=tb.get("job_id"),
                step=tb.get("step"),
                error=str(e),
                level="error",
            )
            return {"video_url": None, "status": "failed", "error": str(e)}
