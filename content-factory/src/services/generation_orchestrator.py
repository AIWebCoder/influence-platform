from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import mimetypes
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.redis import push_to_queue
from src.models.generation_job import GenerationJob, GenerationScene, GenerationStep
from src.services.anthropic_service import AnthropicService
from src.services.gemini_service import GeminiService
from src.services.generation_job_service import PIPELINE_STEPS, GenerationJobService, default_step_control
from src.services.generation_progress import provider_poll_step_progress, sync_job_progress
from src.services.kie_service import KieService
from src.services.seedance_service import SeedanceService
from src.services.ailiveai_service import AiliveaiService, _blocking_optionals_from_persona
from src.services.pipeline_trace import emit

logger = logging.getLogger(__name__)

_pipeline_active: set[uuid.UUID] = set()
_pipeline_active_lock = asyncio.Lock()


async def try_begin_exclusive_job_pipeline(job_id: uuid.UUID) -> bool:
    """Return False when this job already has a pipeline/scene-retry task in flight (same process)."""
    async with _pipeline_active_lock:
        if job_id in _pipeline_active:
            return False
        _pipeline_active.add(job_id)
        return True


async def end_exclusive_job_pipeline(job_id: uuid.UUID) -> None:
    async with _pipeline_active_lock:
        _pipeline_active.discard(job_id)


class GenerationPipelineCancelled(Exception):
    """Raised when cooperative cancellation completes (DB already finalized)."""


class StepCancelled(Exception):
    """Raised when cooperative step-level cancellation completes (step_control + step row updated)."""

    def __init__(self, step_name: str):
        self.step_name = step_name
        super().__init__(step_name)


def _seedance_result_is_local_poll_timeout(result: dict[str, Any]) -> bool:
    """True when SeedanceService gave up polling; Kie may still be processing the same task."""
    return "TIMEOUT" in str(result.get("error") or "").upper()


def _step_control_dict(job: GenerationJob) -> dict[str, str]:
    names = {name for name, _ in PIPELINE_STEPS}
    raw = dict(job.step_control or {})
    out = {name: "pending" for name in names}
    for k, v in raw.items():
        if k in out and v is not None:
            out[k] = str(v)
    return out


def _set_job_step_control(job: GenerationJob, updates: dict[str, str]) -> None:
    base = _step_control_dict(job)
    base.update(updates)
    job.step_control = dict(base)


def _merge_default_step_control(job: GenerationJob) -> bool:
    """Ensure all pipeline keys exist. Returns True if job.step_control was mutated."""
    merged = default_step_control()
    merged.update({k: v for k, v in (job.step_control or {}).items() if k in merged})
    if merged != (job.step_control or {}):
        job.step_control = merged
        return True
    return False


async def _abort_if_step_cancelling(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
    step_label: str,
) -> None:
    await db.refresh(job, attribute_names=["step_control"])
    ctrl = _step_control_dict(job)
    if ctrl.get(step_label) == "cancelled":
        raise StepCancelled(step_label)
    if ctrl.get(step_label) != "cancelling":
        return
    ctrl[step_label] = "cancelled"
    job.step_control = ctrl
    svc.touch(job)
    await svc.append_log(job, f"Step cooperative cancel finalized: {step_label}", "info")
    await db.commit()
    emit(
        "step_cancelled",
        job_id=str(job.id),
        step=step_label,
        cancellation_scope="step",
    )
    raise StepCancelled(step_label)


async def _abort_if_job_or_step_cancelling(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
    step_orm: Optional[GenerationStep],
    step_label: str,
    *,
    scene_index: Optional[int] = None,
) -> None:
    await _abort_if_job_cancelling(db, svc, job, step_orm, step_label, scene_index=scene_index)
    await _abort_if_step_cancelling(db, svc, job, step_label)


async def should_cancel(job_id: uuid.UUID, db: Optional[AsyncSession] = None) -> bool:
    """True when the job row is ``cancelling`` (fresh read; safe across sessions)."""
    if db is not None:
        r = await db.execute(select(GenerationJob.status).where(GenerationJob.id == job_id))
        st = r.scalar_one_or_none()
        return st == "cancelling"
    async with AsyncSessionLocal() as s:
        r = await s.execute(select(GenerationJob.status).where(GenerationJob.id == job_id))
        st = r.scalar_one_or_none()
        return st == "cancelling"


async def _finalize_job_cancelled(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
    step: Optional[GenerationStep],
    step_label: Optional[str],
) -> None:
    job.status = "cancelled"
    job.step_control = {name: "cancelled" for name, _ in PIPELINE_STEPS}
    if step is not None and step.status in ("running", "pending"):
        step.status = "cancelled"
        step.progress = 0
        step.error_message = "Cancelled by user"
        emit(
            "step_cancelled",
            job_id=str(job.id),
            step=step_label or getattr(step, "step_name", None) or "pipeline",
            step_name=getattr(step, "step_name", None),
            cancellation_scope="job",
        )
    svc.touch(job)
    await svc.append_log(job, "Job cancelled by user.", "info")
    emit("job_cancelled", job_id=str(job.id), step=step_label or "pipeline")
    await db.commit()


async def _abort_if_job_cancelling(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
    step: Optional[GenerationStep],
    step_label: Optional[str],
    *,
    scene_index: Optional[int] = None,
) -> None:
    if not await should_cancel(job.id, db):
        return
    if scene_index is not None:
        emit(
            "scene_cancelled",
            job_id=str(job.id),
            step=step_label or "pipeline",
            scene_index=scene_index,
            reason="job_cancelling",
        )
    await _finalize_job_cancelled(db, svc, job, step, step_label)
    raise GenerationPipelineCancelled()

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _prefer_anthropic() -> bool:
    if str(getattr(settings, "TEXT_PROVIDER_PRIMARY", "gemini")).strip().lower() == "anthropic":
        return bool((settings.resolved_anthropic_api_key() or "").strip())
    # Default priority is Gemini when both are configured.
    if (settings.GEMINI_API_KEY or "").strip():
        return False
    return bool((settings.resolved_anthropic_api_key() or "").strip())


def _is_anthropic_credit_error(err: Exception) -> bool:
    msg = str(err or "").lower()
    return "credit balance is too low" in msg or "plans & billing" in msg


def _ailive_appearance_from_profile(profile: dict[str, Any]) -> str:
    ca = str(profile.get("character_appearance") or "").strip()
    if ca:
        return ca[:1500]
    app = str(profile.get("appearance_for_image_model") or "").strip()
    if app:
        return app[:1500]
    parts: list[str] = []
    for label, key in (
        ("Age", "age"),
        ("Heritage", "nationalities"),
        ("Height", "height"),
        ("Face", "face"),
        ("Expressions", "expressions_grimaces"),
        ("Hair", "hair"),
        ("Skin", "skin_tone"),
        ("Body", "body_shape"),
        ("Wardrobe", "wardrobe_style"),
    ):
        v = str(profile.get(key) or "").strip()
        if v:
            parts.append(f"{label}: {v}")
    return ", ".join(parts)[:1500] if parts else ""


def _ailive_fallback_appearance(niche: str, topic: str) -> str:
    t = (topic or "").strip() or (niche or "").strip() or "the content"
    n = (niche or "").strip() or "content"
    return (
        f"On-screen creator for the {n} niche: approachable, confident presence. Tone aligned with: {t}. "
        "Soft cinematic key light, shallow depth of field, clean modern background, natural skin texture."
    )[:1500]


def _ailiveai_persona_gender_from_payload(payload: dict[str, Any]) -> str:
    g = str(payload.get("ailiveai_gender") or "").strip().upper()
    return g if g in ("MALE", "FEMALE", "TRANS") else "FEMALE"


async def _generate_ailive_persona_if_needed(
    *,
    need_persona: bool,
    appearance_override: str,
    use_anthropic: bool,
    text_svc: Any,
    niche: str,
    topic: str,
    mode: str,
    persona_gender: str,
    gtrace: dict[str, Any],
) -> Optional[dict[str, Any]]:
    """Returns structured persona dict, or None if skipped or generation failed."""
    if not need_persona or appearance_override:
        return None
    if use_anthropic:
        try:
            return await text_svc.generate_ailiveai_persona_profile(
                niche=niche, topic=topic, mode=mode, persona_gender=persona_gender
            )
        except Exception as e:
            if settings.GEMINI_API_KEY and _is_anthropic_credit_error(e):
                emit(
                    "text_provider_fallback",
                    job_id=str(gtrace.get("job_id", "")),
                    step=str(gtrace.get("step", "persona")),
                    from_provider="anthropic",
                    to_provider="gemini",
                    reason="anthropic_credit_low",
                    level="warning",
                )
                gemini = GeminiService()
                return await gemini.generate_ailiveai_persona_profile(
                    niche=niche, topic=topic, mode=mode, persona_gender=persona_gender, trace=gtrace
                )
            raise
    try:
        return await text_svc.generate_ailiveai_persona_profile(
            niche=niche, topic=topic, mode=mode, persona_gender=persona_gender, trace=gtrace
        )
    except Exception as e:
        logger.warning("ailiveai persona generation failed: %s", e)
        return None


def _ffmpeg_concat_sync(urls: list[str]) -> tuple[Optional[str], dict[str, Any]]:
    meta: dict[str, Any] = {"clips": len(urls)}
    if not shutil.which("ffmpeg"):
        meta["ffmpeg"] = "not_found"
        return None, meta
    if len(urls) < 2:
        meta["ffmpeg"] = "skipped_single_clip"
        return None, meta

    tmp = Path(tempfile.mkdtemp(prefix="genjob_asm_"))
    local_files: list[Path] = []
    try:
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            for i, u in enumerate(urls):
                p = tmp / f"clip_{i}.mp4"
                r = client.get(u)
                r.raise_for_status()
                p.write_bytes(r.content)
                local_files.append(p)

        list_file = tmp / "list.txt"
        lines = [f"file '{p.as_posix()}'" for p in local_files]
        list_file.write_text("\n".join(lines), encoding="utf-8")
        out_path = tmp / "assembled.mp4"
        proc = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c",
                "copy",
                str(out_path),
            ],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if proc.returncode != 0 or not out_path.exists():
            meta["ffmpeg"] = "failed"
            meta["stderr"] = (proc.stderr or "")[-2000:]
            return None, meta
        meta["ffmpeg"] = "ok"
        meta["local_path"] = str(out_path)
        return str(out_path), meta
    except Exception as e:
        meta["ffmpeg"] = "error"
        meta["error"] = str(e)
        return None, meta


async def populate_draft_scenes(db, job: GenerationJob) -> None:
    """Create scene rows + caption in DB while job is in ``draft`` (no media pipeline)."""
    svc = GenerationJobService(db)
    payload = job.input_payload or {}
    niche = payload.get("niche") or "lifestyle"
    topic = payload.get("topic") or niche
    if payload.get("template_visual_hint"):
        topic = f"{topic}. Visual direction: {str(payload['template_visual_hint'])[:500]}"
    caption_topic = topic
    if payload.get("template_caption_hint"):
        caption_topic = f"{topic}\n\nCaption style: {str(payload['template_caption_hint'])[:800]}"
    content_type = payload.get("content_type") or payload.get("type") or "reel"
    mode = payload.get("mode") or "faceless"

    gid = str(job.id)
    gtrace = {"job_id": gid, "step": "populate_draft"}
    draft_t0 = time.monotonic()
    emit("draft_populate_start", job_id=gid, step="populate_draft")
    use_anthropic = _prefer_anthropic()
    text_svc = AnthropicService() if use_anthropic else GeminiService()
    exec_mode = str(getattr(job, "execution_mode", "") or "").strip()
    raw_scene_count = max(1, int(payload.get("scene_count") or 7))
    scene_count = _draft_scene_count(exec_mode, payload)
    if settings.GENERATION_DEMO_MODE and scene_count < raw_scene_count:
        emit(
            "demo_scene_count_capped",
            job_id=gid,
            step="populate_draft",
            requested_scenes=raw_scene_count,
            applied_scenes=scene_count,
            demo_max_scenes=settings.GENERATION_DEMO_MAX_SCENES,
        )
    ailive_topic_scene = exec_mode == "ailiveai_single_video"
    appearance_override = str(payload.get("ailiveai_image_appearance") or "").strip()
    persona_gender = _ailiveai_persona_gender_from_payload(payload)
    persona_profile = await _generate_ailive_persona_if_needed(
        need_persona=ailive_topic_scene,
        appearance_override=appearance_override,
        use_anthropic=use_anthropic,
        text_svc=text_svc,
        niche=niche,
        topic=topic,
        mode=mode,
        persona_gender=persona_gender,
        gtrace=gtrace,
    )
    if use_anthropic:
        try:
            plan = await text_svc.generate_scene_plan(
                niche=niche,
                topic=topic,
                content_type=content_type,
                mode=mode,
                scene_count=scene_count,
                ailiveai_on_camera_topic_scene=ailive_topic_scene,
            )
            copy = await text_svc.generate_caption(niche=niche, topic=caption_topic)
        except Exception as e:
            if settings.GEMINI_API_KEY and _is_anthropic_credit_error(e):
                emit(
                    "text_provider_fallback",
                    job_id=gid,
                    step="populate_draft",
                    from_provider="anthropic",
                    to_provider="gemini",
                    reason="anthropic_credit_low",
                    level="warning",
                )
                gemini = GeminiService()
                plan = await gemini.generate_scene_plan(
                    niche=niche,
                    topic=topic,
                    content_type=content_type,
                    mode=mode,
                    scene_count=scene_count,
                    trace=gtrace,
                    ailiveai_on_camera_topic_scene=ailive_topic_scene,
                )
                copy = await gemini.generate_caption(niche=niche, topic=caption_topic, trace=gtrace)
            else:
                raise
    else:
        plan = await text_svc.generate_scene_plan(
            niche=niche,
            topic=topic,
            content_type=content_type,
            mode=mode,
            scene_count=scene_count,
            trace=gtrace,
            ailiveai_on_camera_topic_scene=ailive_topic_scene,
        )
        copy = await text_svc.generate_caption(niche=niche, topic=caption_topic, trace=gtrace)
    merged = dict(payload)
    if ailive_topic_scene and not appearance_override:
        if persona_profile:
            merged["ailiveai_persona"] = persona_profile
            app_line = _ailive_appearance_from_profile(persona_profile)
            merged["ailiveai_image_appearance"] = app_line or _ailive_fallback_appearance(niche, topic)
        else:
            merged["ailiveai_image_appearance"] = _ailive_fallback_appearance(niche, topic)
    merged["caption"] = copy.get("caption", "")
    hashtags = list(copy.get("hashtags") or [])
    template_tags = payload.get("template_hashtags") or []
    if template_tags:
        hashtags = list(dict.fromkeys([*hashtags, *[str(t) for t in template_tags]]))[:30]
    merged["hashtags"] = hashtags
    if exec_mode == "multi_scene_single_video":
        merged["scene_count"] = 1
    job.input_payload = merged

    for row in plan:
        db.add(
            GenerationScene(
                job_id=job.id,
                scene_index=int(row["scene_index"]),
                prompt=row["prompt"][:8000],
                duration=5,
                scene_role=row.get("role"),
                status="pending",
                scene_metadata={},
            )
        )
    step = await svc.get_step(job.id, "scene_generation")
    if step:
        step.status = "completed"
        step.progress = 100
        step.step_metadata = {"phase": "draft", "scene_count": len(plan)}
    ctrl0 = default_step_control()
    ctrl0["scene_generation"] = "completed"
    job.step_control = ctrl0
    job.progress = 0
    sync_job_progress(job)
    if ailive_topic_scene:
        draft_msg = "Draft persona, scene, and caption generated. Launch to run media pipeline."
    elif exec_mode == "multi_scene_single_video":
        draft_msg = "Draft video prompt and caption generated. Launch to run media pipeline."
    else:
        draft_msg = "Draft scenes and caption generated. Launch to run media pipeline."
    await svc.append_log(job, draft_msg)
    svc.touch(job)
    await db.flush()
    emit(
        "draft_populate_done",
        job_id=gid,
        step="populate_draft",
        scene_rows=len(plan),
        execution_mode=exec_mode,
        scene_count=scene_count,
        text_provider="anthropic" if use_anthropic else "gemini",
        duration_ms=(time.monotonic() - draft_t0) * 1000,
    )


async def _emit_job_pipeline_summary(
    svc: GenerationJobService, job_id: uuid.UUID, wall_ms: float, status: str, error: Optional[str] = None
) -> None:
    job = await svc.get_job(job_id, with_children=True)
    if not job:
        emit(
            "job_pipeline_summary",
            job_id=str(job_id),
            scenes_total=0,
            images_both_keyframes=0,
            images_success=0,
            images_partial=0,
            videos_success=0,
            videos_failed=0,
            output_mode="none",
            assembly_mode=None,
            total_duration_ms=round(wall_ms, 2),
            pipeline_status=status,
            status=status,
            error=error,
        )
        return
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    both = sum(1 for s in scenes if s.start_image_url and s.end_image_url)
    partial = sum(1 for s in scenes if str(s.status or "") == "partial")
    v_ok = sum(1 for s in scenes if s.video_url)
    v_fail = max(0, len(scenes) - v_ok)
    assembly_mode: Optional[str] = None
    if job.steps:
        for st in job.steps:
            if st.step_name == "assembly" and st.step_metadata:
                assembly_mode = (st.step_metadata or {}).get("assembly_mode")
                break
    if v_ok <= 0:
        output_mode = "none"
    elif v_ok == 1:
        output_mode = "single"
    else:
        output_mode = "multi"
    emit(
        "job_pipeline_summary",
        job_id=str(job_id),
        scenes_total=len(scenes),
        images_both_keyframes=both,
        images_success=both,
        images_partial=partial,
        videos_success=v_ok,
        videos_failed=v_fail,
        output_mode=output_mode,
        assembly_mode=assembly_mode,
        total_duration_ms=round(wall_ms, 2),
        pipeline_status=status,
        status=status,
        error=error,
    )


def _generation_media_delivered(job: GenerationJob) -> bool:
    """True when the media step finished and a public output URL was stored on the job."""
    if not str(job.output_url or "").strip():
        return False
    exec_mode = str(getattr(job, "execution_mode", "") or "").strip()
    if exec_mode == "single_image":
        for step in job.steps or []:
            if step.step_name == "image_generation" and step.status == "completed":
                return True
        return False
    for step in job.steps or []:
        if step.step_name == "video_generation" and step.status == "completed":
            return True
    return False


def _generation_video_delivered(job: GenerationJob) -> bool:
    return _generation_media_delivered(job)


async def _finalize_job_after_generation(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
) -> None:
    """Non-blocking bookkeeping after media succeeded; must not fail the job."""
    gid = str(job.id)
    try:
        await _register_generated_assets(db, job)
    except Exception as e:
        await svc.append_log(job, f"Asset registration skipped: {e}", "warning")
        emit(
            "post_generation_asset_register_failed",
            job_id=gid,
            step="pipeline",
            error=str(e),
            level="warning",
        )
    try:
        from src.services.content_service import ContentService

        await ContentService(db).upsert_from_generation_job(job)
    except Exception as e:
        await svc.append_log(job, f"Calendar sync skipped: {e}", "warning")
        emit(
            "post_generation_calendar_sync_failed",
            job_id=gid,
            step="pipeline",
            error=str(e),
            level="warning",
        )


async def _run_generation_job_pipeline_inner(job_id: uuid.UUID) -> None:
    t0 = time.perf_counter()
    async with AsyncSessionLocal() as db:
        try:
            outcome = await _execute_pipeline(db, job_id)
            await db.commit()
            wall_ms = (time.perf_counter() - t0) * 1000
            svc = GenerationJobService(db)
            if outcome == "cancelled":
                await _emit_job_pipeline_summary(svc, job_id, wall_ms, "cancelled")
            elif outcome == "completed":
                await _emit_job_pipeline_summary(svc, job_id, wall_ms, "completed")
            elif outcome == "step_cancelled":
                await _emit_job_pipeline_summary(svc, job_id, wall_ms, "step_cancelled")
            else:
                await _emit_job_pipeline_summary(
                    svc, job_id, wall_ms, "aborted" if outcome in (None, "aborted") else str(outcome)
                )
        except Exception as e:
            wall_ms = (time.perf_counter() - t0) * 1000
            logger.exception("generation job %s failed", job_id)
            await db.rollback()
            async with AsyncSessionLocal() as db2:
                svc = GenerationJobService(db2)
                job = await svc.get_job(job_id, with_children=True)
                if job and job.status != "cancelled":
                    if _generation_video_delivered(job):
                        job.status = "completed"
                        job.progress = 100
                        await svc.append_log(
                            job,
                            f"Video generated successfully. Post-processing issue (job still completed): {e}",
                            "warning",
                        )
                        svc.touch(job)
                        await db2.commit()
                        await _emit_job_pipeline_summary(svc, job_id, wall_ms, "completed")
                    else:
                        job.status = "failed"
                        await svc.append_log(job, f"Job error: {e}", "error")
                        svc.touch(job)
                        topic = None
                        if isinstance(job.input_payload, dict):
                            topic = str(job.input_payload.get("topic") or "").strip() or None
                        await db2.commit()
                        try:
                            from src.services.alert_service import notify_generation_job_failed

                            await notify_generation_job_failed(db2, str(job_id), str(e), topic)
                        except Exception as alert_exc:
                            logger.warning("generation job alert failed: %s", alert_exc)
                        await _emit_job_pipeline_summary(svc, job_id, wall_ms, "failed", error=str(e))
                else:
                    await _emit_job_pipeline_summary(svc, job_id, wall_ms, "failed", error=str(e))


async def run_generation_job_pipeline(job_id: uuid.UUID) -> None:
    if not await try_begin_exclusive_job_pipeline(job_id):
        emit(
            "pipeline_skipped",
            job_id=str(job_id),
            reason="duplicate_pipeline_run",
            step="pipeline",
            level="warning",
        )
        return
    try:
        await _run_generation_job_pipeline_inner(job_id)
    finally:
        await end_exclusive_job_pipeline(job_id)


async def _execute_pipeline(db, job_id: uuid.UUID) -> Optional[str]:
    svc = GenerationJobService(db)
    job = await svc.get_job(job_id, with_children=True)
    if not job:
        emit("pipeline_aborted", job_id=str(job_id), reason="job_not_found", step="pipeline")
        return None

    if job.status == "cancelled":
        emit(
            "pipeline_skipped",
            job_id=str(job_id),
            reason="job_already_cancelled",
            job_status=job.status,
            step="pipeline",
            level="warning",
        )
        return "aborted"

    if job.status == "cancelling":
        job.status = "cancelled"
        svc.touch(job)
        await svc.append_log(job, "Job was stuck in cancelling; marked cancelled.", "info")
        await db.commit()
        emit("job_cancelled", job_id=str(job_id), step="pipeline", reason="stale_cancelling_state")
        return "cancelled"

    if job.status in ("draft", "ready"):
        logger.warning("pipeline skipped for job %s (status=%s)", job_id, job.status)
        emit(
            "pipeline_skipped",
            job_id=str(job_id),
            reason="invalid_job_status_for_media_pipeline",
            job_status=job.status,
            step="pipeline",
            level="warning",
        )
        return "aborted"
    if job.status == "pending":
        job.status = "running"
    elif job.status != "running":
        logger.warning("pipeline skipped for job %s (status=%s)", job_id, job.status)
        emit(
            "pipeline_skipped",
            job_id=str(job_id),
            reason="invalid_job_status",
            job_status=job.status,
            step="pipeline",
            level="warning",
        )
        return "aborted"
    svc.touch(job)
    await db.commit()

    if _merge_default_step_control(job):
        svc.touch(job)
        await db.commit()

    emit(
        "pipeline_start",
        job_id=str(job_id),
        step="pipeline",
        execution_model="fastapi_background_tasks_in_process",
        queue_used_after_media="redis_lpush_distribution_only",
    )

    try:
        await _abort_if_job_cancelling(db, svc, job, None, "pipeline")
    except GenerationPipelineCancelled:
        return "cancelled"

    steps_by_name = {s.step_name: s for s in job.steps}
    execution_mode = str(getattr(job, "execution_mode", "scene_based") or "scene_based")
    emit(
        "pipeline_execution_mode",
        job_id=str(job_id),
        step="pipeline",
        execution_mode=execution_mode,
    )

    for step_name, _order in PIPELINE_STEPS:
        step = steps_by_name.get(step_name)
        if not step:
            continue
        if step.status == "completed":
            await db.refresh(job, attribute_names=["step_control"])
            if _step_control_dict(job).get(step_name) != "completed":
                _set_job_step_control(job, {step_name: "completed"})
                svc.touch(job)
                await db.commit()
            emit(
                "pipeline_step_skipped_already_done",
                job_id=str(job_id),
                step=step_name,
            )
            continue

        try:
            await _abort_if_job_or_step_cancelling(db, svc, job, step, step_name)
        except GenerationPipelineCancelled:
            return "cancelled"

        _set_job_step_control(job, {step_name: "running"})
        step.status = "running"
        step.error_message = None
        step.progress = 0
        if step_name == "video_generation":
            md = dict(step.step_metadata or {})
            md["execution_started_at"] = datetime.now(timezone.utc).isoformat()
            step.step_metadata = md
        sync_job_progress(job)
        svc.touch(job)
        await svc.append_log(job, f"Step started: {step_name}")
        await db.commit()
        t_step = time.perf_counter()
        emit("pipeline_step_start", job_id=str(job_id), step=step_name)

        try:
            if step_name == "scene_generation":
                await _step_scene_generation(db, svc, job, step)
            elif step_name == "image_generation":
                if execution_mode == "single_image":
                    await _step_single_image_generation(db, svc, job, step)
                elif execution_mode in ("multi_scene_single_video", "ailiveai_single_video"):
                    step.step_metadata = {
                        "skipped": True,
                        "execution_mode": execution_mode,
                        "reason": "single_seedance_video_path"
                        if execution_mode == "multi_scene_single_video"
                        else "ailiveai_single_video_path",
                    }
                else:
                    await _step_image_generation(db, svc, job, step)
            elif step_name == "video_generation":
                if execution_mode == "single_image":
                    step.step_metadata = {
                        "skipped": True,
                        "execution_mode": execution_mode,
                        "reason": "photo_output_no_video",
                    }
                elif execution_mode == "multi_scene_single_video":
                    await _step_multi_scene_single_video(db, svc, job, step)
                elif execution_mode == "ailiveai_single_video":
                    await _step_ailiveai_single_video(db, svc, job, step)
                else:
                    await _step_video_generation(db, svc, job, step)
            elif step_name == "assembly":
                if execution_mode in ("multi_scene_single_video", "ailiveai_single_video", "single_image"):
                    step.step_metadata = {
                        "skipped": True,
                        "execution_mode": execution_mode,
                        "reason": "single_video_no_assembly_required"
                        if execution_mode != "single_image"
                        else "photo_output_no_assembly",
                    }
                else:
                    await _step_assembly(db, svc, job, step)
            elif step_name == "distribution":
                await _step_distribution(db, svc, job, step)
        except GenerationPipelineCancelled:
            return "cancelled"
        except StepCancelled:
            await db.refresh(job, attribute_names=["step_control", "status"])
            step.status = "cancelled"
            step.error_message = "Step cancelled by user."
            step.progress = 0
            _set_job_step_control(job, {step_name: "cancelled"})
            svc.touch(job)
            await svc.append_log(job, f"Step stopped by user: {step_name}", "info")
            await db.commit()
            emit(
                "pipeline_step_stopped",
                job_id=str(job_id),
                step=step_name,
                duration_ms=round((time.perf_counter() - t_step) * 1000, 2),
            )
            return "step_cancelled"
        except Exception as e:
            step.status = "failed"
            step.error_message = str(e)
            step.progress = 0
            _set_job_step_control(job, {step_name: "pending"})
            await svc.append_log(job, f"Step failed {step_name}: {e}", "error")
            svc.touch(job)
            await db.commit()
            emit(
                "pipeline_step_failed",
                job_id=str(job_id),
                step=step_name,
                duration_ms=round((time.perf_counter() - t_step) * 1000, 2),
                error=str(e),
                level="error",
            )
            raise

        step.status = "completed"
        step.progress = 100
        _set_job_step_control(job, {step_name: "completed"})
        sync_job_progress(job)
        svc.touch(job)
        await svc.append_log(job, f"Step completed: {step_name}")
        await db.commit()
        emit(
            "step_complete",
            job_id=str(job_id),
            step=step_name,
            duration_ms=int((time.perf_counter() - t_step) * 1000),
        )

    await db.refresh(job, attribute_names=["scenes", "steps"])
    scenes_final = sorted(job.scenes or [], key=lambda x: x.scene_index)
    if execution_mode == "single_image" and not job.output_url:
        for s in scenes_final:
            if _kie_url_ok(s.start_image_url):
                job.output_url = s.start_image_url
                emit(
                    "output_url_set_from_photo",
                    job_id=str(job_id),
                    step="pipeline",
                    scene_index=s.scene_index,
                )
                break
    v_final = sum(1 for s in scenes_final if s.video_url)
    if len(scenes_final) > 0 and v_final >= 1 and v_final < len(scenes_final):
        emit(
            "degraded_success",
            job_id=str(job_id),
            step="pipeline",
            outcome="success",
            reason="partial_video_generation",
            videos_ok=v_final,
            scenes_total=len(scenes_final),
        )
    if v_final >= 1 and not job.output_url:
        for s in scenes_final:
            if s.video_url:
                job.output_url = s.video_url
                break
        emit(
            "output_url_forced_from_first_scene_video",
            job_id=str(job_id),
            step="pipeline",
            outcome="warning",
            videos_ok=v_final,
            level="warning",
        )

    await _finalize_job_after_generation(db, svc, job)
    job.status = "completed"
    job.progress = 100
    svc.touch(job)
    await db.commit()
    return "completed"


async def _step_scene_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")
    emit("scene_generation_start", job_id=gid, step="scene_generation")
    if step.status == "completed":
        res = await db.execute(
            select(GenerationScene).where(GenerationScene.job_id == job.id).limit(1)
        )
        if res.scalars().first():
            step.progress = 100
            sync_job_progress(job)
            cr = await db.execute(
                select(func.count())
                .select_from(GenerationScene)
                .where(GenerationScene.job_id == job.id)
            )
            scene_n = int(cr.scalar_one() or 0)
            emit(
                "scene_generation_skipped",
                job_id=gid,
                step="scene_generation",
                reason="step_already_completed_with_scenes",
            )
            emit(
                "scene_generation_done",
                job_id=gid,
                step="scene_generation",
                scene_count=scene_n,
                reused_completed_step=True,
            )
            return

    res_existing = await db.execute(
        select(GenerationScene).where(GenerationScene.job_id == job.id).order_by(GenerationScene.scene_index)
    )
    existing_scenes = list(res_existing.scalars().all())
    if existing_scenes:
        emit(
            "scene_generation_skipped",
            job_id=gid,
            step="scene_generation",
            outcome="skipped",
            reason="scenes_already_in_db_no_gemini",
            scenes_total=len(existing_scenes),
        )
        emit(
            "scene_generation_done",
            job_id=gid,
            step="scene_generation",
            scene_count=len(existing_scenes),
            skipped_gemini=True,
        )
        step.progress = 100
        job.progress = max(job.progress or 0, 15)
        return

    await svc.delete_scenes_for_job(job.id)
    await db.flush()

    payload = job.input_payload or {}
    niche = payload.get("niche") or "lifestyle"
    topic = payload.get("topic") or niche
    content_type = payload.get("content_type") or payload.get("type") or "reel"
    mode = payload.get("mode") or "faceless"

    use_anthropic = _prefer_anthropic()
    text_svc = AnthropicService() if use_anthropic else GeminiService()
    exec_mode = str(getattr(job, "execution_mode", "") or "").strip()
    raw_scene_count = max(1, int(payload.get("scene_count") or 7))
    scene_count = _draft_scene_count(exec_mode, payload)
    if settings.GENERATION_DEMO_MODE and scene_count < raw_scene_count:
        emit(
            "demo_scene_count_capped",
            job_id=gid,
            step="scene_generation",
            requested_scenes=raw_scene_count,
            applied_scenes=scene_count,
            demo_max_scenes=settings.GENERATION_DEMO_MAX_SCENES,
        )
    gtrace = {"job_id": gid, "step": "scene_generation"}
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")
    ailive_topic_scene = exec_mode == "ailiveai_single_video"
    appearance_override = str(payload.get("ailiveai_image_appearance") or "").strip()
    persona_gender_sg = _ailiveai_persona_gender_from_payload(payload)
    persona_profile = await _generate_ailive_persona_if_needed(
        need_persona=ailive_topic_scene,
        appearance_override=appearance_override,
        use_anthropic=use_anthropic,
        text_svc=text_svc,
        niche=niche,
        topic=topic,
        mode=mode,
        persona_gender=persona_gender_sg,
        gtrace=gtrace,
    )
    if use_anthropic:
        try:
            plan = await text_svc.generate_scene_plan(
                niche=niche,
                topic=topic,
                content_type=content_type,
                mode=mode,
                scene_count=scene_count,
                ailiveai_on_camera_topic_scene=ailive_topic_scene,
            )
            copy = await text_svc.generate_caption(niche=niche, topic=topic)
        except Exception as e:
            if settings.GEMINI_API_KEY and _is_anthropic_credit_error(e):
                emit(
                    "text_provider_fallback",
                    job_id=gid,
                    step="scene_generation",
                    from_provider="anthropic",
                    to_provider="gemini",
                    reason="anthropic_credit_low",
                    level="warning",
                )
                gemini = GeminiService()
                plan = await gemini.generate_scene_plan(
                    niche=niche,
                    topic=topic,
                    content_type=content_type,
                    mode=mode,
                    scene_count=scene_count,
                    trace=gtrace,
                    ailiveai_on_camera_topic_scene=ailive_topic_scene,
                )
                copy = await gemini.generate_caption(niche=niche, topic=topic, trace=gtrace)
            else:
                raise
    else:
        plan = await text_svc.generate_scene_plan(
            niche=niche,
            topic=topic,
            content_type=content_type,
            mode=mode,
            scene_count=scene_count,
            trace=gtrace,
            ailiveai_on_camera_topic_scene=ailive_topic_scene,
        )
        await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")
    if not use_anthropic:
        copy = await text_svc.generate_caption(niche=niche, topic=topic, trace=gtrace)
    merged = dict(payload)
    if ailive_topic_scene and not appearance_override:
        if persona_profile:
            merged["ailiveai_persona"] = persona_profile
            app_line = _ailive_appearance_from_profile(persona_profile)
            merged["ailiveai_image_appearance"] = app_line or _ailive_fallback_appearance(niche, topic)
        else:
            merged["ailiveai_image_appearance"] = _ailive_fallback_appearance(niche, topic)
    merged["caption"] = copy.get("caption", "")
    merged["hashtags"] = copy.get("hashtags", [])
    job.input_payload = merged
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")

    for row in plan:
        await _abort_if_job_or_step_cancelling(db, svc, job, step, "scene_generation")
        db.add(
            GenerationScene(
                job_id=job.id,
                scene_index=int(row["scene_index"]),
                prompt=row["prompt"][:8000],
                duration=5,
                scene_role=row.get("role"),
                status="pending",
                scene_metadata={},
            )
        )
    step.progress = 50
    await db.flush()
    await db.refresh(job, attribute_names=["scenes"])
    step.progress = 100
    sync_job_progress(job)
    emit(
        "scene_generation_done",
        job_id=gid,
        step="scene_generation",
        scene_count=len(plan),
        outcome="success",
    )


def _kie_url_ok(url: Optional[str]) -> bool:
    if not url:
        return False
    if url == "ERROR: INSUFFICIENT_CREDITS":
        return False
    return not str(url).upper().startswith("ERROR")


def _capped_scene_count(payload: dict[str, Any]) -> int:
    raw = int(payload.get("scene_count") or 7)
    raw = max(1, raw)
    if settings.GENERATION_DEMO_MODE and settings.GENERATION_ENABLE_DEMO_CAPS:
        return min(raw, max(1, int(settings.GENERATION_DEMO_MAX_SCENES)))
    return raw


def _draft_scene_count(exec_mode: str, payload: dict[str, Any]) -> int:
    """Motion, Bolt, and Photo use one scene; Aura uses multi-scene storyboards."""
    mode = str(exec_mode or "").strip()
    if mode in ("ailiveai_single_video", "multi_scene_single_video", "single_image"):
        return 1
    return _capped_scene_count(payload)


def _scene_eligible_for_video(sc: GenerationScene) -> bool:
    if sc.status == "completed":
        return True
    if settings.GENERATION_DEMO_MODE and sc.status == "partial":
        return _kie_url_ok(sc.start_image_url) or _kie_url_ok(sc.end_image_url)
    return False


def _infer_asset_type_and_mime(url: str) -> tuple[str, str]:
    mime, _enc = mimetypes.guess_type(url)
    lowered = (url or "").lower()
    if mime and mime.startswith("video/"):
        return "video", mime
    if any(lowered.endswith(ext) for ext in (".mp4", ".mov", ".webm", ".mkv", ".avi")):
        return "video", mime or "video/mp4"
    if any(lowered.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return "image", mime or "image/jpeg"
    return "image", mime or "application/octet-stream"


def _asset_object_key(url: str, asset_type: str, job_id: uuid.UUID) -> str:
    basename = (url.split("?")[0].rstrip("/").split("/")[-1] or "").strip()
    if not basename:
        checksum = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
        basename = f"{checksum}.bin"
    return f"generated/{job_id}/{asset_type}/{basename}"


async def _register_generated_assets(db: AsyncSession, job: GenerationJob) -> None:
    media_urls: list[str] = []
    if job.output_url:
        media_urls.append(str(job.output_url))
    for sc in sorted(job.scenes or [], key=lambda x: x.scene_index):
        if sc.video_url:
            media_urls.append(str(sc.video_url))
        if sc.start_image_url:
            media_urls.append(str(sc.start_image_url))
        if sc.end_image_url:
            media_urls.append(str(sc.end_image_url))

    uniq_urls: list[str] = []
    seen: set[str] = set()
    for raw in media_urls:
        u = (raw or "").strip()
        if not u or u in seen:
            continue
        seen.add(u)
        uniq_urls.append(u)
    if not uniq_urls:
        return

    existing_rows = await db.execute(
        text("SELECT public_url FROM generated_assets WHERE generation_job_id = :job_id"),
        {"job_id": str(job.id)},
    )
    existing_urls = {str(r[0]) for r in existing_rows.fetchall() if r[0]}

    for url in uniq_urls:
        if url in existing_urls:
            continue
        asset_type, mime_type = _infer_asset_type_and_mime(url)
        await db.execute(
            text(
                """
                INSERT INTO generated_assets (
                    generation_job_id, asset_type, storage_provider, object_key, public_url,
                    mime_type, size_bytes, duration_seconds, width, height, checksum_sha256, status
                ) VALUES (
                    :generation_job_id, :asset_type, :storage_provider, :object_key, :public_url,
                    :mime_type, :size_bytes, :duration_seconds, :width, :height, :checksum_sha256, 'ready'
                )
                """
            ),
            {
                "generation_job_id": str(job.id),
                "asset_type": asset_type,
                "storage_provider": "url",
                "object_key": _asset_object_key(url, asset_type, job.id),
                "public_url": url,
                "mime_type": mime_type,
                "size_bytes": 0,
                "duration_seconds": None,
                "width": None,
                "height": None,
                "checksum_sha256": hashlib.sha256(url.encode("utf-8")).hexdigest(),
            },
        )


def build_multi_scene_prompt(scenes: list[GenerationScene], total_duration: int) -> str:
    ordered = sorted(scenes, key=lambda x: x.scene_index)
    if len(ordered) == 1:
        prompt = (ordered[0].prompt or "").strip()
        if prompt:
            return prompt
        return f"Cinematic short video, approximately {int(total_duration)} seconds."
    chunks = ["Create a continuous cinematic video.", "", "Narrative progression:", ""]
    for i, sc in enumerate(ordered, start=1):
        chunks.append(f"{i}. {(sc.prompt or '').strip()}")
    chunks.extend(
        [
            "",
            "Requirements:",
            "- Maintain visual continuity across all scenes",
            "- Smooth, natural transitions (no abrupt cuts)",
            "- Consistent characters, lighting, and environment",
            "- The video should feel like a single continuous shot",
            "",
            f"Target duration: approximately {int(total_duration)} seconds",
        ]
    )
    return "\n".join(chunks).strip()


async def _kie_generate_video_with_retry(
    kie: KieService,
    prompt: str,
    duration: int,
    trace: dict[str, Any],
) -> dict[str, Any]:
    """Up to 1 + GENERATION_KIE_VIDEO_MAX_RETRIES Kie create+poll cycles for retryable terminals."""
    r = await kie.generate_video(prompt, duration=duration, trace=trace)
    max_retries = max(0, int(getattr(settings, "GENERATION_KIE_VIDEO_MAX_RETRIES", 1)))
    n = 0
    while (
        n < max_retries
        and not r.get("url")
        and str(r.get("terminal_status") or "") in ("TIMEOUT", "SUCCESS_NO_URLS")
    ):
        n += 1
        emit(
            "kie_video_retry_attempt",
            job_id=trace.get("job_id"),
            scene_id=trace.get("scene_id"),
            step=trace.get("step"),
            retry_attempt=n,
            prior_terminal=str(r.get("terminal_status")),
        )
        r = await kie.generate_video(prompt, duration=duration, trace=trace)
    return r


async def _step_single_image_generation(
    db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep
) -> None:
    """One Kie image for Instagram feed photo; sets scene + job output_url."""
    gid = str(job.id)
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
        .limit(1)
    )
    sc = res.scalars().first()
    if not sc:
        raise RuntimeError("No scene to render for photo job")

    if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
        raise RuntimeError("KIE_API_KEY not configured")

    kie = KieService()
    payload = job.input_payload or {}
    ctype = payload.get("content_type") or payload.get("type") or "post"
    aspect = "1:1" if ctype == "post" else ("2:3" if ctype in ("reel", "story") else "1:1")
    sid = str(sc.id)
    t0 = time.perf_counter()
    sc.status = "running"
    sc.error_message = None
    await db.commit()
    emit(
        "image_generation_start",
        job_id=gid,
        step="image_generation",
        scene_id=sid,
        scene_index=sc.scene_index,
        output_medium="photo",
    )
    try:
        prompt = f"{sc.prompt} — high-quality Instagram photo, {ctype}, sharp detail, natural lighting."
        trace = {"job_id": gid, "scene_id": sid, "step": "image_generation", "scene_index": sc.scene_index}
        await _abort_if_job_or_step_cancelling(db, svc, job, step, "image_generation", scene_index=sc.scene_index)
        image_url = await kie.generate_image(prompt, aspect_ratio=aspect, trace=trace)
        if image_url == "ERROR: INSUFFICIENT_CREDITS":
            raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
        if not _kie_url_ok(image_url):
            raise RuntimeError("Image API returned no usable URL for photo output")
        sc.start_image_url = image_url
        sc.status = "completed"
        job.output_url = image_url
        step.step_metadata = {
            "output_medium": "photo",
            "scenes_completed": 1,
            "scenes_total": 1,
        }
        step.progress = 100
        sync_job_progress(job)
        emit(
            "image_generation_result",
            job_id=gid,
            step="image_generation",
            scene_id=sid,
            scene_index=sc.scene_index,
            success=True,
            output_medium="photo",
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
    except GenerationPipelineCancelled:
        raise
    except StepCancelled:
        raise
    except Exception as e:
        sc.status = "failed"
        sc.error_message = str(e)
        await svc.append_log(job, f"Photo generation failed: {e}", "error")
        emit(
            "image_generation_result",
            job_id=gid,
            step="image_generation",
            scene_id=sid,
            scene_index=sc.scene_index,
            success=False,
            output_medium="photo",
            error=str(e),
            duration_ms=int((time.perf_counter() - t0) * 1000),
            level="error",
        )
        raise
    finally:
        svc.touch(job)
        await db.commit()


async def _step_image_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    if not scenes:
        raise RuntimeError("No scenes to render")

    kie = KieService()
    payload = job.input_payload or {}
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    aspect = "2:3" if ctype in ("reel", "story") else "1:1"

    async def one_scene(sc: GenerationScene) -> None:
        sid = str(sc.id)
        t0 = time.perf_counter()
        sc.status = "running"
        sc.error_message = None
        await db.commit()
        emit(
            "image_generation_start",
            job_id=gid,
            step="image_generation",
            scene_id=sid,
            scene_index=sc.scene_index,
        )
        try:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            start_p = f"{sc.prompt} — cinematic opening keyframe, {ctype}, high detail."
            end_p = f"{sc.prompt} — closing keyframe, different composition, same vibe."
            trace = {"job_id": gid, "scene_id": sid, "step": "image_generation", "scene_index": sc.scene_index}
            await _abort_if_job_or_step_cancelling(
                db, svc, job, step, "image_generation", scene_index=sc.scene_index
            )
            t_kf0 = time.perf_counter()
            start_u = await kie.generate_image(start_p, aspect_ratio=aspect, trace=trace)
            emit(
                "step_complete",
                job_id=gid,
                step="image_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                sub_step="start_keyframe",
                duration_ms=int((time.perf_counter() - t_kf0) * 1000),
            )
            await _abort_if_job_or_step_cancelling(
                db, svc, job, step, "image_generation", scene_index=sc.scene_index
            )
            t_kf1 = time.perf_counter()
            end_u = await kie.generate_image(end_p, aspect_ratio=aspect, trace=trace)
            emit(
                "step_complete",
                job_id=gid,
                step="image_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                sub_step="end_keyframe",
                duration_ms=int((time.perf_counter() - t_kf1) * 1000),
            )
            sc.start_image_url = start_u
            sc.end_image_url = end_u
            if start_u == "ERROR: INSUFFICIENT_CREDITS" or end_u == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            start_ok = _kie_url_ok(start_u)
            end_ok = _kie_url_ok(end_u)
            if start_ok and end_ok:
                sc.status = "completed"
                emit(
                    "image_generation_result",
                    job_id=gid,
                    step="image_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    success=True,
                    duration_ms=int((time.perf_counter() - t0) * 1000),
                )
            elif start_ok or end_ok:
                sc.status = "partial"
                sc.error_message = "PARTIAL_IMAGES: only one keyframe URL returned"
                md = dict(sc.scene_metadata or {})
                md["partial_images"] = {"start_ok": start_ok, "end_ok": end_ok}
                sc.scene_metadata = md
                emit(
                    "image_generation_result",
                    job_id=gid,
                    step="image_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    success=False,
                    partial=True,
                    start_ok=start_ok,
                    end_ok=end_ok,
                    duration_ms=int((time.perf_counter() - t0) * 1000),
                    level="warning",
                )
            else:
                raise RuntimeError("Image API returned no usable URLs for either keyframe")
        except GenerationPipelineCancelled:
            raise
        except StepCancelled:
            raise
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene {sc.scene_index} images failed: {e}", "warning")
            emit(
                "image_generation_result",
                job_id=gid,
                step="image_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                success=False,
                error=str(e),
                duration_ms=int((time.perf_counter() - t0) * 1000),
                level="error",
            )
        svc.touch(job)
        await db.commit()

    for s in scenes:
        await _abort_if_job_or_step_cancelling(
            db, svc, job, step, "image_generation", scene_index=s.scene_index
        )
        await one_scene(s)

    await db.refresh(job)
    res2 = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res2.scalars().all())
    ok = sum(1 for s in scenes if s.status == "completed")
    partial_n = sum(1 for s in scenes if s.status == "partial")
    step.step_metadata = {
        "scenes_completed": ok,
        "scenes_partial": partial_n,
        "scenes_total": len(scenes),
    }
    step.progress = 100
    sync_job_progress(job)
    if ok == 0 and partial_n == 0:
        raise RuntimeError("All scenes failed image generation")
    if partial_n and settings.GENERATION_FAIL_ON_PARTIAL_IMAGES:
        raise RuntimeError(
            f"{partial_n} scene(s) have partial keyframes (only one image URL); refusing to burn video credits."
        )


async def _step_video_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "video_generation")
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "video_generation")
    n = len(scenes)
    if n == 0:
        raise RuntimeError("No scenes for video generation")
    required = max(1, math.ceil(settings.GENERATION_MIN_VIDEO_SUCCESS_RATIO * n))
    kie = KieService()
    conc = max(1, int(getattr(settings, "GENERATION_VIDEO_MAX_CONCURRENCY", 3)))
    sem = asyncio.Semaphore(conc)

    async def run_kie_for_scene(sc: GenerationScene) -> dict[str, Any]:
        async with sem:
            sid = str(sc.id)
            t0 = time.perf_counter()
            trace = {
                "job_id": gid,
                "scene_id": sid,
                "step": "video_generation",
                "scene_index": sc.scene_index,
            }
            v_prompt = (
                f"{sc.prompt} — short vertical clip, slow camera movement only, "
                "no subject movement, coherent lighting, cinematic aesthetic."
            )
            dur = 5
            row: dict[str, Any] = {
                "scene_index": sc.scene_index,
                "scene_id": sid,
                "eligible": _scene_eligible_for_video(sc),
                "duration_ms": 0.0,
                "result": None,
            }
            if not row["eligible"]:
                return row
            preview = v_prompt if len(v_prompt) <= 220 else (v_prompt[:220] + "…")
            emit(
                "video_generation_start",
                job_id=gid,
                step="video_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                prompt_preview=preview,
            )
            r = await _kie_generate_video_with_retry(kie, v_prompt, dur, trace)
            elapsed = (time.perf_counter() - t0) * 1000
            row["duration_ms"] = elapsed
            row["result"] = r
            url = r.get("url")
            if await should_cancel(uuid.UUID(gid), None):
                emit(
                    "cancel_after_kie_call",
                    job_id=gid,
                    step="video_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    had_url=bool(url and url != "ERROR: INSUFFICIENT_CREDITS"),
                )
                row["skip_db_apply_reason"] = "cancel_after_kie"
                emit(
                    "video_generation_result",
                    job_id=gid,
                    step="video_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    terminal_status=str(r.get("terminal_status")),
                    poll_attempts=r.get("polls"),
                    polls=r.get("polls"),
                    has_url=bool(url and url != "ERROR: INSUFFICIENT_CREDITS"),
                    success=bool(url and url != "ERROR: INSUFFICIENT_CREDITS"),
                    duration_ms=int(elapsed),
                )
                return row
            await db.refresh(job, attribute_names=["step_control"])
            if _step_control_dict(job).get("video_generation") in ("cancelling", "cancelled"):
                row["skip_db_apply_reason"] = "step_cancelled"
                emit(
                    "video_generation_step_cancel_skip",
                    job_id=gid,
                    step="video_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    level="warning",
                )
                return row
            emit(
                "video_generation_result",
                job_id=gid,
                step="video_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                terminal_status=str(r.get("terminal_status")),
                poll_attempts=r.get("polls"),
                polls=r.get("polls"),
                has_url=bool(url and url != "ERROR: INSUFFICIENT_CREDITS"),
                success=bool(url and url != "ERROR: INSUFFICIENT_CREDITS"),
                duration_ms=int(elapsed),
            )
            if not url or url == "ERROR: INSUFFICIENT_CREDITS":
                term = str(r.get("terminal_status"))
                emit(
                    "video_generation_failed",
                    job_id=gid,
                    step="video_generation",
                    scene_id=sid,
                    scene_index=sc.scene_index,
                    reason=term,
                    error=term,
                    terminal_status=term,
                    poll_attempts=r.get("polls"),
                    polls=r.get("polls"),
                    duration_ms=int(elapsed),
                    level="warning" if url == "ERROR: INSUFFICIENT_CREDITS" else "error",
                )
            return row

    await _abort_if_job_or_step_cancelling(db, svc, job, step, "video_generation")
    total_scenes = max(1, n)
    scene_tasks = [asyncio.create_task(run_kie_for_scene(s)) for s in scenes]
    rows_accum: list[dict[str, Any]] = []
    done_count = 0
    try:
        for finished in asyncio.as_completed(scene_tasks):
            row = await finished
            rows_accum.append(row)
            done_count += 1
            step.progress = min(99, int(100 * done_count / total_scenes))
            md = dict(step.step_metadata or {})
            md["video_scenes_completed"] = done_count
            md["video_scenes_total"] = n
            step.step_metadata = md
            sync_job_progress(job)
            svc.touch(job)
            await db.commit()
    except Exception:
        for t in scene_tasks:
            if not t.done():
                t.cancel()
        await asyncio.gather(*scene_tasks, return_exceptions=True)
        raise

    rows_by_sid = {str(r["scene_id"]): r for r in rows_accum}
    rows = [rows_by_sid[str(s.id)] for s in scenes]

    await _abort_if_step_cancelling(db, svc, job, "video_generation")

    timeout_count = 0
    polls_sum = 0
    polls_counted = 0

    for sc, row in zip(scenes, rows):
        sid = str(sc.id)
        await db.refresh(job, attribute_names=["status"])
        if job.status == "cancelled":
            raise GenerationPipelineCancelled()
        if job.status == "cancelling":
            await _finalize_job_cancelled(db, svc, job, step, "video_generation")
            raise GenerationPipelineCancelled()
        if not row["eligible"]:
            emit(
                "video_skipped",
                job_id=gid,
                step="video_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                outcome="skipped",
                reason="scene_not_eligible_for_video",
                scene_status=sc.status,
                level="warning",
            )
            sc.status = "failed"
            prev = (sc.error_message or "").strip()
            suffix = "VIDEO_SKIPPED: scene_not_image_completed"
            sc.error_message = f"{prev}; {suffix}" if prev else suffix
            if len(sc.error_message) > 2000:
                sc.error_message = sc.error_message[-2000:]
            svc.touch(job)
            await db.commit()
            continue

        if row.get("skip_db_apply_reason") == "step_cancelled":
            continue

        r = row["result"]
        assert r is not None
        url = r.get("url")
        terminal = str(r.get("terminal_status") or "")
        polls = int(r.get("polls") or 0)
        if row.get("skip_db_apply_reason") == "cancel_after_kie":
            if url and url != "ERROR: INSUFFICIENT_CREDITS":
                sc.video_url = url
                if sc.status == "partial":
                    sc.status = "completed"
                svc.touch(job)
                await db.commit()
            await _finalize_job_cancelled(db, svc, job, step, "video_generation")
            raise GenerationPipelineCancelled()
        if terminal == "TIMEOUT":
            timeout_count += 1
        dur_ms = float(row["duration_ms"] or 0.0)

        try:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                retryable = bool(r.get("retryable"))
                md = dict(sc.scene_metadata or {})
                if retryable:
                    md["video_retryable"] = True
                sc.scene_metadata = md
                raise RuntimeError(f"Kie video failed: {terminal} (polls={polls})")
            sc.video_url = url
            if sc.status == "partial":
                sc.status = "completed"
            polls_sum += polls
            polls_counted += 1
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene {sc.scene_index} video failed: {e}", "warning")
            emit(
                "scene_video_failed",
                job_id=gid,
                step="video_generation",
                scene_id=sid,
                scene_index=sc.scene_index,
                outcome="failure",
                reason=str(e),
                duration_ms=round(dur_ms, 2),
                terminal_status=terminal,
                level="error",
            )
        svc.touch(job)
        await db.commit()

    await db.refresh(job)
    res2 = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res2.scalars().all())
    v_ok = sum(1 for s in scenes if s.video_url)
    v_failed = sum(1 for s in scenes if s.status == "failed" and not s.video_url)
    avg_poll = round(polls_sum / polls_counted, 2) if polls_counted else 0.0
    step.step_metadata = {
        "videos_ready": v_ok,
        "scenes_total": len(scenes),
        "required_videos": required,
        "min_video_success_ratio": settings.GENERATION_MIN_VIDEO_SUCCESS_RATIO,
        "timeout_count": timeout_count,
        "avg_poll_attempts_success": avg_poll,
    }
    step.progress = 100
    sync_job_progress(job)
    emit(
        "video_step_summary",
        job_id=gid,
        step="video_generation",
        videos_success=v_ok,
        videos_failed=v_failed,
        timeout_count=timeout_count,
        avg_poll_attempts=avg_poll,
        scenes_total=len(scenes),
    )
    if v_ok == 0:
        raise RuntimeError("No scene videos produced")
    if v_ok < required:
        emit(
            "video_ratio_not_met_but_continuing",
            job_id=gid,
            step="video_generation",
            outcome="warning",
            videos_ok=v_ok,
            required_videos=required,
            scenes_total=len(scenes),
            min_ratio=settings.GENERATION_MIN_VIDEO_SUCCESS_RATIO,
            level="warning",
        )
        if not settings.GENERATION_DEMO_MODE or settings.DYNAMIC_MODE_STRICT:
            raise RuntimeError(
                f"video_generation: need at least {required} scene video(s), got {v_ok} "
                f"(GENERATION_MIN_VIDEO_SUCCESS_RATIO={settings.GENERATION_MIN_VIDEO_SUCCESS_RATIO})"
            )
    if (
        settings.GENERATION_DEMO_MODE
        and settings.GENERATION_DEMO_PIN_OUTPUT_URL_AFTER_VIDEO
        and v_ok >= 1
    ):
        for s in sorted(scenes, key=lambda x: x.scene_index):
            if s.video_url:
                job.output_url = s.video_url
                break
        emit(
            "demo_output_url_pinned_after_video",
            job_id=gid,
            step="video_generation",
            videos_ok=v_ok,
            has_output_url=bool(job.output_url),
        )


def _provider_poll_progress_hook(
    db: AsyncSession,
    svc: GenerationJobService,
    job: GenerationJob,
    step: GenerationStep,
) -> Any:
    async def on_poll(poll_index: int, max_polls: int) -> None:
        step.progress = provider_poll_step_progress(poll_index, max_polls)
        md = dict(step.step_metadata or {})
        md["provider_poll_attempt"] = poll_index
        md["provider_poll_max"] = max_polls
        md["progress_source"] = "provider_poll"
        md["phase"] = "provider_generating"
        step.step_metadata = md
        sync_job_progress(job)
        svc.touch(job)
        await db.commit()

    return on_poll


async def _step_multi_scene_single_video(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    if not scenes:
        raise RuntimeError("No scenes available for multi-scene video generation")

    total_duration = sum(int(sc.duration or 4) for sc in scenes)
    payload = job.input_payload or {}
    requested_video_duration = payload.get("video_duration")
    try:
        selected_duration = int(requested_video_duration) if requested_video_duration is not None else int(total_duration)
    except Exception:
        selected_duration = int(total_duration)
    # Seedance accepts only 4..15 seconds.
    selected_duration = max(4, min(15, selected_duration))
    prompt = build_multi_scene_prompt(scenes, total_duration=selected_duration)
    emit(
        "seedance_prompt_built",
        job_id=gid,
        step="video_generation",
        execution_mode="multi_scene_single_video",
        prompt_preview=(prompt[:500] + "…") if len(prompt) > 500 else prompt,
        scene_count=len(scenes),
        number_of_scenes=len(scenes),
        total_duration=total_duration,
        selected_duration=selected_duration,
    )
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    aspect = "9:16" if ctype in ("reel", "story") else "1:1"
    seedance = SeedanceService()
    t0 = time.perf_counter()
    max_attempts = 3
    step.progress = 8
    md0 = dict(step.step_metadata or {})
    md0.update(
        {
            "execution_mode": "multi_scene_single_video",
            "phase": "seedance_prepare",
            "scene_count": len(scenes),
            "selected_duration": selected_duration,
        }
    )
    step.step_metadata = md0
    sync_job_progress(job)
    svc.touch(job)
    await db.commit()
    poll_hook = _provider_poll_progress_hook(db, svc, job, step)
    result: dict[str, Any] = {"video_url": None, "status": "failed", "error": "not_attempted"}
    for attempt in range(max_attempts):
        md = dict(step.step_metadata or {})
        md["seedance_attempt"] = attempt + 1
        md["phase"] = "seedance_generating"
        step.step_metadata = md
        svc.touch(job)
        await db.commit()
        emit(
            "seedance_attempt",
            job_id=gid,
            step="video_generation",
            execution_mode="multi_scene_single_video",
            attempt=attempt + 1,
            max_attempts=max_attempts,
            total_duration=total_duration,
            number_of_scenes=len(scenes),
            selected_duration=selected_duration,
        )
        result = await seedance.generate_video(
            prompt=prompt,
            duration=selected_duration,
            aspect_ratio=aspect,
            trace={"job_id": gid, "step": "video_generation"},
            on_poll=poll_hook,
        )
        if result.get("status") == "success" and result.get("video_url"):
            break
        if attempt < max_attempts - 1:
            # Do not call createTask again after a local poll TIMEOUT: the first Kie job often keeps
            # running and a retry spawns a second billed task (duplicate "running" rows on kie.ai/logs).
            if _seedance_result_is_local_poll_timeout(result):
                emit(
                    "seedance_retry_skipped_after_poll_timeout",
                    job_id=gid,
                    step="video_generation",
                    execution_mode="multi_scene_single_video",
                    attempt=attempt + 1,
                    max_attempts=max_attempts,
                    error=result.get("error"),
                    total_duration=total_duration,
                    number_of_scenes=len(scenes),
                    selected_duration=selected_duration,
                    level="warning",
                    note="Kie task may still complete on their side; use pipeline retry or check Kie logs before re-running.",
                )
                break
            emit(
                "seedance_retry_scheduled",
                job_id=gid,
                step="video_generation",
                execution_mode="multi_scene_single_video",
                attempt=attempt + 1,
                next_attempt=attempt + 2,
                error=result.get("error"),
                total_duration=total_duration,
                number_of_scenes=len(scenes),
                selected_duration=selected_duration,
                level="warning",
            )
    elapsed = int((time.perf_counter() - t0) * 1000)
    emit(
        "multi_scene_video_result",
        job_id=gid,
        step="video_generation",
        execution_mode="multi_scene_single_video",
        status=result.get("status"),
        has_url=bool(result.get("video_url")),
        error=result.get("error"),
        attempts=max_attempts if not (result.get("status") == "success" and result.get("video_url")) else attempt + 1,
        total_duration=total_duration,
        number_of_scenes=len(scenes),
        selected_duration=selected_duration,
        duration_ms=elapsed,
    )
    if result.get("status") != "success" or not result.get("video_url"):
        msg = str(result.get("error") or "Seedance generation failed")
        await svc.append_log(job, f"Multi-scene video failed: {msg}", "error")
        svc.touch(job)
        await db.commit()
        raise RuntimeError(f"Seedance video generation failed: {msg}")

    job.output_url = str(result["video_url"])
    for sc in scenes:
        md = dict(sc.scene_metadata or {})
        md["generated_via"] = "multi_scene"
        sc.scene_metadata = md
    step.step_metadata = {
        "execution_mode": "multi_scene_single_video",
        "provider": "seedance",
        "scene_count": len(scenes),
        "total_duration": total_duration,
        "selected_duration": selected_duration,
        "attempts": attempt + 1,
        "duration_ms": elapsed,
        "aspect_ratio": aspect,
    }
    step.progress = 100
    sync_job_progress(job)
    svc.touch(job)
    await db.commit()


async def _step_ailiveai_single_video(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    if not scenes:
        raise RuntimeError("No scenes available for AILIVEAI single-video generation")

    total_duration = sum(int(sc.duration or 4) for sc in scenes)
    payload = job.input_payload or {}
    requested_video_duration = payload.get("video_duration")
    try:
        selected_duration = int(requested_video_duration) if requested_video_duration is not None else int(total_duration)
    except Exception:
        selected_duration = int(total_duration)
    # AliveAI video length: only SHORT (~5s) or MEDIUM (~10s).
    selected_duration = 10 if int(selected_duration) > 5 else 5
    prompt = build_multi_scene_prompt(scenes, total_duration=selected_duration)
    emit(
        "ailiveai_prompt_built",
        job_id=gid,
        step="video_generation",
        execution_mode="ailiveai_single_video",
        prompt_preview=(prompt[:500] + "…") if len(prompt) > 500 else prompt,
        scene_count=len(scenes),
        number_of_scenes=len(scenes),
        total_duration=total_duration,
        selected_duration=selected_duration,
    )
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    aspect = "9:16" if ctype in ("reel", "story") else "1:1"
    media_id_opt = str(
        payload.get("ailiveai_media_id")
        or payload.get("media_id")
        or payload.get("aliveai_media_id")
        or (getattr(settings, "AILIVEAI_MEDIA_ID", None) or "")
    ).strip() or None
    aliveai_aspect = "PORTRAIT" if ctype in ("reel", "story") else "LANDSCAPE"
    persona_blob = payload.get("ailiveai_persona")
    persona_dict = persona_blob if isinstance(persona_blob, dict) else None
    image_name = str(payload.get("topic") or payload.get("niche") or "Character").strip()[:200]
    if persona_dict and str(persona_dict.get("full_name") or "").strip():
        image_name = str(persona_dict["full_name"]).strip()[:200]
    explicit_appearance = str(payload.get("ailiveai_image_appearance") or "").strip()
    image_app = explicit_appearance or prompt
    if not explicit_appearance:
        emit(
            "ailiveai_appearance_missing_using_scene_prompt",
            job_id=gid,
            step="video_generation",
            execution_mode="ailiveai_single_video",
            level="warning",
            note="Blocking /prompts appearance falls back to combined scene text; portrait may look like the scene (e.g. room) not a persona.",
        )
    scene_extra = str(payload.get("ailiveai_scene") or "").strip() or None
    if not scene_extra and scenes:
        scene_extra = (scenes[0].prompt or "")[:600] or None
    raw_seed = str(payload.get("ailiveai_seed") or "").strip() or None
    raw_ci = payload.get("ailiveai_custom_image")
    custom_image_opt = raw_ci if isinstance(raw_ci, bool) else None
    video_frame_rate_opt = str(payload.get("ailiveai_video_frame_rate") or "").strip() or None
    motion_raw = payload.get("ailiveai_motion_strength")
    motion_strength_opt: Optional[int] = None
    if motion_raw is not None and str(motion_raw).strip() != "":
        try:
            motion_strength_opt = int(motion_raw)
        except (TypeError, ValueError):
            motion_strength_opt = None
    ailiveai = AiliveaiService()
    t0 = time.perf_counter()
    max_attempts = 3
    step.progress = 8
    md0 = dict(step.step_metadata or {})
    md0.update(
        {
            "execution_mode": "ailiveai_single_video",
            "phase": "ailiveai_prepare",
            "scene_count": len(scenes),
            "selected_duration": selected_duration,
        }
    )
    step.step_metadata = md0
    sync_job_progress(job)
    svc.touch(job)
    await db.commit()
    poll_hook = _provider_poll_progress_hook(db, svc, job, step)
    result: dict[str, Any] = {"video_url": None, "status": "failed", "error": "not_attempted"}
    for attempt in range(max_attempts):
        md = dict(step.step_metadata or {})
        md["ailiveai_attempt"] = attempt + 1
        md["phase"] = "ailiveai_generating"
        step.step_metadata = md
        svc.touch(job)
        await db.commit()
        emit(
            "ailiveai_attempt",
            job_id=gid,
            step="video_generation",
            execution_mode="ailiveai_single_video",
            attempt=attempt + 1,
            max_attempts=max_attempts,
            total_duration=total_duration,
            number_of_scenes=len(scenes),
            selected_duration=selected_duration,
        )
        result = await ailiveai.generate_video(
            prompt=prompt,
            aspect_ratio=aspect,
            duration=selected_duration,
            media_id=media_id_opt,
            image_name=image_name,
            image_appearance=image_app,
            image_detail_level=str(payload.get("ailiveai_detail_level") or "MEDIUM").strip() or None,
            image_gender=str(payload.get("ailiveai_gender") or "FEMALE").strip() or None,
            aliveai_aspect=aliveai_aspect,
            video_model=str(payload.get("ailiveai_video_model") or "").strip() or None,
            scene=scene_extra,
            server_id=str(payload.get("ailiveai_server_id") or "").strip() or None,
            last_frame_media_id=str(payload.get("ailiveai_last_frame_media_id") or "").strip() or None,
            video_quality=str(payload.get("ailiveai_video_quality") or "").strip() or None,
            blocking_persona=persona_dict,
            seed=raw_seed,
            custom_image=custom_image_opt,
            video_frame_rate=video_frame_rate_opt,
            motion_strength=motion_strength_opt,
            trace={"job_id": gid, "step": "video_generation"},
            on_poll=poll_hook,
        )
        if result.get("status") == "completed" and result.get("video_url"):
            break
        if attempt < max_attempts - 1:
            if _seedance_result_is_local_poll_timeout(result):
                emit(
                    "ailiveai_retry_skipped_after_poll_timeout",
                    job_id=gid,
                    step="video_generation",
                    execution_mode="ailiveai_single_video",
                    attempt=attempt + 1,
                    max_attempts=max_attempts,
                    error=result.get("error"),
                    total_duration=total_duration,
                    number_of_scenes=len(scenes),
                    selected_duration=selected_duration,
                    level="warning",
                    note="Provider task may still complete on their side; use pipeline retry or check provider logs before re-running.",
                )
                break
            emit(
                "ailiveai_retry_scheduled",
                job_id=gid,
                step="video_generation",
                execution_mode="ailiveai_single_video",
                attempt=attempt + 1,
                next_attempt=attempt + 2,
                error=result.get("error"),
                total_duration=total_duration,
                number_of_scenes=len(scenes),
                selected_duration=selected_duration,
                level="warning",
            )
    elapsed = int((time.perf_counter() - t0) * 1000)
    emit(
        "ailiveai_single_video_result",
        job_id=gid,
        step="video_generation",
        execution_mode="ailiveai_single_video",
        status=result.get("status"),
        has_url=bool(result.get("video_url")),
        error=result.get("error"),
        attempts=max_attempts if not (result.get("status") == "completed" and result.get("video_url")) else attempt + 1,
        total_duration=total_duration,
        number_of_scenes=len(scenes),
        selected_duration=selected_duration,
        duration_ms=elapsed,
    )
    if result.get("status") != "completed" or not result.get("video_url"):
        msg = str(result.get("error") or "AILIVEAI generation failed")
        await svc.append_log(job, f"AILIVEAI single video failed: {msg}", "error")
        svc.touch(job)
        await db.commit()
        raise RuntimeError(f"AILIVEAI generation failed: {msg}")

    job.output_url = str(result["video_url"])
    src_mid = result.get("source_media_id")
    src_img = result.get("source_image_url")
    for sc in scenes:
        md = dict(sc.scene_metadata or {})
        md["generated_via"] = "ailiveai_single"
        md["preview_video_url"] = str(result["video_url"])
        md["preview_video_source"] = "ailiveai_pipeline"
        if src_img and str(src_img).strip():
            md["preview_image_url"] = str(src_img).strip()
            md["preview_image_source"] = "ailiveai_pipeline"
        if src_mid and str(src_mid).strip():
            md["ailiveai_source_media_id"] = str(src_mid).strip()
        sc.scene_metadata = md
    if scenes:
        scenes[0].video_url = str(result["video_url"])
    step.step_metadata = {
        "execution_mode": "ailiveai_single_video",
        "provider": "ailiveai",
        "scene_count": len(scenes),
        "total_duration": total_duration,
        "selected_duration": selected_duration,
        "attempts": attempt + 1,
        "duration_ms": elapsed,
        "aspect_ratio": aspect,
    }
    step.progress = 100
    sync_job_progress(job)
    svc.touch(job)
    await db.commit()


async def _step_assembly(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "assembly")
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    for sc in scenes:
        if sc.status == "completed" and sc.start_image_url and sc.end_image_url and not sc.video_url:
            sc.status = "failed"
            sc.error_message = (sc.error_message or "missing_video_after_images").strip()
            emit(
                "scene_integrity_failed",
                job_id=gid,
                step="assembly",
                scene_id=str(sc.id),
                scene_index=sc.scene_index,
                reason="completed_images_but_no_video_url",
                level="warning",
            )
    await db.flush()
    svc.touch(job)

    urls = [s.video_url for s in scenes if s.video_url]

    emit(
        "assembly_start",
        job_id=gid,
        step="assembly",
        clips_count=len(urls),
        scenes_total=len(scenes),
        outcome="start",
    )

    if not urls:
        emit(
            "assembly_result",
            job_id=gid,
            step="assembly",
            clips_count=0,
            concat_success=False,
            outcome="failure",
            reason="no_scene_videos",
            level="error",
        )
        raise RuntimeError("No scene videos to assemble")

    await _abort_if_job_or_step_cancelling(db, svc, job, step, "assembly")

    if len(urls) == 1:
        job.output_url = urls[0]
        meta = {
            "clips": 1,
            "assembly_mode": "SINGLE_CLIP",
            "concat_success": False,
            "ffmpeg": "skipped_single_clip",
        }
        step.step_metadata = meta
        step.progress = 100
        sync_job_progress(job)
        emit(
            "assembly_result",
            job_id=gid,
            step="assembly",
            clips_count=1,
            concat_success=False,
            assembly_mode="SINGLE_CLIP",
            public_output_url=job.output_url,
            outcome="success",
        )
        return

    await _abort_if_job_or_step_cancelling(db, svc, job, step, "assembly")
    concat_path, meta = await asyncio.to_thread(_ffmpeg_concat_sync, urls)
    meta = dict(meta)
    meta["clips"] = len(urls)
    step.step_metadata = meta
    concat_ok = bool(concat_path)
    if not concat_ok:
        if settings.GENERATION_ASSEMBLY_FALLBACK_ON_CONCAT_FAIL and urls:
            job.output_url = urls[0]
            meta["assembly_mode"] = "MULTI_CLIP_FALLBACK"
            meta["concat_success"] = False
            step.step_metadata = meta
            step.progress = 100
            sync_job_progress(job)
            emit(
                "assembly_fallback_to_single_clip",
                job_id=gid,
                step="assembly",
                outcome="warning",
                reason="concat_failed",
                clips_count=len(urls),
                ffmpeg=meta.get("ffmpeg"),
                level="warning",
            )
            emit(
                "assembly_result",
                job_id=gid,
                step="assembly",
                clips_count=len(urls),
                concat_success=False,
                assembly_mode="MULTI_CLIP_FALLBACK",
                public_output_url=job.output_url,
                ffmpeg=meta.get("ffmpeg"),
                outcome="success",
            )
            return
        job.output_url = None
        emit(
            "assembly_result",
            job_id=gid,
            step="assembly",
            clips_count=len(urls),
            concat_success=False,
            assembly_mode="MULTI_CLIP_FALLBACK",
            ffmpeg=meta.get("ffmpeg"),
            outcome="failure",
            level="error",
        )
        raise RuntimeError(f"Assembly failed: ffmpeg concat unsuccessful ({meta.get('ffmpeg')})")

    meta["assembly_mode"] = "MULTI_CLIP_MERGED"
    meta["assembled_local_path"] = meta.get("local_path")
    meta["concat_success"] = True
    meta["public_merged_http_url"] = None
    meta["merged_video_is_local_file_only"] = True
    if settings.GENERATION_PROMOTE_FIRST_CLIP_WHEN_MERGED_LOCAL_ONLY:
        meta["distribution_uses_first_http_scene_clip_not_public_merged_file"] = True
        job.output_url = urls[0]
    else:
        job.output_url = None
    step.step_metadata = meta
    step.progress = 100
    job.progress = 85
    emit(
        "assembly_result",
        job_id=gid,
        step="assembly",
        clips_count=len(urls),
        concat_success=True,
        assembly_mode="MULTI_CLIP_MERGED",
        assembled_local_path=meta.get("assembled_local_path"),
        public_output_url=job.output_url,
        merged_local_only=True,
        promoted_first_clip_for_http=bool(job.output_url),
        outcome="success",
    )


async def generate_scene_preview(
    db,
    job_id: uuid.UUID,
    scene_id: uuid.UUID,
    kind: str,
) -> GenerationScene:
    """Persist preview URLs on scene metadata. Provider depends on job execution_mode (AliveAI vs Kie)."""
    svc = GenerationJobService(db)
    job = await svc.get_job(job_id, with_children=False)
    if not job:
        raise ValueError("Job not found")
    sc = await svc.get_scene(job_id, scene_id)
    if not sc:
        raise ValueError("Scene not found")

    payload = job.input_payload or {}
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    aspect = "2:3" if ctype in ("reel", "story") else "1:1"
    meta = dict(sc.scene_metadata or {})
    preview_trace = {"job_id": str(job_id), "scene_id": str(scene_id), "step": "preview"}
    exec_mode = str(getattr(job, "execution_mode", "") or "").strip()

    if exec_mode == "ailiveai_single_video":
        if meta.get("preview_video_source") == "kie_quick_preview":
            meta.pop("preview_video_url", None)
            meta.pop("preview_video_source", None)
        if meta.get("preview_image_source") == "kie_quick_preview":
            meta.pop("preview_image_url", None)
            meta.pop("preview_image_source", None)

        ailive = AiliveaiService()

        if kind == "video":
            if sc.video_url and str(sc.video_url).strip():
                meta["preview_video_url"] = str(sc.video_url).strip()
                meta["preview_video_source"] = "scene_pipeline"
            elif job.output_url and str(job.output_url).strip():
                meta["preview_video_url"] = str(job.output_url).strip()
                meta["preview_video_source"] = "ailiveai_pipeline"
            elif (
                isinstance(meta.get("preview_video_url"), str)
                and meta["preview_video_url"].strip()
                and meta.get("preview_video_source") == "ailiveai_pipeline"
            ):
                pass
            else:
                raise RuntimeError(
                    "AliveAI single-video preview: no clip yet. Run the job until video_generation succeeds "
                    "(final URL is stored on the job), then open Vid preview again."
                )
            meta["preview_kind"] = "video"
        else:
            pis = meta.get("preview_image_source")
            piu = meta.get("preview_image_url")
            if isinstance(piu, str) and piu.strip() and pis == "ailiveai_pipeline":
                meta["preview_kind"] = "image"
            elif sc.start_image_url and str(sc.start_image_url).strip():
                meta["preview_image_url"] = str(sc.start_image_url).strip()
                meta["preview_image_source"] = "scene_pipeline"
                meta["preview_kind"] = "image"
            elif isinstance(piu, str) and piu.strip() and pis == "ailiveai_blocking_preview":
                meta["preview_kind"] = "image"
            else:
                aliveai_aspect = "PORTRAIT" if ctype in ("reel", "story") else "LANDSCAPE"
                persona_dict = payload.get("ailiveai_persona") if isinstance(payload.get("ailiveai_persona"), dict) else None
                image_name = str(payload.get("topic") or payload.get("niche") or "Character").strip()[:200]
                if persona_dict and str(persona_dict.get("full_name") or "").strip():
                    image_name = str(persona_dict["full_name"]).strip()[:200]
                explicit_appearance = str(payload.get("ailiveai_image_appearance") or "").strip()
                image_app = explicit_appearance or (str(sc.prompt or "").strip() or "")
                if not str(image_app).strip():
                    raise RuntimeError(
                        "AliveAI image preview needs ailiveai_image_appearance or scene prompt text on the job."
                    )
                opt = _blocking_optionals_from_persona(persona_dict)
                bec = None
                if isinstance(persona_dict, dict):
                    raw_bec = persona_dict.get("block_explicit_content")
                    if isinstance(raw_bec, bool):
                        bec = raw_bec
                img = await ailive.create_blocking_source_image(
                    str(image_app).strip()[:1500],
                    name=image_name,
                    detail_level=str(payload.get("ailiveai_detail_level") or "MEDIUM").strip() or "MEDIUM",
                    gender=str(payload.get("ailiveai_gender") or "FEMALE").strip() or "FEMALE",
                    aspect_ratio_aliveai=aliveai_aspect,
                    server_id=str(payload.get("ailiveai_server_id") or "").strip() or None,
                    face_details=opt.get("face_details"),
                    background=opt.get("background"),
                    from_location=opt.get("from_location"),
                    image_scene=opt.get("image_scene"),
                    negative_details=opt.get("negative_details"),
                    block_explicit_content=bec,
                    seed=str(payload.get("ailiveai_seed") or "").strip() or None,
                    trace=preview_trace,
                )
                if img.get("status") != "completed" or not img.get("media_id"):
                    raise RuntimeError(str(img.get("error") or "AliveAI blocking portrait preview failed"))
                url = img.get("image_url")
                if not (isinstance(url, str) and url.strip()):
                    raise RuntimeError(
                        "AliveAI returned a portrait media id but no image URL in the API response yet; retry shortly."
                    )
                meta["preview_image_url"] = url.strip()
                meta["preview_image_source"] = "ailiveai_blocking_preview"
                meta["preview_kind"] = "image"

        meta["preview_generated_at"] = _now().isoformat()
        sc.scene_metadata = meta
        svc.touch(job)
        await db.flush()
        await db.refresh(sc)
        return sc

    kie = KieService()
    meta = dict(sc.scene_metadata or {})
    preview_trace = {"job_id": str(job_id), "scene_id": str(scene_id), "step": "preview"}

    if kind == "video":
        # ✅ Return already-stored video URL first — zero credit cost
        if sc.video_url:
            meta["preview_video_url"] = sc.video_url
            meta["preview_kind"] = "video"
            meta["preview_video_source"] = "scene_pipeline"
        else:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            prompt = f"{sc.prompt} — quick motion preview, vertical."
            vres = await kie.generate_video(prompt, duration=5, trace=preview_trace)
            url = vres.get("url")
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                raise RuntimeError(
                    f"Video preview failed: {vres.get('terminal_status')} (polls={vres.get('polls')})"
                )
            meta["preview_video_url"] = url
            meta["preview_kind"] = "video"
            # Kie sidecar preview — not AliveAI /prompts/image-to-video output (see video_generation step).
            meta["preview_video_source"] = "kie_quick_preview"
    else:
        # ✅ Return already-stored image URL first — zero credit cost
        existing_image = sc.start_image_url or sc.end_image_url
        if existing_image:
            meta["preview_image_url"] = existing_image
            meta["preview_kind"] = "image"
            meta["preview_image_source"] = "scene_pipeline"
        else:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            exec_mode = str(getattr(job, "execution_mode", "") or "").strip()
            persona_app = str(payload.get("ailiveai_image_appearance") or "").strip()
            if exec_mode == "ailiveai_single_video" and persona_app:
                scene_brief = (sc.prompt or "").strip()
                prompt = (
                    f"{persona_app[:1200]} — Cinematic single frame for {ctype}, high quality. "
                    f"The person is the clear subject; environment may reflect this scene mood (do not replace the person): "
                    f"{scene_brief[:500]}"
                )
            else:
                prompt = f"{sc.prompt} — single frame preview, {ctype}, high quality."
            url = await kie.generate_image(prompt, aspect_ratio=aspect, trace=preview_trace)
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                raise RuntimeError("Image preview failed")
            meta["preview_image_url"] = url
            meta["preview_kind"] = "image"
            meta["preview_image_source"] = "kie_quick_preview"

    meta["preview_generated_at"] = _now().isoformat()
    sc.scene_metadata = meta
    svc.touch(job)
    await db.flush()
    await db.refresh(sc)
    return sc


async def _step_distribution(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    gid = str(job.id)
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "distribution")
    dist_mode = (settings.GENERATION_DISTRIBUTION_MODE or "publish_intents").strip().lower()
    if dist_mode in ("publish_intents", "skip", "none"):
        step.step_metadata = {
            "skipped_legacy_queue": True,
            "distribution_mode": dist_mode,
            "note": "Use Generation Studio publish-intents; see docs/runbooks/publish-instagram.md",
        }
        step.progress = 100
        sync_job_progress(job)
        emit(
            "distribution_skipped_legacy_queue",
            job_id=gid,
            step="distribution",
            outcome="success",
            distribution_mode=dist_mode,
        )
        return
    payload = job.input_payload or {}
    caption = payload.get("caption") or ""
    hashtags = payload.get("hashtags") or []
    target_accounts = payload.get("target_accounts") or []
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    scheduled_at = payload.get("scheduled_at")

    visual_type = "video" if ctype in ("reel", "story") else "image"
    assembly_meta: dict[str, Any] = {}
    for st in job.steps or []:
        if st.step_name == "assembly":
            assembly_meta = dict(st.step_metadata or {})
            break

    if visual_type == "video" and not job.output_url:
        emit(
            "distribution_blocked",
            job_id=gid,
            step="distribution",
            outcome="failure",
            reason="no_public_video_url",
            assembly_mode=assembly_meta.get("assembly_mode"),
            assembled_local_path=assembly_meta.get("assembled_local_path"),
            level="error",
        )
        raise RuntimeError(
            "distribution: job.output_url is empty. Multi-clip assembly produced a local merged file only "
            "(see assembly step_metadata); upload or use single-clip output before enqueue."
        )

    export = {
        "id": str(job.id),
        "type": ctype,
        "caption": caption,
        "visual_url": job.output_url,
        "visual_type": visual_type,
        "hashtags": hashtags,
        "target_accounts": target_accounts,
        "scheduled_at": scheduled_at or _now().isoformat(),
        "niche": payload.get("niche") or "",
        "status": "queued",
        "metadata": {
            "generation_job_id": str(job.id),
            "source": "generation_studio",
        },
        "created_at": _now().isoformat(),
    }
    qn = settings.CONTENT_QUEUE_NAME
    summary = {
        "job_id": gid,
        "visual_type": visual_type,
        "has_visual_url": bool(job.output_url),
        "caption_len": len(caption or ""),
        "hashtag_count": len(hashtags or []),
        "target_account_count": len(target_accounts or []),
        "assembly_mode": assembly_meta.get("assembly_mode"),
        "merged_local_only": assembly_meta.get("merged_video_is_local_file_only"),
        "distribution_uses_first_http_scene_clip_not_public_merged_file": assembly_meta.get(
            "distribution_uses_first_http_scene_clip_not_public_merged_file"
        ),
    }
    emit(
        "distribution_enqueue",
        job_id=gid,
        step="distribution",
        outcome="start",
        queue_name=qn,
        transport="redis_lpush",
        payload_summary=summary,
    )
    await _abort_if_job_or_step_cancelling(db, svc, job, step, "distribution")
    await push_to_queue(qn, json.dumps(export))
    step.step_metadata = {"queue": qn, "enqueue": summary}
    step.progress = 100
    sync_job_progress(job)
    emit(
        "distribution_enqueued",
        job_id=gid,
        step="distribution",
        outcome="success",
        queue_name=qn,
    )


async def run_retry_scene(job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
    if not await try_begin_exclusive_job_pipeline(job_id):
        emit(
            "scene_retry_aborted",
            job_id=str(job_id),
            scene_id=str(scene_id),
            step="scene_retry",
            reason="duplicate_pipeline_run",
            level="warning",
        )
        return
    try:
        await _run_retry_scene_inner(job_id, scene_id)
    finally:
        await end_exclusive_job_pipeline(job_id)


async def _run_retry_scene_inner(job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        if not job:
            emit(
                "scene_retry_aborted",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                reason="job_not_found",
                level="warning",
            )
            return
        sc = await svc.get_scene(job_id, scene_id)
        if not sc:
            emit(
                "scene_retry_aborted",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                reason="scene_not_found",
                level="warning",
            )
            return
        sc.status = "pending"
        sc.start_image_url = None
        sc.end_image_url = None
        sc.video_url = None
        sc.error_message = None
        job.status = "running"
        await svc.append_log(job, f"Retry scene {sc.scene_index}")
        await db.commit()

    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        steps = {s.step_name: s for s in job.steps} if job else {}
        if not job:
            emit(
                "scene_retry_aborted",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                reason="job_not_found_second_session",
                level="warning",
            )
            return
        # re-run media for this scene only
        step_img = steps.get("image_generation")
        step_vid = steps.get("video_generation")
        if step_img:
            step_img.status = "running"
        if step_vid:
            step_vid.status = "pending"
        await db.commit()

    # Run image + video for single scene in a fresh session cycle
    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        sc = await svc.get_scene(job_id, scene_id)
        if not job or not sc:
            emit(
                "scene_retry_aborted",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                reason="job_or_scene_missing_media_session",
                level="warning",
            )
            return
        kie = KieService()
        payload = job.input_payload or {}
        ctype = payload.get("content_type") or payload.get("type") or "reel"
        aspect = "2:3" if ctype in ("reel", "story") else "1:1"
        rtrace = {
            "job_id": str(job_id),
            "scene_id": str(scene_id),
            "step": "scene_retry",
            "scene_index": sc.scene_index,
        }
        emit(
            "scene_retry_media_start",
            job_id=str(job_id),
            scene_id=str(scene_id),
            step="scene_retry",
            scene_index=sc.scene_index,
            outcome="start",
        )
        try:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            sc.start_image_url = await kie.generate_image(
                f"{sc.prompt} — opening keyframe.", aspect_ratio=aspect, trace=rtrace
            )
            sc.end_image_url = await kie.generate_image(
                f"{sc.prompt} — closing keyframe.", aspect_ratio=aspect, trace=rtrace
            )
            sc.status = "completed"
            dur = 5
            vres = await _kie_generate_video_with_retry(
                kie, f"{sc.prompt} — motion.", dur, rtrace
            )
            vu = vres.get("url")
            if vu == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not vu:
                raise RuntimeError(
                    f"Kie video failed: {vres.get('terminal_status')} (polls={vres.get('polls')})"
                )
            sc.video_url = vu
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene retry failed: {e}", "error")
            emit(
                "scene_retry_media_failed",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                outcome="failure",
                reason=str(e),
                level="error",
            )
        else:
            emit(
                "scene_retry_media_done",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                outcome="success",
                scene_index=sc.scene_index,
            )
        await db.commit()

    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        if not job:
            emit(
                "scene_retry_finalize_aborted",
                job_id=str(job_id),
                scene_id=str(scene_id),
                step="scene_retry",
                reason="job_not_found_finalize",
                level="warning",
            )
            return
        steps = {s.step_name: s for s in job.steps}
        if steps.get("image_generation"):
            steps["image_generation"].status = "completed"
            steps["image_generation"].progress = 100
        if steps.get("video_generation"):
            steps["video_generation"].status = "completed"
            steps["video_generation"].progress = 100
        asm = steps.get("assembly")
        dist = steps.get("distribution")
        try:
            if asm:
                await _step_assembly(db, svc, job, asm)
                asm.status = "completed"
                asm.progress = 100
            if dist:
                await _step_distribution(db, svc, job, dist)
                dist.status = "completed"
                dist.progress = 100
            job.status = "completed"
            job.progress = 100
        except Exception as e:
            await svc.append_log(job, f"Scene retry finalize failed: {e}", "error")
            job.status = "failed"
        await db.commit()


async def reset_steps_from(job_id: uuid.UUID, from_step_name: str) -> None:
    step_order_by_name = {name: ord_ for name, ord_ in PIPELINE_STEPS}
    start_ord = step_order_by_name.get(from_step_name, 0)
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(GenerationJob)
            .where(GenerationJob.id == job_id)
            .options(selectinload(GenerationJob.steps))
        )
        job = res.scalars().first()
        if not job:
            return
        svc = GenerationJobService(db)
        for s in sorted(job.steps, key=lambda x: x.step_order):
            if s.step_order < start_ord:
                s.status = "completed"
                s.progress = 100
            else:
                s.status = "pending"
                s.progress = 0
                s.error_message = None
                s.step_metadata = {}
        if from_step_name == "scene_generation":
            await svc.delete_scenes_for_job(job.id)
            merged = dict(job.input_payload or {})
            merged.pop("caption", None)
            merged.pop("hashtags", None)
            job.input_payload = merged
        if from_step_name in ("image_generation", "scene_generation"):
            res_sc = await db.execute(select(GenerationScene).where(GenerationScene.job_id == job.id))
            for sc in res_sc.scalars().all():
                sc.start_image_url = None
                sc.end_image_url = None
                sc.video_url = None
                sc.error_message = None
                sc.status = "pending"
        if from_step_name == "video_generation":
            res_sc = await db.execute(select(GenerationScene).where(GenerationScene.job_id == job.id))
            for sc in res_sc.scalars().all():
                sc.video_url = None
                if sc.start_image_url or sc.end_image_url:
                    sc.status = "completed"
                else:
                    sc.status = "pending"
                sc.error_message = None
        job.output_url = None
        job.status = "running"
        job.progress = 0
        sc_ctrl = default_step_control()
        for name, ord_ in PIPELINE_STEPS:
            sc_ctrl[name] = "completed" if ord_ < start_ord else "pending"
        job.step_control = sc_ctrl
        await svc.append_log(job, f"Retry pipeline from step: {from_step_name}")
        await db.commit()


async def run_generation_job_pipeline_from(job_id: uuid.UUID, from_step_name: str) -> None:
    if not await try_begin_exclusive_job_pipeline(job_id):
        emit(
            "pipeline_skipped",
            job_id=str(job_id),
            reason="duplicate_pipeline_retry",
            step=from_step_name,
            level="warning",
        )
        return
    try:
        await reset_steps_from(job_id, from_step_name)
        await _run_generation_job_pipeline_inner(job_id)
    finally:
        await end_exclusive_job_pipeline(job_id)
