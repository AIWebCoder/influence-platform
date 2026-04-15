from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.redis import push_to_queue
from src.models.generation_job import GenerationJob, GenerationScene, GenerationStep
from src.services.gemini_service import GeminiService
from src.services.generation_job_service import PIPELINE_STEPS, GenerationJobService
from src.services.kie_service import KieService

logger = logging.getLogger(__name__)

def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    content_type = payload.get("content_type") or payload.get("type") or "reel"
    mode = payload.get("mode") or "faceless"

    gemini = GeminiService()
    scene_count = int(payload.get("scene_count") or 7)
    plan = await gemini.generate_scene_plan(
        niche=niche,
        topic=topic,
        content_type=content_type,
        mode=mode,
        scene_count=scene_count,
    )

    copy = await gemini.generate_caption(niche=niche, topic=topic)
    merged = dict(payload)
    merged["caption"] = copy.get("caption", "")
    merged["hashtags"] = copy.get("hashtags", [])
    job.input_payload = merged

    for row in plan:
        db.add(
            GenerationScene(
                job_id=job.id,
                scene_index=int(row["scene_index"]),
                prompt=row["prompt"][:8000],
                duration=int(row["duration"]),
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
    job.progress = 5
    await svc.append_log(job, "Draft scenes and caption generated. Launch to run media pipeline.")
    svc.touch(job)
    await db.flush()


async def run_generation_job_pipeline(job_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        try:
            await _execute_pipeline(db, job_id)
            await db.commit()
        except Exception as e:
            logger.exception("generation job %s failed", job_id)
            await db.rollback()
            async with AsyncSessionLocal() as db2:
                svc = GenerationJobService(db2)
                job = await svc.get_job(job_id, with_children=False)
                if job:
                    job.status = "failed"
                    await svc.append_log(job, f"Job error: {e}", "error")
                    svc.touch(job)
                    await db2.commit()


async def _execute_pipeline(db, job_id: uuid.UUID) -> None:
    svc = GenerationJobService(db)
    job = await svc.get_job(job_id, with_children=True)
    if not job:
        return

    if job.status in ("draft", "ready"):
        logger.warning("pipeline skipped for job %s (status=%s)", job_id, job.status)
        return
    if job.status == "pending":
        job.status = "running"
    elif job.status != "running":
        logger.warning("pipeline skipped for job %s (status=%s)", job_id, job.status)
        return
    svc.touch(job)
    await db.commit()

    steps_by_name = {s.step_name: s for s in job.steps}

    for step_name, _order in PIPELINE_STEPS:
        step = steps_by_name.get(step_name)
        if not step:
            continue
        if step.status == "completed":
            continue

        step.status = "running"
        step.error_message = None
        step.progress = 0
        svc.touch(job)
        await svc.append_log(job, f"Step started: {step_name}")
        await db.commit()

        try:
            if step_name == "scene_generation":
                await _step_scene_generation(db, svc, job, step)
            elif step_name == "image_generation":
                await _step_image_generation(db, svc, job, step)
            elif step_name == "video_generation":
                await _step_video_generation(db, svc, job, step)
            elif step_name == "assembly":
                await _step_assembly(db, svc, job, step)
            elif step_name == "distribution":
                await _step_distribution(db, svc, job, step)
        except Exception as e:
            step.status = "failed"
            step.error_message = str(e)
            step.progress = 0
            await svc.append_log(job, f"Step failed {step_name}: {e}", "error")
            svc.touch(job)
            await db.commit()
            raise

        step.status = "completed"
        step.progress = 100
        svc.touch(job)
        await svc.append_log(job, f"Step completed: {step_name}")
        await db.commit()

    job.status = "completed"
    job.progress = 100
    svc.touch(job)
    await db.commit()


async def _step_scene_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    if step.status == "completed":
        res = await db.execute(
            select(GenerationScene).where(GenerationScene.job_id == job.id).limit(1)
        )
        if res.scalars().first():
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

    gemini = GeminiService()
    scene_count = int(payload.get("scene_count") or 7)
    plan = await gemini.generate_scene_plan(
        niche=niche,
        topic=topic,
        content_type=content_type,
        mode=mode,
        scene_count=scene_count,
    )

    copy = await gemini.generate_caption(niche=niche, topic=topic)
    merged = dict(payload)
    merged["caption"] = copy.get("caption", "")
    merged["hashtags"] = copy.get("hashtags", [])
    job.input_payload = merged

    for row in plan:
        db.add(
            GenerationScene(
                job_id=job.id,
                scene_index=int(row["scene_index"]),
                prompt=row["prompt"][:8000],
                duration=int(row["duration"]),
                scene_role=row.get("role"),
                status="pending",
                scene_metadata={},
            )
        )
    step.progress = 50
    await db.flush()
    await db.refresh(job, attribute_names=["scenes"])
    step.progress = 100
    job.progress = 15


async def _step_image_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
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
        sc.status = "running"
        sc.error_message = None
        await db.commit()
        try:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            start_p = f"{sc.prompt} — cinematic opening keyframe, {ctype}, high detail."
            end_p = f"{sc.prompt} — closing keyframe, different composition, same vibe."
            start_u = await kie.generate_image(start_p, aspect_ratio=aspect)
            end_u = await kie.generate_image(end_p, aspect_ratio=aspect)
            sc.start_image_url = start_u
            sc.end_image_url = end_u
            if start_u == "ERROR: INSUFFICIENT_CREDITS" or end_u == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not start_u and not end_u:
                raise RuntimeError("Image API returned no URLs")
            sc.status = "completed"
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene {sc.scene_index} images failed: {e}", "warning")
        svc.touch(job)
        await db.commit()

    for s in scenes:
        await one_scene(s)

    await db.refresh(job)
    res2 = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res2.scalars().all())
    ok = sum(1 for s in scenes if s.status == "completed")
    step.step_metadata = {"scenes_completed": ok, "scenes_total": len(scenes)}
    step.progress = 100
    job.progress = 40
    if ok == 0:
        raise RuntimeError("All scenes failed image generation")


async def _step_video_generation(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    kie = KieService()

    async def one_video(sc: GenerationScene) -> None:
        if sc.status != "completed":
            return
        try:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            v_prompt = f"{sc.prompt} — short vertical clip, motion, coherent lighting."
            dur = min(max(int(sc.duration or 4), 3), 5)
            url = await kie.generate_video(v_prompt, duration=dur)
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                raise RuntimeError("Video API returned no URL")
            sc.video_url = url
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene {sc.scene_index} video failed: {e}", "warning")
        svc.touch(job)
        await db.commit()

    for s in scenes:
        await one_video(s)

    await db.refresh(job)
    res2 = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res2.scalars().all())
    v_ok = sum(1 for s in scenes if s.video_url)
    step.step_metadata = {"videos_ready": v_ok, "scenes_total": len(scenes)}
    step.progress = 100
    job.progress = 65
    if v_ok == 0:
        raise RuntimeError("All scenes failed video generation")


async def _step_assembly(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    res = await db.execute(
        select(GenerationScene)
        .where(GenerationScene.job_id == job.id)
        .order_by(GenerationScene.scene_index)
    )
    scenes = list(res.scalars().all())
    urls = [s.video_url for s in scenes if s.video_url]

    if not urls:
        raise RuntimeError("No scene videos to assemble")

    primary = urls[0]
    job.output_url = primary

    concat_path, meta = await asyncio.to_thread(_ffmpeg_concat_sync, urls)
    step.step_metadata = meta
    if concat_path:
        meta["note"] = "Local concat only; distribution uses first HTTP scene URL unless you upload assembled file."
    else:
        meta.setdefault("note", "Using primary scene URL as final visual; configure ffmpeg for multi-clip concat.")

    step.progress = 100
    job.progress = 85


async def generate_scene_preview(
    db,
    job_id: uuid.UUID,
    scene_id: uuid.UUID,
    kind: str,
) -> GenerationScene:
    """Return already-stored media URLs when available; only call Kie.ai if nothing is stored yet."""
    svc = GenerationJobService(db)
    job = await svc.get_job(job_id, with_children=False)
    if not job:
        raise ValueError("Job not found")
    sc = await svc.get_scene(job_id, scene_id)
    if not sc:
        raise ValueError("Scene not found")

    kie = KieService()
    payload = job.input_payload or {}
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    aspect = "2:3" if ctype in ("reel", "story") else "1:1"
    meta = dict(sc.scene_metadata or {})

    if kind == "video":
        # ✅ Return already-stored video URL first — zero credit cost
        if sc.video_url:
            meta["preview_video_url"] = sc.video_url
            meta["preview_kind"] = "video"
        else:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            prompt = f"{sc.prompt} — quick motion preview, vertical."
            url = await kie.generate_video(prompt, duration=3)
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                raise RuntimeError("Video preview failed")
            meta["preview_video_url"] = url
            meta["preview_kind"] = "video"
    else:
        # ✅ Return already-stored image URL first — zero credit cost
        existing_image = sc.start_image_url or sc.end_image_url
        if existing_image:
            meta["preview_image_url"] = existing_image
            meta["preview_kind"] = "image"
        else:
            if not settings.KIE_API_KEY or settings.KIE_API_KEY in ("",):
                raise RuntimeError("KIE_API_KEY not configured")
            prompt = f"{sc.prompt} — single frame preview, {ctype}, high quality."
            url = await kie.generate_image(prompt, aspect_ratio=aspect)
            if url == "ERROR: INSUFFICIENT_CREDITS":
                raise RuntimeError("Kie.ai Credits Insufficient. Please top up.")
            if not url:
                raise RuntimeError("Image preview failed")
            meta["preview_image_url"] = url
            meta["preview_kind"] = "image"

    meta["preview_generated_at"] = _now().isoformat()
    sc.scene_metadata = meta
    svc.touch(job)
    await db.flush()
    await db.refresh(sc)
    return sc


async def _step_distribution(db, svc: GenerationJobService, job: GenerationJob, step: GenerationStep) -> None:
    payload = job.input_payload or {}
    caption = payload.get("caption") or ""
    hashtags = payload.get("hashtags") or []
    target_accounts = payload.get("target_accounts") or []
    ctype = payload.get("content_type") or payload.get("type") or "reel"
    scheduled_at = payload.get("scheduled_at")

    visual_type = "video" if ctype == "reel" else "image"
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
    await push_to_queue(settings.CONTENT_QUEUE_NAME, json.dumps(export))
    step.step_metadata = {"queue": settings.CONTENT_QUEUE_NAME}
    step.progress = 100
    job.progress = 100


async def run_retry_scene(job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        if not job:
            return
        sc = await svc.get_scene(job_id, scene_id)
        if not sc:
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
            return
        kie = KieService()
        payload = job.input_payload or {}
        ctype = payload.get("content_type") or payload.get("type") or "reel"
        aspect = "9:16" if ctype in ("reel", "story") else "1:1"
        try:
            if settings.KIE_API_KEY and settings.KIE_API_KEY not in ("",):
                sc.start_image_url = await kie.generate_image(f"{sc.prompt} — opening keyframe.", aspect_ratio=aspect)
                sc.end_image_url = await kie.generate_image(f"{sc.prompt} — closing keyframe.", aspect_ratio=aspect)
                sc.status = "completed"
                dur = min(max(int(sc.duration or 4), 3), 5)
                sc.video_url = await kie.generate_video(f"{sc.prompt} — motion.", duration=dur)
        except Exception as e:
            sc.status = "failed"
            sc.error_message = str(e)
            await svc.append_log(job, f"Scene retry failed: {e}", "error")
        await db.commit()

    async with AsyncSessionLocal() as db:
        svc = GenerationJobService(db)
        job = await svc.get_job(job_id, with_children=True)
        if not job:
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
        await svc.append_log(job, f"Retry pipeline from step: {from_step_name}")
        await db.commit()


async def run_generation_job_pipeline_from(job_id: uuid.UUID, from_step_name: str) -> None:
    await reset_steps_from(job_id, from_step_name)
    await run_generation_job_pipeline(job_id)
