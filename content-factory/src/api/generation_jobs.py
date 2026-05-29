import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from google.api_core.exceptions import GoogleAPIError, RetryError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.models.generation_job import GenerationJob
from src.services.generation_job_service import PIPELINE_STEPS, GenerationJobService, default_step_control
from src.services.pipeline_trace import emit, get_job_trace
from src.services.generation_orchestrator import (
    populate_draft_scenes,
    run_generation_job_pipeline,
    run_generation_job_pipeline_from,
    run_retry_scene,
    generate_scene_preview,
)
from src.services.publish_dispatcher import dispatch_publish_intent
from src.services.publish_pipeline_log import log_publish_event

router = APIRouter()
publish_router = APIRouter()
logger = logging.getLogger(__name__)


class PreviewScenesBody(BaseModel):
    content_type: str = "reel"
    mode: str = "faceless"
    niche: str
    topic: str
    scene_count: Optional[int] = Field(default=None, ge=1, le=8)
    execution_mode: Optional[str] = Field(
        default=None,
        description="When ailiveai_single_video, returns exactly 1 scene (single-shot narrative for image-to-video).",
    )


def _is_quota_error(err: Exception) -> bool:
    err_text = str(err).lower()
    return "quota exceeded" in err_text or "rate limit" in err_text or "429" in err_text or "resourceexhausted" in err_text


def _build_fallback_preview_plan(body: PreviewScenesBody, scene_count: int) -> list[dict[str, Any]]:
    topic = (body.topic or "").strip() or "your topic"
    niche = (body.niche or "").strip() or "your niche"
    beats = [
        "Attention-grabbing hook visual",
        "Problem setup with relatable context",
        "Key insight or shift in perspective",
        "Practical step 1",
        "Practical step 2",
        "Proof, outcome, or transformation",
        "Clear call-to-action ending frame",
        "Closing reinforcement shot",
    ]
    plan: list[dict[str, Any]] = []
    for idx in range(scene_count):
        beat = beats[idx % len(beats)]
        plan.append(
            {
                "scene_index": idx,
                "duration": 5,
                "scene_role": beat.lower().replace(" ", "_"),
                "prompt": f"{beat} for {niche}: {topic}. Cinematic faceless style, clean composition, high detail.",
                "fallback_source": "quota_recovery_template",
            }
        )
    return plan


def _trace_id_from_request(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    raw = request.headers.get("x-trace-id") or request.headers.get("x-request-id")
    val = str(raw or "").strip()
    return val or None


def _preview_provider_http_exception(err: Exception) -> HTTPException:
    err_text = str(err).lower()
    if "quota exceeded" in err_text or "rate limit" in err_text or "429" in err_text or "resourceexhausted" in err_text:
        return HTTPException(
            status_code=429,
            detail="Text provider quota exceeded. Anthropic credits and Gemini quota are both exhausted. Please top up credits or retry later.",
        )
    if "api_key" in err_text or "permission denied" in err_text or "unauthorized" in err_text:
        return HTTPException(
            status_code=401,
            detail=(
                "Provider rejected API key. Configure ANTHROPIC_API_KEY (or CLAUDE_API_KEY) "
                "or GEMINI_API_KEY for the Content Factory container."
            ),
        )
    return HTTPException(status_code=502, detail=f"Provider API error: {str(err)}")


# Static path must register before /{job_id} routes so "preview-scenes" is never parsed as a UUID.
@router.post("/preview-scenes")
async def preview_scenes(body: PreviewScenesBody, request: Request):
    """Generate scene prompts only (no job persisted)."""
    from src.services.anthropic_service import AnthropicService, ContentGenerationError as AnthropicContentGenerationError
    from src.services.gemini_service import GeminiService, ContentGenerationError as GeminiContentGenerationError

    primary = str(getattr(settings, "TEXT_PROVIDER_PRIMARY", "gemini")).strip().lower()
    anthropic_ready = bool((settings.resolved_anthropic_api_key() or "").strip())
    gemini_ready = bool((settings.GEMINI_API_KEY or "").strip())
    use_anthropic = anthropic_ready if primary == "anthropic" else (anthropic_ready and not gemini_ready)
    if not use_anthropic and not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "No text model provider configured: set ANTHROPIC_API_KEY (or CLAUDE_API_KEY) "
                "or GEMINI_API_KEY in the Content Factory environment."
            ),
        )

    model_svc = AnthropicService() if use_anthropic else GeminiService()
    exec_mode = (body.execution_mode or "").strip()
    ailive_scene = exec_mode == "ailiveai_single_video"
    if exec_mode == "ailiveai_single_video":
        n = 1
    elif body.scene_count is not None:
        n = int(body.scene_count)
    else:
        n = 7
    try:
        if use_anthropic:
            plan = await model_svc.generate_scene_plan(
                niche=body.niche,
                topic=body.topic,
                content_type=body.content_type,
                mode=body.mode,
                scene_count=n,
                ailiveai_on_camera_topic_scene=ailive_scene,
            )
        else:
            plan = await model_svc.generate_scene_plan(
                niche=body.niche,
                topic=body.topic,
                content_type=body.content_type,
                mode=body.mode,
                scene_count=n,
                ailiveai_on_camera_topic_scene=ailive_scene,
            )
    except (AnthropicContentGenerationError, GeminiContentGenerationError) as e:
        if (
            use_anthropic
            and settings.GEMINI_API_KEY
            and ("credit balance is too low" in str(e).lower() or "plans & billing" in str(e).lower())
        ):
            logger.warning("preview_scenes falling back anthropic->gemini: %s", e)
            gemini = GeminiService()
            try:
                plan = await gemini.generate_scene_plan(
                    niche=body.niche,
                    topic=body.topic,
                    content_type=body.content_type,
                    mode=body.mode,
                    scene_count=n,
                    ailiveai_on_camera_topic_scene=ailive_scene,
                )
                for idx, row in enumerate(plan):
                    if isinstance(row, dict):
                        row["scene_index"] = int(row.get("scene_index", idx))
                        row["duration"] = 5
                return plan
            except Exception as ge:
                logger.warning("preview_scenes gemini fallback failed: %s", ge)
                if _is_quota_error(ge) and settings.GENERATION_ALLOW_SYNTHETIC_PREVIEW_FALLBACK:
                    logger.warning("preview_scenes using local fallback plan after quota error")
                    return _build_fallback_preview_plan(body, n)
                raise _preview_provider_http_exception(ge) from ge
        logger.warning("preview_scenes model output rejected: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    except json.JSONDecodeError as e:
        logger.warning("preview_scenes JSON parse failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Could not parse scene plan JSON from the model. Try again or adjust the topic.",
        ) from e
    except (GoogleAPIError, RetryError) as e:
        logger.warning("preview_scenes provider API error: %s", e)
        raise _preview_provider_http_exception(e) from e
    except Exception as e:
        if (
            use_anthropic
            and settings.GEMINI_API_KEY
            and ("credit balance is too low" in str(e).lower() or "plans & billing" in str(e).lower())
        ):
            logger.warning("preview_scenes falling back anthropic->gemini (generic): %s", e)
            gemini = GeminiService()
            try:
                plan = await gemini.generate_scene_plan(
                    niche=body.niche,
                    topic=body.topic,
                    content_type=body.content_type,
                    mode=body.mode,
                    scene_count=n,
                    ailiveai_on_camera_topic_scene=ailive_scene,
                )
                for idx, row in enumerate(plan):
                    if isinstance(row, dict):
                        row["scene_index"] = int(row.get("scene_index", idx))
                        row["duration"] = 5
                return plan
            except Exception as ge:
                logger.warning("preview_scenes gemini fallback failed (generic): %s", ge)
                if _is_quota_error(ge) and settings.GENERATION_ALLOW_SYNTHETIC_PREVIEW_FALLBACK:
                    logger.warning("preview_scenes using local fallback plan after quota error (generic)")
                    return _build_fallback_preview_plan(body, n)
                raise _preview_provider_http_exception(ge) from ge
        logger.exception("preview_scenes unexpected failure")
        if _is_quota_error(e) and settings.GENERATION_ALLOW_SYNTHETIC_PREVIEW_FALLBACK:
            logger.warning("preview_scenes using local fallback plan after direct quota error")
            return _build_fallback_preview_plan(body, n)
        raise HTTPException(
            status_code=500,
            detail=f"Scene preview failed ({type(e).__name__}). Check server logs.",
        ) from e
    for idx, row in enumerate(plan):
        if isinstance(row, dict):
            row["scene_index"] = int(row.get("scene_index", idx))
            row["duration"] = 5
    return plan


class GenerationJobCreateRequest(BaseModel):
    execution_mode: str = Field(
        default="scene_based",
        description="scene_based | multi_scene_single_video | ailiveai_single_video",
    )
    content_type: str = Field(default="reel", description="post | reel | story")
    mode: str = Field(default="faceless", description="persona | faceless")
    niche: str
    topic: str
    target_accounts: list[str] = Field(
        default_factory=list,
        description="Optional at create time; choose accounts when publishing.",
    )
    scheduled_at: Optional[str] = None
    template_id: Optional[str] = None
    campaign_id: Optional[str] = None
    scene_count: Optional[int] = Field(default=None, ge=6, le=8)
    video_duration: Optional[int] = Field(default=None, ge=4, le=15)
    ailiveai_media_id: Optional[str] = Field(
        default=None,
        description="Optional: skip blocking image step when set (existing AliveAI image mediaId).",
    )
    ailiveai_image_appearance: Optional[str] = Field(
        default=None,
        max_length=1500,
        description="Optional override for POST /prompts appearance; defaults to combined scene narrative.",
    )
    ailiveai_detail_level: Optional[str] = Field(default=None, description="MEDIUM or HIGH for blocking image")
    ailiveai_gender: Optional[str] = Field(default=None, description="MALE|FEMALE|TRANS for blocking image")
    ailiveai_video_model: Optional[str] = Field(default=None, description="DEFAULT|AUDIO|GROK|SEEDANCE")
    ailiveai_scene: Optional[str] = Field(default=None, max_length=600)
    ailiveai_server_id: Optional[str] = None
    ailiveai_last_frame_media_id: Optional[str] = None
    ailiveai_video_quality: Optional[str] = Field(default=None, description="V_480P|V_720P when videoModel is GROK")
    ailiveai_seed: Optional[str] = Field(
        default=None,
        max_length=18,
        description="Optional numeric seed (max 18 digits) for POST /prompts and /prompts/image-to-video.",
    )
    ailiveai_custom_image: Optional[bool] = Field(
        default=None,
        description="Alive image-to-video customImage: true when mediaId refers to an external/custom upload flow.",
    )
    ailiveai_video_frame_rate: Optional[str] = Field(
        default=None,
        description="Alive videoFrameRate: LOW | MEDIUM | HIGH",
    )
    ailiveai_motion_strength: Optional[int] = Field(
        default=None,
        ge=0,
        le=6,
        description="Alive motionStrength (0–6). Only applied when videoModel is DEFAULT.",
    )


class GenerationJobCreateResponse(BaseModel):
    job_id: str


class GenerationJobListItem(BaseModel):
    id: str
    status: str
    progress: int = 0
    execution_mode: str = "scene_based"
    caption: Optional[str] = None
    topic: Optional[str] = None
    content_type: Optional[str] = None
    niche: Optional[str] = None
    target_account_count: int = 0
    target_account_ids: list[str] = Field(default_factory=list)
    target_account_usernames: list[str] = Field(default_factory=list)
    output_url: Optional[str] = None
    preview_url: Optional[str] = None
    publish_intent_id: Optional[str] = None
    publish_intent_status: Optional[str] = None
    queue_display_title: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ReadyQueueAccountFilter(BaseModel):
    id: str
    username: str
    count: int


class GenerationJobReadyQueuePage(BaseModel):
    items: list[GenerationJobListItem]
    total: int
    skip: int
    limit: int
    account_filters: list[ReadyQueueAccountFilter] = Field(default_factory=list)


class GeneratedAssetOut(BaseModel):
    id: str
    generation_job_id: str
    asset_type: str
    storage_provider: str
    object_key: str
    public_url: str
    mime_type: str
    size_bytes: int
    duration_seconds: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    checksum_sha256: str
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PublishIntentCreateRequest(BaseModel):
    asset_id: str
    content_type: str
    caption: str = ""
    hashtags: list[str] = Field(default_factory=list)
    mode: str
    scheduled_for: Optional[str] = None
    target_account_ids: list[str]
    idempotency_key: str


class PublishIntentCreateResponse(BaseModel):
    intent_id: str
    status: str
    targets: list[dict[str, str]]


class PublishIntentDispatchResponse(BaseModel):
    intent_id: str
    status: str
    dispatched_targets: int


def _parse_optional_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_uuid_list(raw_values: list[str], field_name: str) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for raw in raw_values:
        token = (raw or "").strip()
        if not token:
            continue
        try:
            uid = str(uuid.UUID(token))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid UUID in {field_name}: {token}") from exc
        if uid not in seen:
            seen.add(uid)
            unique.append(uid)
    return unique


async def _resolve_target_accounts(db: AsyncSession, raw_targets: list[str]) -> list[str]:
    """Normalize target accounts to UUID strings (accept id, username, or email)."""
    if not raw_targets:
        return []
    normalized: list[str] = []
    unresolved: list[str] = []
    seen: set[str] = set()

    for raw in raw_targets:
        token = (raw or "").strip()
        if not token:
            continue
        try:
            uid = str(uuid.UUID(token))
            if uid not in seen:
                seen.add(uid)
                normalized.append(uid)
            continue
        except ValueError:
            pass

        result = await db.execute(
            text(
                """
                SELECT id::text
                FROM accounts
                WHERE LOWER(username) = LOWER(:token)
                   OR LOWER(COALESCE(email, '')) = LOWER(:token)
                LIMIT 1
                """
            ),
            {"token": token},
        )
        row = result.first()
        if not row:
            unresolved.append(token)
            continue
        uid = str(row[0])
        if uid not in seen:
            seen.add(uid)
            normalized.append(uid)

    if unresolved:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown target account(s): {', '.join(unresolved)}",
        )
    if not normalized:
        raise HTTPException(status_code=400, detail="No valid target account matched the provided value(s).")
    return normalized


class GenerationStepOut(BaseModel):
    id: str
    step_name: str
    status: str
    progress: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None

    @classmethod
    def from_orm_step(cls, s) -> "GenerationStepOut":
        return cls(
            id=str(s.id),
            step_name=s.step_name,
            status=s.status,
            progress=s.progress or 0,
            metadata=dict(s.step_metadata or {}),
            error_message=s.error_message,
        )


class GenerationSceneOut(BaseModel):
    id: str
    scene_index: int
    prompt: str
    duration: int
    scene_role: Optional[str] = None
    status: str
    start_image_url: Optional[str] = None
    end_image_url: Optional[str] = None
    video_url: Optional[str] = None
    error_message: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GenerationJobDetailOut(BaseModel):
    id: str
    status: str
    execution_mode: str = "scene_based"
    progress: int
    step_control: dict[str, str] = Field(default_factory=dict)
    input_payload: dict[str, Any]
    output_url: Optional[str] = None
    logs: list[dict[str, Any]] = Field(default_factory=list)
    steps: list[GenerationStepOut] = Field(default_factory=list)
    scenes: list[GenerationSceneOut] = Field(default_factory=list)
    cost_estimate: Optional[dict[str, Any]] = None
    created_at: str
    updated_at: str


def _multi_scene_seedance_duration_seconds(job) -> int:
    """Align with orchestrator _step_multi_scene_single_video (4..15s)."""
    payload = job.input_payload or {}
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    total_from_scenes = sum(int(getattr(sc, "duration", None) or 4) for sc in scenes)
    vd = payload.get("video_duration")
    try:
        if vd is not None:
            selected = int(vd)
        else:
            selected = int(total_from_scenes)
    except Exception:
        selected = int(total_from_scenes)
    return max(4, min(15, selected))


def _ailiveai_video_seconds(job) -> int:
    """AliveAI output is only ~5s (SHORT) or ~10s (MEDIUM)."""
    payload = job.input_payload or {}
    vd = payload.get("video_duration")
    try:
        v = int(vd) if vd is not None else 10
    except Exception:
        v = 10
    return 10 if v > 5 else 5


def _compute_cost_estimate(job) -> dict[str, Any]:
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    n = len(scenes)
    payload = job.input_payload or {}
    execution_mode = str(getattr(job, "execution_mode", "scene_based") or "scene_based")

    if execution_mode == "multi_scene_single_video":
        d = _multi_scene_seedance_duration_seconds(job)
        per_sec = float(settings.SEEDANCE_ESTIMATE_CREDITS_PER_SECOND)
        sub = round(d * per_sec, 2)
        return {
            "total_credits": sub,
            "currency": "credits",
            "model": "bytedance/seedance-2",
            "provider": "api.kie.ai",
            "resolution": "720p",
            "generate_audio": False,
            "estimate_note": (
                f"One Seedance call (multi-scene narrative still = one {d}s output). "
                f"Estimate uses {per_sec:g} credits/s output duration; align SEEDANCE_ESTIMATE_CREDITS_PER_SECOND with Kie.ai."
            ),
            "breakdown": [
                {
                    "line": f"Seedance 2.0 — 720p, no audio (single {d}s video; scene count does not multiply cost)",
                    "units": d,
                    "unit_credits": per_sec,
                    "subtotal": sub,
                },
            ],
        }

    if execution_mode == "ailiveai_single_video":
        d = _ailiveai_video_seconds(job)
        per_sec = float(settings.SEEDANCE_ESTIMATE_CREDITS_PER_SECOND)
        sub = round(d * per_sec, 2)
        return {
            "total_credits": sub,
            "currency": "credits",
            "model": str(getattr(settings, "AILIVEAI_VIDEO_MODEL", "SEEDANCE") or "SEEDANCE"),
            "provider": "ailiveai",
            "resolution": "720p",
            "generate_audio": False,
            "estimate_note": (
                f"AliveAI image (blocking) + image-to-video; output SHORT (~5s) or MEDIUM (~10s), here ~{d}s. "
                f"Rough credits/s uses SEEDANCE_ESTIMATE_CREDITS_PER_SECOND until a dedicated AliveAI rate is configured."
            ),
            "breakdown": [
                {
                    "line": f"AliveAI — ~{d}s output (estimate only; includes blocking image step)",
                    "units": d,
                    "unit_credits": per_sec,
                    "subtotal": sub,
                },
            ],
        }

    ctype = str(payload.get("content_type") or payload.get("type") or "reel")
    images_total = n * 2
    videos_total = n if ctype == "reel" else 0
    img_c = images_total * float(settings.GENERATION_CREDITS_PER_IMAGE)
    vid_c = videos_total * float(settings.GENERATION_CREDITS_PER_VIDEO)
    total = round(img_c + vid_c, 2)
    return {
        "total_credits": total,
        "currency": "credits",
        "breakdown": [
            {"line": "images (2 per scene)", "units": images_total, "unit_credits": settings.GENERATION_CREDITS_PER_IMAGE, "subtotal": round(img_c, 2)},
            {"line": "videos (per scene, reel only)", "units": videos_total, "unit_credits": settings.GENERATION_CREDITS_PER_VIDEO, "subtotal": round(vid_c, 2)},
        ],
    }


def _step_control_for_response(job) -> dict[str, str]:
    merged = default_step_control()
    merged.update({k: str(v) for k, v in (job.step_control or {}).items() if k in merged})
    return merged


def _serialize_job(job, include_cost: bool = True) -> GenerationJobDetailOut:
    steps = sorted(job.steps, key=lambda x: x.step_order)
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    cost = None
    if include_cost and job.status in ("draft", "ready") and scenes:
        cost = _compute_cost_estimate(job)
    return GenerationJobDetailOut(
        id=str(job.id),
        status=job.status,
        execution_mode=str(getattr(job, "execution_mode", "scene_based") or "scene_based"),
        progress=job.progress or 0,
        step_control=_step_control_for_response(job),
        input_payload=job.input_payload or {},
        output_url=job.output_url,
        logs=list(job.logs or []),
        steps=[GenerationStepOut.from_orm_step(s) for s in steps],
        scenes=[
            GenerationSceneOut(
                id=str(sc.id),
                scene_index=sc.scene_index,
                prompt=sc.prompt,
                duration=sc.duration,
                scene_role=sc.scene_role,
                status=sc.status,
                start_image_url=sc.start_image_url,
                end_image_url=sc.end_image_url,
                video_url=sc.video_url,
                error_message=sc.error_message,
                metadata=dict(sc.scene_metadata or {}),
            )
            for sc in scenes
        ],
        cost_estimate=cost,
        created_at=job.created_at.isoformat() if job.created_at else "",
        updated_at=job.updated_at.isoformat() if job.updated_at else "",
    )


def _caption_from_payload(payload: Any) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    cap = (payload.get("caption") or "").strip()
    if cap:
        return cap
    topic = (payload.get("topic") or "").strip()
    return topic or None


def _display_account_label(username: str) -> str:
    trimmed = (username or "").strip()
    if not trimmed:
        return ""
    if "@" in trimmed:
        return trimmed.split("@", 1)[0].lower()
    return trimmed.lstrip("@").lower()


def _queue_display_title(
    *,
    queue_index: Optional[int],
    target_usernames: list[str],
    caption: Optional[str],
    topic: Optional[str],
    job_id: str,
) -> str:
    account_label = ""
    for name in target_usernames:
        account_label = _display_account_label(name)
        if account_label:
            break
    if account_label and queue_index:
        return f"{account_label} video {queue_index}"
    if caption:
        return caption
    if topic:
        return topic
    return job_id[:8]


async def _serialize_job_list_items(
    jobs: list,
    *,
    db: AsyncSession,
    queue_index_by_id: Optional[dict[str, int]] = None,
) -> list[GenerationJobListItem]:
    if not jobs:
        return []

    job_ids = [str(j.id) for j in jobs]
    enrich_res = await db.execute(
        text(
            """
            SELECT
                gj.id::text AS job_id,
                (
                    SELECT ga.public_url
                    FROM generated_assets ga
                    WHERE ga.generation_job_id = gj.id
                      AND ga.public_url IS NOT NULL
                      AND ga.public_url <> ''
                    ORDER BY
                        CASE WHEN ga.asset_type = 'video' THEN 0 ELSE 1 END,
                        ga.created_at DESC
                    LIMIT 1
                ) AS preview_url,
                (
                    SELECT pi.id::text
                    FROM publication_intents pi
                    WHERE pi.generation_job_id = gj.id
                    ORDER BY pi.created_at DESC NULLS LAST
                    LIMIT 1
                ) AS publish_intent_id,
                (
                    SELECT pi.status
                    FROM publication_intents pi
                    WHERE pi.generation_job_id = gj.id
                    ORDER BY pi.created_at DESC NULLS LAST
                    LIMIT 1
                ) AS publish_intent_status
            FROM generation_jobs gj
            WHERE gj.id = ANY(CAST(:job_ids AS uuid[]))
            """
        ),
        {"job_ids": job_ids},
    )
    enrich = {str(r["job_id"]): r for r in enrich_res.mappings().all()}

    account_ids_for_lookup: list[str] = []
    seen_account_ids: set[str] = set()
    for job in jobs:
        payload = job.input_payload if isinstance(job.input_payload, dict) else {}
        targets = payload.get("target_accounts") or []
        if not isinstance(targets, list):
            continue
        for raw in targets:
            token = str(raw or "").strip()
            if not token:
                continue
            try:
                uid = str(uuid.UUID(token))
            except ValueError:
                continue
            if uid not in seen_account_ids:
                seen_account_ids.add(uid)
                account_ids_for_lookup.append(uid)

    username_by_id: dict[str, str] = {}
    if account_ids_for_lookup:
        account_rows = await db.execute(
            text(
                """
                SELECT id::text, username
                FROM accounts
                WHERE id = ANY(CAST(:account_ids AS uuid[]))
                """
            ),
            {"account_ids": account_ids_for_lookup},
        )
        username_by_id = {
            str(r[0]): str(r[1]).strip()
            for r in account_rows.fetchall()
            if r[1] and str(r[1]).strip()
        }

    rows: list[GenerationJobListItem] = []
    for job in jobs:
        jid = str(job.id)
        payload = job.input_payload if isinstance(job.input_payload, dict) else {}
        targets = payload.get("target_accounts") or []
        target_ids: list[str] = []
        if isinstance(targets, list):
            for raw in targets:
                token = str(raw or "").strip()
                if not token:
                    continue
                try:
                    uid = str(uuid.UUID(token))
                except ValueError:
                    continue
                if uid not in target_ids:
                    target_ids.append(uid)
        target_usernames = [username_by_id[aid] for aid in target_ids if aid in username_by_id]
        extra = enrich.get(jid) or {}
        caption = _caption_from_payload(payload)
        topic = (str(payload.get("topic") or "").strip() or None)
        queue_index = (queue_index_by_id or {}).get(jid)
        rows.append(
            GenerationJobListItem(
                id=jid,
                status=str(job.status),
                progress=int(job.progress or 0),
                execution_mode=str(getattr(job, "execution_mode", "scene_based") or "scene_based"),
                caption=caption,
                topic=topic,
                content_type=(str(payload.get("content_type") or "").strip() or None),
                niche=(str(payload.get("niche") or "").strip() or None),
                target_account_count=len(target_ids),
                target_account_ids=target_ids,
                target_account_usernames=target_usernames,
                output_url=(str(job.output_url).strip() if job.output_url else None),
                preview_url=(str(extra.get("preview_url") or "").strip() or None) or None,
                publish_intent_id=(str(extra.get("publish_intent_id") or "").strip() or None),
                publish_intent_status=(str(extra.get("publish_intent_status") or "").strip() or None),
                queue_display_title=_queue_display_title(
                    queue_index=queue_index,
                    target_usernames=target_usernames,
                    caption=caption,
                    topic=topic,
                    job_id=jid,
                ),
                created_at=job.created_at.isoformat() if job.created_at else None,
                updated_at=job.updated_at.isoformat() if job.updated_at else None,
            )
        )
    return rows


@router.get("")
async def list_generation_jobs(
    status: str = Query(
        default="draft,ready,running,pending,cancelling,completed,failed,cancelled",
        description="Comma-separated job statuses",
    ),
    ready_to_publish: bool = Query(
        default=False,
        description="When true: completed jobs with assets, excluding queued/published intents (waiting list).",
    ),
    account_id: Optional[str] = Query(
        default=None,
        description="When ready_to_publish: filter by first target account id.",
    ),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    svc = GenerationJobService(db)
    if ready_to_publish:
        account_filter: Optional[str] = None
        if account_id and str(account_id).strip():
            try:
                account_filter = str(uuid.UUID(str(account_id).strip()))
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="Invalid account_id") from exc

        jobs, queue_index_by_id = await svc.list_ready_to_publish(
            limit=limit,
            skip=skip,
            account_id=account_filter,
        )
        total = await svc.count_ready_to_publish(account_id=account_filter)
        account_counts = await svc.list_ready_to_publish_account_counts()
        account_ids = [aid for aid, _ in account_counts]
        username_by_id: dict[str, str] = {}
        if account_ids:
            account_rows = await db.execute(
                text(
                    """
                    SELECT id::text, username
                    FROM accounts
                    WHERE id = ANY(CAST(:account_ids AS uuid[]))
                    """
                ),
                {"account_ids": account_ids},
            )
            username_by_id = {
                str(r[0]): str(r[1]).strip()
                for r in account_rows.fetchall()
                if r[1] and str(r[1]).strip()
            }
        account_filters = [
            ReadyQueueAccountFilter(
                id=aid,
                username=username_by_id.get(aid, aid),
                count=count,
            )
            for aid, count in account_counts
            if aid in username_by_id or aid
        ]
        items = await _serialize_job_list_items(
            jobs,
            db=db,
            queue_index_by_id=queue_index_by_id,
        )
        return GenerationJobReadyQueuePage(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
            account_filters=account_filters,
        )
    else:
        allowed = frozenset(
            {"draft", "ready", "pending", "running", "cancelling", "completed", "failed", "cancelled"}
        )
        statuses = [s.strip().lower() for s in status.split(",") if s.strip().lower() in allowed]
        if not statuses:
            statuses = list(allowed)
        jobs = await svc.list_jobs(statuses=statuses, limit=limit, skip=skip)
        return await _serialize_job_list_items(jobs, db=db)


@router.post("", response_model=GenerationJobCreateResponse)
async def create_generation_job(
    body: GenerationJobCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        if body.execution_mode not in ("scene_based", "multi_scene_single_video", "ailiveai_single_video"):
            raise HTTPException(status_code=400, detail="Invalid execution_mode")
        body_effective = body
        if body.execution_mode == "ailiveai_single_video":
            vd = body.video_duration
            try:
                vi = int(vd) if vd is not None else 10
            except Exception:
                vi = 10
            coerced = 10 if vi > 5 else 5
            body_effective = body.model_copy(update={"video_duration": coerced, "mode": "persona"})
        payload = body_effective.model_dump(exclude_none=True)
        if body.execution_mode == "ailiveai_single_video":
            payload["mode"] = "persona"
        raw_targets = payload.get("target_accounts") or []
        payload["target_accounts"] = (
            await _resolve_target_accounts(db, raw_targets) if raw_targets else []
        )
        payload.setdefault("content_type", body.content_type)
        from src.services.template_service import resolve_template_payload

        payload = await resolve_template_payload(db, payload)
        svc = GenerationJobService(db)
        job = await svc.create_job(payload, execution_mode=body.execution_mode)
        await db.flush()
        await populate_draft_scenes(db, job)
        await db.commit()
        await db.refresh(job)
        emit(
            "generation_job_created",
            job_id=str(job.id),
            step="api",
            execution_mode=body.execution_mode,
            trace_id=_trace_id_from_request(request),
        )
        return GenerationJobCreateResponse(job_id=str(job.id))
    except Exception as e:
        await db.rollback()
        # Look for rate limit string indicators if underlying error isn't typed properly
        error_str = str(e).lower()
        if "quota exceeded" in error_str or "rate limit" in error_str or "429" in error_str or "resourceexhausted" in error_str:
            raise HTTPException(status_code=429, detail="Gemini Rate Limit Exceeded (5 RPM free tier). Please wait 30 seconds before creating a new job.")
        # Re-raise anything else up to the main 500 handler
        raise e


async def _build_publish_intent_response(db: AsyncSession, intent_id: str) -> PublishIntentCreateResponse:
    intent_row = await db.execute(
        text("SELECT id::text, status FROM publication_intents WHERE id = :intent_id"),
        {"intent_id": intent_id},
    )
    intent = intent_row.first()
    if not intent:
        raise HTTPException(status_code=404, detail="Publish intent not found")
    target_rows = await db.execute(
        text(
            """
            SELECT account_id::text, platform, status
            FROM publication_targets
            WHERE publication_intent_id = :intent_id
            ORDER BY created_at ASC
            """
        ),
        {"intent_id": intent_id},
    )
    targets = [
        {"account_id": str(r[0]), "platform": str(r[1]), "status": str(r[2])}
        for r in target_rows.fetchall()
    ]
    return PublishIntentCreateResponse(intent_id=str(intent[0]), status=str(intent[1]), targets=targets)


@router.get("/{job_id}/assets", response_model=list[GeneratedAssetOut])
async def list_generated_assets(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")

    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    rows = await db.execute(
        text(
            """
            SELECT
                id::text, generation_job_id::text, asset_type, storage_provider, object_key, public_url,
                mime_type, size_bytes, duration_seconds, width, height, checksum_sha256, status,
                created_at, updated_at
            FROM generated_assets
            WHERE generation_job_id = :job_id
            ORDER BY created_at ASC
            """
        ),
        {"job_id": str(jid)},
    )
    return [
        GeneratedAssetOut(
            id=str(r[0]),
            generation_job_id=str(r[1]),
            asset_type=str(r[2]),
            storage_provider=str(r[3]),
            object_key=str(r[4]),
            public_url=str(r[5]),
            mime_type=str(r[6]),
            size_bytes=int(r[7] or 0),
            duration_seconds=int(r[8]) if r[8] is not None else None,
            width=int(r[9]) if r[9] is not None else None,
            height=int(r[10]) if r[10] is not None else None,
            checksum_sha256=str(r[11]),
            status=str(r[12]),
            created_at=r[13].isoformat() if r[13] else None,
            updated_at=r[14].isoformat() if r[14] else None,
        )
        for r in rows.fetchall()
    ]


@router.post("/{job_id}/publish-intents", response_model=PublishIntentCreateResponse)
async def create_publish_intent(job_id: str, body: PublishIntentCreateRequest, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")

    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    mode = (body.mode or "").strip()
    if mode not in ("publish_now", "save_for_later", "scheduled"):
        raise HTTPException(status_code=400, detail="Invalid mode")

    content_type = (body.content_type or "").strip()
    if content_type not in ("reel", "post", "story"):
        raise HTTPException(status_code=400, detail="Invalid content_type")
    if content_type == "reel" and not settings.FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED:
        raise HTTPException(status_code=400, detail="Reel publishing not enabled")

    scheduled_for = _parse_optional_iso_datetime(body.scheduled_for)
    now_utc = datetime.now(timezone.utc)
    if mode == "scheduled" and scheduled_for is None:
        raise HTTPException(status_code=400, detail="scheduled_for is required when mode is scheduled")
    if scheduled_for is not None and scheduled_for < now_utc:
        mode = "publish_now"
        scheduled_for = None

    account_ids = _normalize_uuid_list(body.target_account_ids, "target_account_ids")
    if not account_ids:
        raise HTTPException(status_code=400, detail="At least 1 target_account_id is required")

    idempotency_key = (body.idempotency_key or "").strip()
    if not idempotency_key:
        raise HTTPException(status_code=400, detail="idempotency_key is required")

    existing_intent = await db.execute(
        text("SELECT id::text FROM publication_intents WHERE idempotency_key = :idempotency_key LIMIT 1"),
        {"idempotency_key": idempotency_key},
    )
    existing = existing_intent.first()
    if existing:
        return await _build_publish_intent_response(db, str(existing[0]))

    try:
        asset_uuid = str(uuid.UUID(body.asset_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid asset_id") from exc

    asset_row = await db.execute(
        text(
            """
            SELECT id::text, COALESCE(public_url, '') AS public_url
            FROM generated_assets
            WHERE id = :asset_id
              AND generation_job_id = :job_id
              AND status = 'ready'
            LIMIT 1
            """
        ),
        {"asset_id": asset_uuid, "job_id": str(jid)},
    )
    asset_hit = asset_row.first()
    if not asset_hit:
        raise HTTPException(status_code=400, detail="asset_id must belong to job and be ready")

    from src.services.publish_validation import is_public_http_url

    if not is_public_http_url(str(asset_hit[1])):
        raise HTTPException(
            status_code=400,
            detail=(
                "Asset must have a public http(s) URL before publish. "
                "Wait for generation to finish or fix assembly output."
            ),
        )

    account_rows = await db.execute(
        text(
            """
            SELECT id::text,
                   COALESCE(platform, 'instagram') AS platform,
                   COALESCE(ig_user_id, '') AS ig_user_id,
                   COALESCE(ig_access_token, '') AS ig_access_token
            FROM accounts
            WHERE id = ANY(CAST(:account_ids AS uuid[]))
            """
        ),
        {"account_ids": account_ids},
    )
    accounts_map = {str(r[0]): str(r[1]) for r in account_rows.fetchall()}
    missing = [aid for aid in account_ids if aid not in accounts_map]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown account(s): {', '.join(missing)}")

    from src.services.publish_validation import instagram_account_missing_fields

    for row in account_rows.fetchall():
        acc_id, platform, ig_uid, ig_tok = str(row[0]), str(row[1]).lower(), str(row[2]), str(row[3])
        if platform in ("instagram", ""):
            ig_missing = instagram_account_missing_fields(ig_uid, ig_tok)
            if ig_missing:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Account {acc_id} is not ready for Instagram publish "
                        f"(missing: {', '.join(ig_missing)}). "
                        "Set ig_user_id and ig_access_token on the account first."
                    ),
                )

    # One active publish_now intent per (job, primary asset, account set). Prevents multiple
    # Instagram posts when idempotency_key drifts (caption edits, old clients, double clicks).
    if mode == "publish_now":
        cand = await db.execute(
            text(
                """
                SELECT pi.id::text
                FROM publication_intents pi
                WHERE pi.generation_job_id = CAST(:job_id AS uuid)
                  AND pi.primary_asset_id = CAST(:asset_id AS uuid)
                  AND pi.mode = 'publish_now'
                  AND pi.status IN ('ready', 'queued')
                ORDER BY pi.created_at DESC
                LIMIT 30
                """
            ),
            {"job_id": str(jid), "asset_id": asset_uuid},
        )
        req_sorted = sorted(account_ids)
        for (pid,) in cand.fetchall():
            acc_res = await db.execute(
                text(
                    """
                    SELECT account_id::text
                    FROM publication_targets
                    WHERE publication_intent_id = CAST(:pid AS uuid)
                    ORDER BY account_id
                    """
                ),
                {"pid": pid},
            )
            got = [r[0] for r in acc_res.fetchall()]
            if got == req_sorted:
                log_publish_event(
                    "publish_intent_deduped_job_asset_accounts",
                    job_id=str(jid),
                    intent_id=pid,
                    primary_asset_id=asset_uuid,
                    requested_idempotency_key=idempotency_key,
                )
                return await _build_publish_intent_response(db, pid)

    intent_status = "draft" if mode == "save_for_later" else "ready"
    hashtags = [h for h in (body.hashtags or []) if isinstance(h, str)]

    try:
        new_intent = await db.execute(
            text(
                """
                INSERT INTO publication_intents (
                    generation_job_id, primary_asset_id, content_type, caption, hashtags,
                    mode, scheduled_for, status, idempotency_key
                ) VALUES (
                    :generation_job_id, :primary_asset_id, :content_type, :caption, CAST(:hashtags AS jsonb),
                    :mode, :scheduled_for, :status, :idempotency_key
                )
                RETURNING id::text
                """
            ),
            {
                "generation_job_id": str(jid),
                "primary_asset_id": asset_uuid,
                "content_type": content_type,
                "caption": body.caption or "",
                "hashtags": json.dumps(hashtags),
                "mode": mode,
                "scheduled_for": scheduled_for,
                "status": intent_status,
                "idempotency_key": idempotency_key,
            },
        )
        intent_id = str(new_intent.scalar_one())

        for account_id in account_ids:
            await db.execute(
                text(
                    """
                    INSERT INTO publication_targets (
                        publication_intent_id, account_id, platform, status
                    ) VALUES (
                        :publication_intent_id, :account_id, :platform, 'pending'
                    )
                    """
                ),
                {
                    "publication_intent_id": intent_id,
                    "account_id": account_id,
                    "platform": accounts_map[account_id],
                },
            )
        await db.commit()
        log_publish_event(
            "publish_intent_created",
            job_id=str(jid),
            intent_id=intent_id,
            request_body={
                "content_type": content_type,
                "mode": mode,
                "intent_status": intent_status,
                "primary_asset_id": asset_uuid,
                "target_account_ids": account_ids,
                "caption": body.caption or "",
                "hashtags": hashtags,
                "scheduled_for": scheduled_for.isoformat() if scheduled_for else None,
                "idempotency_key": idempotency_key,
            },
        )
    except Exception as exc:
        await db.rollback()
        if "publication_intents_idempotency_key_key" in str(exc):
            existing_retry = await db.execute(
                text("SELECT id::text FROM publication_intents WHERE idempotency_key = :idempotency_key LIMIT 1"),
                {"idempotency_key": idempotency_key},
            )
            row = existing_retry.first()
            if row:
                return await _build_publish_intent_response(db, str(row[0]))
        raise

    return await _build_publish_intent_response(db, intent_id)


@publish_router.post("/publication-intents/{intent_id}/dispatch", response_model=PublishIntentDispatchResponse)
async def dispatch_intent(intent_id: str, db: AsyncSession = Depends(get_db)):
    try:
        iid = str(uuid.UUID(intent_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid intent id")

    try:
        result = await dispatch_publish_intent(iid, db)
        log_publish_event(
            "publish_dispatch_http_ok",
            intent_id=iid,
            dispatch_response=result,
        )
        return PublishIntentDispatchResponse(
            intent_id=str(result["intent_id"]),
            status=str(result["status"]),
            dispatched_targets=int(result["dispatched_targets"]),
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "Publish intent not found":
            log_publish_event(
                "publish_dispatch_http_not_found",
                intent_id=iid,
                error=msg,
            )
            raise HTTPException(status_code=404, detail=msg) from exc
        log_publish_event(
            "publish_dispatch_http_rejected",
            intent_id=iid,
            error=msg,
        )
        try:
            await db.execute(
                text(
                    """
                    UPDATE publication_intents
                    SET error_message = :error_message,
                        updated_at = NOW()
                    WHERE id = :intent_id
                    """
                ),
                {"intent_id": iid, "error_message": msg[:8000]},
            )
            await db.commit()
        except Exception:
            await db.rollback()
        raise HTTPException(status_code=400, detail=msg) from exc


@router.post("/{job_id}/launch")
async def launch_generation_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("cancelling", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot launch a cancelled job.")
    if job.status not in ("draft", "ready"):
        raise HTTPException(status_code=400, detail="Job must be in draft or ready to launch")
    job.status = "running"
    job.progress = max(job.progress or 0, 1)
    svc.touch(job)
    await db.commit()
    await db.refresh(job)
    emit("generation_job_launch_requested", job_id=job_id, step="api", trace_id=_trace_id_from_request(request))
    background_tasks.add_task(run_generation_job_pipeline, jid)
    return {"status": "running", "job_id": job_id}


@router.post("/{job_id}/cancel")
async def cancel_generation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    """Request cooperative cancellation of a running (or pending) media job."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    res = await db.execute(
        update(GenerationJob)
        .where(
            GenerationJob.id == jid,
            GenerationJob.status.in_(("running", "pending")),
        )
        .values(status="cancelling")
    )
    await db.commit()
    if res.rowcount == 0:
        svc = GenerationJobService(db)
        job = await svc.get_job(jid, with_children=False)
        if job and job.status == "cancelling":
            return {"status": "cancelling", "job_id": job_id}
        if job and job.status == "cancelled":
            return {"status": "cancelled", "job_id": job_id}
        raise HTTPException(
            status_code=400,
            detail="Job cannot be cancelled in its current state (must be running or pending).",
        )
    emit(
        "job_cancellation_requested",
        job_id=job_id,
        step="api",
        new_status="cancelling",
    )
    return {"status": "cancelling", "job_id": job_id}


class GenerationJobTargetAccountsBody(BaseModel):
    target_account_ids: list[str] = Field(
        default_factory=list,
        description="Account UUIDs used for queue labels and publishing.",
    )


@router.patch("/{job_id}/target-accounts", response_model=GenerationJobListItem)
async def set_generation_job_target_accounts(
    job_id: str,
    body: GenerationJobTargetAccountsBody,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    account_ids = await _resolve_target_accounts(db, body.target_account_ids)
    svc = GenerationJobService(db)
    try:
        job = await svc.set_target_accounts(jid, account_ids)
    except LookupError:
        raise HTTPException(status_code=404, detail="Job not found") from None
    await db.commit()

    payload = job.input_payload if isinstance(job.input_payload, dict) else {}
    username_by_id: dict[str, str] = {}
    if account_ids:
        account_rows = await db.execute(
            text(
                """
                SELECT id::text, username
                FROM accounts
                WHERE id = ANY(CAST(:account_ids AS uuid[]))
                """
            ),
            {"account_ids": account_ids},
        )
        username_by_id = {
            str(r[0]): str(r[1]).strip()
            for r in account_rows.fetchall()
            if r[1] and str(r[1]).strip()
        }
    target_usernames = [username_by_id[aid] for aid in account_ids if aid in username_by_id]
    return GenerationJobListItem(
        id=str(job.id),
        status=str(job.status),
        progress=int(job.progress or 0),
        execution_mode=str(getattr(job, "execution_mode", "scene_based") or "scene_based"),
        caption=_caption_from_payload(payload),
        topic=(str(payload.get("topic") or "").strip() or None),
        content_type=(str(payload.get("content_type") or "").strip() or None),
        niche=(str(payload.get("niche") or "").strip() or None),
        target_account_count=len(account_ids),
        target_account_ids=account_ids,
        target_account_usernames=target_usernames,
        output_url=(str(job.output_url).strip() if job.output_url else None),
        preview_url=None,
        publish_intent_id=None,
        publish_intent_status=None,
        created_at=job.created_at.isoformat() if job.created_at else None,
        updated_at=job.updated_at.isoformat() if job.updated_at else None,
    )


@router.delete("/{job_id}")
async def delete_generation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    try:
        await svc.delete_job(jid)
    except LookupError:
        raise HTTPException(status_code=404, detail="Job not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    return {"deleted": True, "job_id": job_id}


class CancelStepBody(BaseModel):
    step: str


@router.post("/{job_id}/cancel-step")
async def cancel_generation_step(job_id: str, body: CancelStepBody, db: AsyncSession = Depends(get_db)):
    """Request cooperative cancellation of a single pipeline step (job keeps running)."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    valid = {name for name, _ in PIPELINE_STEPS}
    if body.step not in valid:
        raise HTTPException(status_code=400, detail="Invalid step")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("cancelling", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel an individual step while the job is cancelling or cancelled.",
        )
    if job.status not in ("running", "pending"):
        raise HTTPException(
            status_code=400,
            detail="Step cancel only applies while the job is running or pending.",
        )
    ctrl = _step_control_for_response(job)
    cur = ctrl.get(body.step)
    if cur in ("cancelling", "cancelled"):
        emit(
            "step_cancellation_requested",
            job_id=job_id,
            step=body.step,
            duplicate=True,
        )
        return {"status": cur, "job_id": job_id, "step": body.step}
    step_row = next((s for s in job.steps if s.step_name == body.step), None)
    if not step_row:
        raise HTTPException(status_code=404, detail="Step not found on job")
    if step_row.status != "running" and cur != "running":
        raise HTTPException(status_code=400, detail="Step is not running; nothing to cancel.")
    merged = _step_control_for_response(job)
    merged[body.step] = "cancelling"
    job.step_control = merged
    svc.touch(job)
    await db.commit()
    emit(
        "step_cancellation_requested",
        job_id=job_id,
        step=body.step,
        new_state="cancelling",
    )
    return {"status": "cancelling", "job_id": job_id, "step": body.step}


@router.post("/{job_id}/ready")
async def mark_job_ready(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "draft":
        raise HTTPException(status_code=400, detail="Only draft jobs can be marked ready")
    job.status = "ready"
    svc.touch(job)
    await svc.append_log(job, "Job marked ready for launch.")
    return {"status": "ready", "job_id": job_id}


@router.get("/{job_id}/cost-estimate")
async def get_cost_estimate(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.scenes:
        raise HTTPException(status_code=400, detail="No scenes on job yet")
    return _compute_cost_estimate(job)


@router.get("/{job_id}/trace")
async def get_generation_job_trace(
    job_id: str,
    limit: Optional[int] = Query(None, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
):
    """Structured pipeline trace lines (JSON) for this job from ``logs/pipeline_trace.log``."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "events": get_job_trace(job_id, limit=limit)}


@router.get("/{job_id}", response_model=GenerationJobDetailOut)
async def get_generation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize_job(job)


@router.get("/{job_id}/scenes", response_model=list[GenerationSceneOut])
async def list_job_scenes(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    return [
        GenerationSceneOut(
            id=str(sc.id),
            scene_index=sc.scene_index,
            prompt=sc.prompt,
            duration=sc.duration,
            scene_role=sc.scene_role,
            status=sc.status,
            start_image_url=sc.start_image_url,
            end_image_url=sc.end_image_url,
            video_url=sc.video_url,
            error_message=sc.error_message,
            metadata=dict(sc.scene_metadata or {}),
        )
        for sc in scenes
    ]


@router.get("/{job_id}/steps", response_model=list[GenerationStepOut])
async def list_job_steps(job_id: str, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    steps = sorted(job.steps, key=lambda x: x.step_order)
    return [GenerationStepOut.from_orm_step(s) for s in steps]


class RetryStepBody(BaseModel):
    step_name: str


async def _claim_job_for_pipeline_retry(db: AsyncSession, jid: uuid.UUID) -> None:
    """Atomically mark a finished job as running so duplicate retry POSTs cannot stack pipelines."""
    res = await db.execute(
        update(GenerationJob)
        .where(
            GenerationJob.id == jid,
            GenerationJob.status.in_(("failed", "completed")),
        )
        .values(status="running")
    )
    await db.commit()
    if res.rowcount:
        return
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "running":
        raise HTTPException(
            status_code=409,
            detail="Pipeline is already running for this job. Wait before retrying again.",
        )
    raise HTTPException(
        status_code=400,
        detail=f"Cannot retry pipeline while job status is {job.status}.",
    )


@router.post("/{job_id}/retry-step")
async def retry_step(
    job_id: str,
    body: RetryStepBody,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job id")
    valid = {name for name, _ in PIPELINE_STEPS}
    if body.step_name not in valid:
        raise HTTPException(status_code=400, detail="Invalid step_name")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("cancelling", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot retry steps while the job is cancelling or cancelled.")
    if job.status in ("draft", "ready"):
        raise HTTPException(
            status_code=400,
            detail="Launch the job before retrying pipeline steps.",
        )
    ctrl = _step_control_for_response(job)
    if ctrl.get(body.step_name) == "cancelling":
        raise HTTPException(
            status_code=400,
            detail="Wait for the step to finish cancelling before retrying.",
        )

    await _claim_job_for_pipeline_retry(db, jid)
    background_tasks.add_task(run_generation_job_pipeline_from, jid, body.step_name)
    return {"status": "retry_scheduled", "step_name": body.step_name}


class RetrySceneBody(BaseModel):
    scene_id: str


@router.post("/{job_id}/retry-scene")
async def retry_scene(
    job_id: str,
    body: RetrySceneBody,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
        sid = uuid.UUID(body.scene_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=False)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ("cancelling", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot retry scene while the job is cancelling or cancelled.")
    if job.status in ("draft", "ready"):
        raise HTTPException(
            status_code=400,
            detail="Launch the job before retrying scene media.",
        )
    sc = await svc.get_scene(jid, sid)
    if not sc:
        raise HTTPException(status_code=404, detail="Scene not found")

    await _claim_job_for_pipeline_retry(db, jid)
    background_tasks.add_task(run_retry_scene, jid, sid)
    return {"status": "retry_scheduled", "scene_id": body.scene_id}


class ReorderScenesBody(BaseModel):
    scene_ids: list[str] = Field(..., min_length=1)


@router.put("/{job_id}/scenes/reorder", response_model=list[GenerationSceneOut])
async def reorder_scenes(job_id: str, body: ReorderScenesBody, db: AsyncSession = Depends(get_db)):
    try:
        jid = uuid.UUID(job_id)
        ordered = [uuid.UUID(x) for x in body.scene_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job or scene id")
    svc = GenerationJobService(db)
    job = await svc.get_job(jid, with_children=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    have = {sc.id for sc in scenes}
    if set(ordered) != have:
        raise HTTPException(status_code=400, detail="scene_ids must list every scene exactly once")
    for idx, sid in enumerate(ordered):
        sc = next(s for s in scenes if s.id == sid)
        sc.scene_index = idx
        sc.updated_at = datetime.now(timezone.utc)
    await db.flush()
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    return [
        GenerationSceneOut(
            id=str(sc.id),
            scene_index=sc.scene_index,
            prompt=sc.prompt,
            duration=sc.duration,
            scene_role=sc.scene_role,
            status=sc.status,
            start_image_url=sc.start_image_url,
            end_image_url=sc.end_image_url,
            video_url=sc.video_url,
            error_message=sc.error_message,
            metadata=dict(sc.scene_metadata or {}),
        )
        for sc in scenes
    ]


class ScenePreviewBody(BaseModel):
    kind: str = Field(default="image", description="image | video")


@router.post("/{job_id}/scenes/{scene_id}/preview", response_model=GenerationSceneOut)
async def preview_scene_media(
    job_id: str,
    scene_id: str,
    body: ScenePreviewBody,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid id")
    if body.kind not in ("image", "video"):
        raise HTTPException(status_code=400, detail="kind must be image or video")
    try:
        sc = await generate_scene_preview(db, jid, sid, body.kind)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    await db.refresh(sc)
    return GenerationSceneOut(
        id=str(sc.id),
        scene_index=sc.scene_index,
        prompt=sc.prompt,
        duration=sc.duration,
        scene_role=sc.scene_role,
        status=sc.status,
        start_image_url=sc.start_image_url,
        end_image_url=sc.end_image_url,
        video_url=sc.video_url,
        error_message=sc.error_message,
        metadata=dict(sc.scene_metadata or {}),
    )


class ScenePatchBody(BaseModel):
    prompt: Optional[str] = None
    duration: Optional[int] = Field(default=None, ge=3, le=5)
    scene_role: Optional[str] = Field(default=None, max_length=32)
    metadata: Optional[dict[str, Any]] = None


@router.patch("/{job_id}/scenes/{scene_id}")
async def patch_scene(
    job_id: str,
    scene_id: str,
    body: ScenePatchBody,
    db: AsyncSession = Depends(get_db),
):
    try:
        jid = uuid.UUID(job_id)
        sid = uuid.UUID(scene_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid id")
    svc = GenerationJobService(db)
    sc = await svc.get_scene(jid, sid)
    if not sc:
        raise HTTPException(status_code=404, detail="Scene not found")
    if body.prompt is not None:
        sc.prompt = body.prompt
    if body.duration is not None:
        sc.duration = body.duration
    if body.scene_role is not None:
        sc.scene_role = body.scene_role
    if body.metadata is not None:
        merged = dict(sc.scene_metadata or {})
        merged.update(body.metadata)
        sc.scene_metadata = merged
    sc.updated_at = datetime.now(timezone.utc)
    await db.refresh(sc)
    return GenerationSceneOut(
        id=str(sc.id),
        scene_index=sc.scene_index,
        prompt=sc.prompt,
        duration=sc.duration,
        scene_role=sc.scene_role,
        status=sc.status,
        start_image_url=sc.start_image_url,
        end_image_url=sc.end_image_url,
        video_url=sc.video_url,
        error_message=sc.error_message,
        metadata=dict(sc.scene_metadata or {}),
    )
