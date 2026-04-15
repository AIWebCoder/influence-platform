from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional, Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.generation_job import GenerationJob, GenerationScene, GenerationStep

PIPELINE_STEPS: Sequence[tuple[str, int]] = (
    ("scene_generation", 0),
    ("image_generation", 1),
    ("video_generation", 2),
    ("assembly", 3),
    ("distribution", 4),
)


class GenerationJobService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_job(self, input_payload: dict) -> GenerationJob:
        job = GenerationJob(
            status="draft",
            progress=0,
            input_payload=input_payload,
            output_url=None,
            logs=[],
        )
        self.db.add(job)
        await self.db.flush()

        for step_name, order in PIPELINE_STEPS:
            self.db.add(
                GenerationStep(
                    job_id=job.id,
                    step_name=step_name,
                    step_order=order,
                    status="pending",
                    progress=0,
                    step_metadata={},
                )
            )
        await self.db.flush()
        await self.db.refresh(job)
        return job

    async def get_job(self, job_id: uuid.UUID | str, with_children: bool = True) -> Optional[GenerationJob]:
        jid = uuid.UUID(str(job_id))
        stmt = select(GenerationJob).where(GenerationJob.id == jid)
        if with_children:
            stmt = stmt.options(
                selectinload(GenerationJob.steps),
                selectinload(GenerationJob.scenes),
            )
        res = await self.db.execute(stmt)
        return res.scalars().first()

    async def get_step(self, job_id: uuid.UUID, step_name: str) -> Optional[GenerationStep]:
        res = await self.db.execute(
            select(GenerationStep).where(
                GenerationStep.job_id == job_id,
                GenerationStep.step_name == step_name,
            )
        )
        return res.scalars().first()

    async def get_scene(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> Optional[GenerationScene]:
        res = await self.db.execute(
            select(GenerationScene).where(
                GenerationScene.job_id == job_id,
                GenerationScene.id == scene_id,
            )
        )
        return res.scalars().first()

    async def delete_scenes_for_job(self, job_id: uuid.UUID) -> None:
        await self.db.execute(delete(GenerationScene).where(GenerationScene.job_id == job_id))

    async def append_log(self, job: GenerationJob, message: str, level: str = "info") -> None:
        logs: list[dict[str, Any]] = list(job.logs or [])
        logs.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "level": level,
                "message": message,
            }
        )
        job.logs = logs[-200:]

    def touch(self, job: GenerationJob) -> None:
        job.updated_at = datetime.now(timezone.utc)
