import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from google.api_core.exceptions import GoogleAPIError, RetryError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.services.generation_job_service import PIPELINE_STEPS, GenerationJobService
from src.services.generation_orchestrator import (
    populate_draft_scenes,
    run_generation_job_pipeline,
    run_generation_job_pipeline_from,
    run_retry_scene,
    generate_scene_preview,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class PreviewScenesBody(BaseModel):
    content_type: str = "reel"
    mode: str = "faceless"
    niche: str
    topic: str
    scene_count: Optional[int] = Field(default=None, ge=6, le=8)


# Static path must register before /{job_id} routes so "preview-scenes" is never parsed as a UUID.
@router.post("/preview-scenes")
async def preview_scenes(body: PreviewScenesBody):
    """Generate scene prompts only (no job persisted)."""
    from src.services.gemini_service import GeminiService, ContentGenerationError

    if not settings.GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "Gemini is not configured: set GEMINI_API_KEY in the Content Factory "
                "environment."
            ),
        )

    gemini = GeminiService()
    n = body.scene_count or 7
    try:
        plan = await gemini.generate_scene_plan(
            niche=body.niche,
            topic=body.topic,
            content_type=body.content_type,
            mode=body.mode,
            scene_count=n,
        )
    except ContentGenerationError as e:
        logger.warning("preview_scenes model output rejected: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    except json.JSONDecodeError as e:
        logger.warning("preview_scenes JSON parse failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Could not parse scene plan JSON from the model. Try again or adjust the topic.",
        ) from e
    except (GoogleAPIError, RetryError) as e:
        logger.warning("preview_scenes Gemini API error: %s", e)
        err_text = str(e).lower()
        if "api_key" in err_text or "permission denied" in err_text or "unauthorized" in err_text:
            raise HTTPException(
                status_code=401,
                detail=(
                    "Gemini rejected the API key. "
                    "Create a key at https://aistudio.google.com/ and set "
                    "GEMINI_API_KEY for the Content Factory container."
                ),
            ) from e
        raise HTTPException(
            status_code=502,
            detail=f"Gemini API error: {str(e)}",
        ) from e
    except Exception as e:
        logger.exception("preview_scenes unexpected failure")
        raise HTTPException(
            status_code=500,
            detail=f"Scene preview failed ({type(e).__name__}). Check server logs.",
        ) from e
    return plan


class GenerationJobCreateRequest(BaseModel):
    content_type: str = Field(default="reel", description="post | reel | story")
    mode: str = Field(default="faceless", description="persona | faceless")
    niche: str
    topic: str
    target_accounts: list[str]
    scheduled_at: Optional[str] = None
    template_id: Optional[str] = None
    campaign_id: Optional[str] = None
    scene_count: Optional[int] = Field(default=None, ge=6, le=8)


class GenerationJobCreateResponse(BaseModel):
    job_id: str


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
    progress: int
    input_payload: dict[str, Any]
    output_url: Optional[str] = None
    logs: list[dict[str, Any]] = Field(default_factory=list)
    steps: list[GenerationStepOut] = Field(default_factory=list)
    scenes: list[GenerationSceneOut] = Field(default_factory=list)
    cost_estimate: Optional[dict[str, Any]] = None
    created_at: str
    updated_at: str


def _compute_cost_estimate(job) -> dict[str, Any]:
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    n = len(scenes)
    payload = job.input_payload or {}
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


def _serialize_job(job, include_cost: bool = True) -> GenerationJobDetailOut:
    steps = sorted(job.steps, key=lambda x: x.step_order)
    scenes = sorted(job.scenes, key=lambda x: x.scene_index)
    cost = None
    if include_cost and job.status in ("draft", "ready") and scenes:
        cost = _compute_cost_estimate(job)
    return GenerationJobDetailOut(
        id=str(job.id),
        status=job.status,
        progress=job.progress or 0,
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


@router.post("", response_model=GenerationJobCreateResponse)
async def create_generation_job(
    body: GenerationJobCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = body.model_dump(exclude_none=True)
        payload.setdefault("content_type", body.content_type)
        svc = GenerationJobService(db)
        job = await svc.create_job(payload)
        await db.flush()
        await populate_draft_scenes(db, job)
        await db.commit()
        await db.refresh(job)
        return GenerationJobCreateResponse(job_id=str(job.id))
    except Exception as e:
        await db.rollback()
        # Look for rate limit string indicators if underlying error isn't typed properly
        error_str = str(e).lower()
        if "quota exceeded" in error_str or "rate limit" in error_str or "429" in error_str or "resourceexhausted" in error_str:
            raise HTTPException(status_code=429, detail="Gemini Rate Limit Exceeded (5 RPM free tier). Please wait 30 seconds before creating a new job.")
        # Re-raise anything else up to the main 500 handler
        raise e


@router.post("/{job_id}/launch")
async def launch_generation_job(
    job_id: str,
    background_tasks: BackgroundTasks,
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
    if job.status not in ("draft", "ready"):
        raise HTTPException(status_code=400, detail="Job must be in draft or ready to launch")
    job.status = "running"
    job.progress = max(job.progress or 0, 1)
    svc.touch(job)
    await db.commit()
    await db.refresh(job)
    background_tasks.add_task(run_generation_job_pipeline, jid)
    return {"status": "running", "job_id": job_id}


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
    if job.status in ("draft", "ready"):
        raise HTTPException(
            status_code=400,
            detail="Launch the job before retrying pipeline steps.",
        )

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
    if job.status in ("draft", "ready"):
        raise HTTPException(
            status_code=400,
            detail="Launch the job before retrying scene media.",
        )
    sc = await svc.get_scene(jid, sid)
    if not sc:
        raise HTTPException(status_code=404, detail="Scene not found")

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
