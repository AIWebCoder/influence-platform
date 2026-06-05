"""AliveAI image-to-video: POST /prompts/image-to-video, GET /prompts/{promptId}."""
import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any, Optional

OnPollProgress = Callable[[int, int], Awaitable[None]]

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


def _main_appearance_from_persona(persona: Optional[dict[str, Any]], fallback: str) -> str:
    """Prefer API-oriented ``character_appearance``; support legacy ``appearance_for_image_model``."""
    if isinstance(persona, dict):
        ca = str(persona.get("character_appearance") or "").strip()
        if ca:
            return ca[:1500]
        legacy = str(persona.get("appearance_for_image_model") or "").strip()
        if legacy:
            return legacy[:1500]
    return (fallback or "").strip()[:1500]


def _blocking_name_from_persona(persona: Optional[dict[str, Any]], fallback: str) -> str:
    """Alive ``name`` affects the face — use a realistic full name when available."""
    if isinstance(persona, dict):
        fn = str(persona.get("full_name") or "").strip()
        if fn:
            return fn[:200]
    return (fallback or "Character").strip()[:200]


def _blocking_optionals_from_persona(persona: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Optional Create Prompt fields derived from stored ``ailiveai_persona``."""
    out: dict[str, Any] = {}
    if not isinstance(persona, dict):
        return out
    fd = str(persona.get("face_details") or "").strip()
    if fd:
        out["face_details"] = fd[:1000]
    bg = str(persona.get("image_background") or "").strip()
    if bg:
        out["background"] = bg[:1000]
    fl = str(persona.get("from_location") or "").strip()
    if fl:
        out["from_location"] = fl[:100]
    isc = str(persona.get("image_scene") or "").strip()
    if isc:
        out["image_scene"] = isc[:1000]
    nd = str(persona.get("negative_details") or "").strip()
    if nd:
        out["negative_details"] = nd[:1000]
    return out


def _append_alive_response_detail(base: str, response: httpx.Response) -> str:
    """Include AliveAI JSON or raw body snippet so job logs are actionable (e.g. HTTP_400 causes)."""
    raw = (response.text or "").strip()
    if not raw:
        return base
    try:
        data = response.json()
        if isinstance(data, dict):
            for key in ("message", "error", "detail", "description", "reason"):
                v = data.get(key)
                if isinstance(v, str) and v.strip():
                    return f"{base}: {v.strip()[:500]}"
                if isinstance(v, list) and v:
                    parts = [str(x).strip() for x in v[:5] if str(x).strip()]
                    if parts:
                        return f"{base}: {'; '.join(parts)[:500]}"
    except Exception:
        pass
    safe = raw[:500].replace("\n", " ")
    return f"{base}: {safe}"


def _video_length_for_aliveai(duration_seconds: int) -> str:
    """AliveAI VideoLength: SHORT (~5s) or MEDIUM (~10s) only."""
    return "SHORT" if int(duration_seconds) <= 5 else "MEDIUM"


def _normalize_alive_seed(raw: Optional[str]) -> Optional[str]:
    """Optional seed: numeric string, max 18 digits (OpenAPI image + video creates)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or not s.isdigit():
        return None
    return s[:18] if len(s) > 18 else s


def _normalize_image_to_video_scene(raw: Optional[str]) -> Optional[str]:
    """``scene`` is optional; when sent it must be 1..600 characters."""
    s = (raw or "").strip()
    if len(s) < 1:
        return None
    return s[:600]


_VALID_VIDEO_FRAME_RATES = frozenset({"LOW", "MEDIUM", "HIGH"})


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


def _first_image_url_from_container(container: dict[str, Any]) -> Optional[str]:
    for m in _medias_list_from_container(container):
        if not isinstance(m, dict):
            continue
        if str(m.get("mediaType") or "").upper() == "IMAGE":
            url = m.get("mediaUrl")
            if isinstance(url, str) and url.strip():
                return url.strip()
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
        face_details: Optional[str] = None,
        background: Optional[str] = None,
        from_location: Optional[str] = None,
        image_scene: Optional[str] = None,
        negative_details: Optional[str] = None,
        face_improve_enabled: bool = True,
        face_model: Optional[str] = None,
        face_improve_strength: Optional[int] = None,
        block_explicit_content: Optional[bool] = None,
        seed: Optional[str] = None,
        trace: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """POST /prompts with blocking header; return first IMAGE media ``id`` from ``promptContainer``."""
        tb = trace or {}
        if not self.api_key:
            return {"media_id": None, "status": "failed", "error": "NO_AILIVEAI_API_KEY", "image_url": None}
        if not self.create_base:
            return {"media_id": None, "status": "failed", "error": "NO_AILIVEAI_BASE_URL", "image_url": None}
        app = (appearance or "").strip()
        if not app:
            return {"media_id": None, "status": "failed", "error": "EMPTY_APPEARANCE", "image_url": None}
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
        fd = (face_details or "").strip()
        if fd:
            body["faceDetails"] = fd[:1000]
            body["faceImproveEnabled"] = bool(face_improve_enabled)
            fm = (face_model or "REALISM").strip().upper()
            if fm in ("REALISM", "CREATIVE"):
                body["faceModel"] = fm
            fis = face_improve_strength
            if fis is None:
                fis = 5
            try:
                fi = int(fis)
            except (TypeError, ValueError):
                fi = 5
            body["faceImproveStrength"] = max(0, min(10, fi))
        bg = (background or "").strip()
        if bg:
            body["background"] = bg[:1000]
        fl = (from_location or "").strip()
        if fl:
            body["fromLocation"] = fl[:100]
        isc = (image_scene or "").strip()
        if isc:
            body["scene"] = isc[:1000]
        nd = (negative_details or "").strip()
        if nd:
            body["negativeDetails"] = nd[:1000]
        if block_explicit_content is not None:
            body["blockExplicitContent"] = bool(block_explicit_content)
        seed_n = _normalize_alive_seed(seed)
        if seed_n:
            body["seed"] = seed_n
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
            has_face_details=bool(fd),
            has_background=bool(bg),
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
                    base = _http_error_message(resp.status_code, self._auth_mode_resolved, request_url=url)
                    return {
                        "media_id": None,
                        "status": "failed",
                        "error": _append_alive_response_detail(base, resp),
                        "image_url": None,
                    }
                data = resp.json()
                if not isinstance(data, dict):
                    return {"media_id": None, "status": "failed", "error": "INVALID_IMAGE_RESPONSE", "image_url": None}
                pc = data.get("promptContainer")
                if not isinstance(pc, dict) and _medias_list_from_container(data):
                    pc = data
                if not isinstance(pc, dict):
                    return {"media_id": None, "status": "failed", "error": "NO_PROMPT_CONTAINER", "image_url": None}
                mid = _first_image_media_id_from_container(pc)
                if not mid:
                    return {"media_id": None, "status": "failed", "error": "NO_IMAGE_MEDIA_ID", "image_url": None}
                img_url = _first_image_url_from_container(pc)
                emit(
                    "ailiveai_image_media_ready",
                    job_id=tb.get("job_id"),
                    step=tb.get("step"),
                    media_id_preview=(mid[:8] + "...") if len(mid) > 8 else mid,
                    has_image_url=bool(img_url),
                )
                return {"media_id": mid, "status": "completed", "error": None, "image_url": img_url}
        except Exception as e:
            logger.error("AILIVEAI blocking image failed: %s", e)
            emit(
                "ailiveai_image_blocking_exception",
                job_id=tb.get("job_id"),
                step=tb.get("step"),
                error=str(e),
                level="error",
            )
            return {"media_id": None, "status": "failed", "error": str(e), "image_url": None}

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
        blocking_persona: Optional[dict[str, Any]] = None,
        seed: Optional[str] = None,
        custom_image: Optional[bool] = None,
        video_frame_rate: Optional[str] = None,
        motion_strength: Optional[int] = None,
        trace: Optional[dict[str, Any]] = None,
        on_poll: Optional[OnPollProgress] = None,
    ) -> dict[str, Any]:
        _ = aspect_ratio
        tb = trace or {}
        if not self.api_key:
            return {"video_url": None, "status": "failed", "error": "NO_AILIVEAI_API_KEY"}
        if not self.create_base:
            return {"video_url": None, "status": "failed", "error": "NO_AILIVEAI_BASE_URL"}
        mid = (media_id or "").strip()
        source_media_id: Optional[str] = None
        source_image_url: Optional[str] = None
        if not mid:
            app_raw = (image_appearance or prompt or "").strip()
            app = _main_appearance_from_persona(blocking_persona, app_raw)
            nm0 = (image_name or "Character").strip()
            nm = _blocking_name_from_persona(blocking_persona, nm0)
            opt = _blocking_optionals_from_persona(blocking_persona)
            bec: Optional[bool] = None
            if isinstance(blocking_persona, dict):
                raw_bec = blocking_persona.get("block_explicit_content")
                if isinstance(raw_bec, bool):
                    bec = raw_bec
            img = await self.create_blocking_source_image(
                app,
                name=nm,
                detail_level=image_detail_level or "MEDIUM",
                gender=image_gender,
                aspect_ratio_aliveai=aliveai_aspect,
                server_id=server_id,
                face_details=opt.get("face_details"),
                background=opt.get("background"),
                from_location=opt.get("from_location"),
                image_scene=opt.get("image_scene"),
                negative_details=opt.get("negative_details"),
                block_explicit_content=bec,
                seed=seed,
                trace=tb,
            )
            if img.get("error") or not img.get("media_id"):
                return {
                    "video_url": None,
                    "status": "failed",
                    "error": str(img.get("error") or "SOURCE_IMAGE_FAILED"),
                    "source_media_id": None,
                    "source_image_url": None,
                }
            mid = str(img["media_id"]).strip()
            source_media_id = mid
            biu = img.get("image_url")
            if isinstance(biu, str) and biu.strip():
                source_image_url = biu.strip()
        else:
            source_media_id = mid
        vm = _normalize_video_model(video_model)
        text = (prompt or "").strip()
        if not text:
            return {
                "video_url": None,
                "status": "failed",
                "error": "EMPTY_TEXT_PROMPT",
                "source_media_id": source_media_id,
                "source_image_url": source_image_url,
            }
        d = 5 if int(duration) <= 5 else 10
        body: dict[str, Any] = {
            "videoModel": vm,
            "mediaId": mid,
            "text": text[:1500],
            "videoLength": _video_length_for_aliveai(d),
        }
        scene_s = _normalize_image_to_video_scene(scene)
        if scene_s:
            body["scene"] = scene_s
        vq = (video_quality or "").strip()
        if vm == "GROK" and vq in ("V_480P", "V_720P"):
            body["videoQuality"] = vq
        lf = (last_frame_media_id or "").strip()
        if lf:
            body["lastFrameMediaId"] = lf
        seed_v = _normalize_alive_seed(seed)
        if seed_v:
            body["seed"] = seed_v
        if custom_image is not None:
            body["customImage"] = bool(custom_image)
        vfr = (video_frame_rate or "").strip().upper()
        if vfr in _VALID_VIDEO_FRAME_RATES:
            body["videoFrameRate"] = vfr
        if vm == "DEFAULT" and motion_strength is not None:
            try:
                ms = int(motion_strength)
            except (TypeError, ValueError):
                ms = None
            if ms is not None and 0 <= ms <= 6:
                body["motionStrength"] = ms
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
                    base = _http_error_message(
                        create_resp.status_code,
                        self._auth_mode_resolved,
                        request_url=create_path,
                    )
                    return {
                        "video_url": None,
                        "status": "failed",
                        "error": _append_alive_response_detail(base, create_resp),
                        "source_media_id": source_media_id,
                        "source_image_url": source_image_url,
                    }
                data = create_resp.json()
                if not isinstance(data, dict):
                    return {
                        "video_url": None,
                        "status": "failed",
                        "error": "INVALID_CREATE_RESPONSE",
                        "source_media_id": source_media_id,
                        "source_image_url": source_image_url,
                    }
                prompt_id = data.get("promptId")
                if not prompt_id:
                    return {
                        "video_url": None,
                        "status": "failed",
                        "error": "NO_PROMPT_ID",
                        "source_media_id": source_media_id,
                        "source_image_url": source_image_url,
                    }
                prompt_id = str(prompt_id).strip()
                early = _first_video_url_from_container(data)
                if not early:
                    pc = data.get("promptContainer")
                    if isinstance(pc, dict):
                        early = _first_video_url_from_container(pc)
                if early:
                    img_early = _first_image_url_from_container(data)
                    if not img_early:
                        pc2 = data.get("promptContainer")
                        if isinstance(pc2, dict):
                            img_early = _first_image_url_from_container(pc2)
                    siu = img_early or source_image_url
                    emit(
                        "ailiveai_video_sync_complete",
                        job_id=tb.get("job_id"),
                        step=tb.get("step"),
                        prompt_id=prompt_id,
                    )
                    return {
                        "video_url": early,
                        "status": "completed",
                        "error": None,
                        "source_media_id": source_media_id,
                        "source_image_url": siu,
                    }
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
                    if on_poll is not None:
                        await on_poll(attempt + 1, max_polls)
                    if poll_resp.status_code >= 400:
                        continue
                    try:
                        pdata = poll_resp.json()
                    except Exception:
                        continue
                    if not isinstance(pdata, dict):
                        continue
                    video_url = _first_video_url_from_container(pdata)
                    nested_pc = pdata.get("promptContainer") if isinstance(pdata.get("promptContainer"), dict) else None
                    if not video_url and isinstance(nested_pc, dict):
                        video_url = _first_video_url_from_container(nested_pc)
                    if video_url:
                        img_poll = _first_image_url_from_container(pdata)
                        if not img_poll and isinstance(nested_pc, dict):
                            img_poll = _first_image_url_from_container(nested_pc)
                        siu2 = img_poll or source_image_url
                        return {
                            "video_url": video_url,
                            "status": "completed",
                            "error": None,
                            "source_media_id": source_media_id,
                            "source_image_url": siu2,
                        }
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
