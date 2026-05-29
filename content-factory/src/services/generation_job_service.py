from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Optional, Sequence

from sqlalchemy import delete, select, text
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


def default_step_control() -> dict[str, str]:
    return {name: "pending" for name, _ in PIPELINE_STEPS}


class GenerationJobService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_job(self, input_payload: dict, execution_mode: str = "scene_based") -> GenerationJob:
        job = GenerationJob(
            status="draft",
            execution_mode=execution_mode or "scene_based",
            progress=0,
            input_payload=input_payload,
            step_control=default_step_control(),
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

    async def list_jobs(
        self,
        *,
        statuses: Optional[Sequence[str]] = None,
        limit: int = 50,
        skip: int = 0,
    ) -> list[GenerationJob]:
        stmt = select(GenerationJob).order_by(GenerationJob.updated_at.desc()).limit(limit).offset(skip)
        if statuses:
            stmt = stmt.where(GenerationJob.status.in_(list(statuses)))
        res = await self.db.execute(stmt)
        return list(res.scalars().all())

    # Intent statuses that mean publish was started or finished (hide from waiting list).
    _PUBLISHED_INTENT_STATUSES = ("queued", "published", "partial_failed")

    def _ready_to_publish_where_sql(self) -> str:
        published = ", ".join(f"'{s}'" for s in self._PUBLISHED_INTENT_STATUSES)
        return f"""
            gj.status = 'completed'
            AND (
              (gj.output_url IS NOT NULL AND TRIM(gj.output_url) <> '')
              OR EXISTS (
                SELECT 1 FROM generated_assets ga
                WHERE ga.generation_job_id = gj.id
                  AND ga.public_url IS NOT NULL
                  AND TRIM(ga.public_url) <> ''
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM publication_intents pi
              WHERE pi.generation_job_id = gj.id
                AND pi.status IN ({published})
            )
        """

    def _ready_to_publish_ranked_cte(self) -> str:
        where = self._ready_to_publish_where_sql()
        return f"""
            WITH ready AS (
              SELECT gj.id, gj.updated_at, gj.input_payload
              FROM generation_jobs gj
              WHERE {where}
            ),
            ranked AS (
              SELECT
                id,
                updated_at,
                input_payload,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(
                    NULLIF(BTRIM(input_payload->'target_accounts'->>0), ''),
                    '__none__'
                  )
                  ORDER BY updated_at ASC
                )::int AS queue_index
              FROM ready
            )
        """

    async def count_ready_to_publish(self, *, account_id: Optional[str] = None) -> int:
        from sqlalchemy import text as sql_text

        account_clause = ""
        params: dict[str, Any] = {}
        if account_id:
            account_clause = "AND (gj.input_payload->'target_accounts'->>0) = :account_id"
            params["account_id"] = account_id

        where = self._ready_to_publish_where_sql()
        res = await self.db.execute(
            sql_text(
                f"""
                SELECT COUNT(*)::int
                FROM generation_jobs gj
                WHERE {where}
                {account_clause}
                """
            ),
            params,
        )
        return int(res.scalar() or 0)

    async def list_ready_to_publish_account_counts(self) -> list[tuple[str, int]]:
        from sqlalchemy import text as sql_text

        where = self._ready_to_publish_where_sql()
        res = await self.db.execute(
            sql_text(
                f"""
                SELECT
                  BTRIM(gj.input_payload->'target_accounts'->>0) AS account_id,
                  COUNT(*)::int AS job_count
                FROM generation_jobs gj
                WHERE {where}
                  AND BTRIM(gj.input_payload->'target_accounts'->>0) <> ''
                GROUP BY 1
                ORDER BY 1
                """
            )
        )
        return [(str(row[0]), int(row[1])) for row in res.fetchall() if row[0]]

    async def list_ready_to_publish(
        self,
        *,
        limit: int = 50,
        skip: int = 0,
        account_id: Optional[str] = None,
    ) -> tuple[list[GenerationJob], dict[str, int]]:
        """Completed jobs with output assets and no active/published publication intent."""
        from sqlalchemy import text as sql_text

        account_clause = ""
        params: dict[str, Any] = {"limit": limit, "skip": skip}
        if account_id:
            account_clause = "AND (input_payload->'target_accounts'->>0) = :account_id"
            params["account_id"] = account_id

        cte = self._ready_to_publish_ranked_cte()
        id_res = await self.db.execute(
            sql_text(
                f"""
                {cte}
                SELECT id, queue_index
                FROM ranked
                WHERE 1=1
                {account_clause}
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :skip
                """
            ),
            params,
        )
        rows = id_res.fetchall()
        if not rows:
            return [], {}

        job_ids = [row[0] for row in rows]
        queue_index_by_id = {str(row[0]): int(row[1]) for row in rows}
        res = await self.db.execute(select(GenerationJob).where(GenerationJob.id.in_(job_ids)))
        by_id = {j.id: j for j in res.scalars().all()}
        jobs = [by_id[jid] for jid in job_ids if jid in by_id]
        return jobs, queue_index_by_id

    async def set_target_accounts(
        self,
        job_id: uuid.UUID | str,
        account_ids: list[str],
    ) -> GenerationJob:
        job = await self.get_job(job_id, with_children=False)
        if not job:
            raise LookupError("Job not found")
        payload = dict(job.input_payload or {})
        payload["target_accounts"] = list(account_ids)
        job.input_payload = payload
        self.touch(job)
        await self.db.flush()
        await self.db.refresh(job)
        return job

    async def delete_job(self, job_id: uuid.UUID | str) -> None:
        jid = uuid.UUID(str(job_id))
        job = await self.get_job(jid, with_children=False)
        if not job:
            raise LookupError("Job not found")
        if job.status in ("running", "pending", "cancelling"):
            raise ValueError("Job is still running; cancel it first.")
        await self.db.execute(delete(GenerationJob).where(GenerationJob.id == jid))
        await self.db.flush()

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

    async def complete_as_simulated_queue_entry(
        self,
        job: GenerationJob,
        *,
        video_url: str,
        create_minimal_scene: bool = False,
    ) -> GenerationJob:
        """Mark a job completed with a public sample video so it appears on /queue (no Kie tokens)."""
        job = await self.get_job(job.id, with_children=True)
        if not job:
            raise LookupError("Job not found")

        payload = dict(job.input_payload or {})
        topic = (payload.get("topic") or payload.get("niche") or "Queue E2E test").strip()
        safe_url = (video_url or "").strip()
        if not safe_url.startswith("https://"):
            raise ValueError("Simulation video URL must be a public https URL")

        if create_minimal_scene or not job.scenes:
            if not job.scenes:
                self.db.add(
                    GenerationScene(
                        job_id=job.id,
                        scene_index=0,
                        prompt=f"[simulation] {topic}",
                        duration=5,
                        scene_role="simulation",
                        status="completed",
                        video_url=safe_url,
                        scene_metadata={"simulated": True},
                    )
                )
        else:
            for sc in sorted(job.scenes, key=lambda x: x.scene_index):
                sc.status = "completed"
                if sc.scene_index == 0:
                    sc.video_url = safe_url

        for step in job.steps or []:
            step.status = "completed"
            step.progress = 100
            step.error_message = None

        job.status = "completed"
        job.progress = 100
        job.output_url = safe_url
        job.step_control = {name: "completed" for name, _ in PIPELINE_STEPS}
        if not (payload.get("caption") or "").strip():
            payload["caption"] = f"[Test queue] {topic}"
        payload["simulated_queue_entry"] = True
        job.input_payload = payload

        await self.append_log(
            job,
            "Simulated queue entry (no Kie/Seedance/AliveAI tokens consumed).",
            level="info",
        )
        self.touch(job)
        await self.db.flush()

        existing = await self.db.execute(
            text("SELECT id::text FROM generated_assets WHERE generation_job_id = :job_id AND public_url = :url LIMIT 1"),
            {"job_id": str(job.id), "url": safe_url},
        )
        if not existing.first():
            checksum = hashlib.sha256(safe_url.encode("utf-8")).hexdigest()
            object_key = f"generated/{job.id}/video/simulated.mp4"
            await self.db.execute(
                text(
                    """
                    INSERT INTO generated_assets (
                        generation_job_id, asset_type, storage_provider, object_key, public_url,
                        mime_type, size_bytes, duration_seconds, width, height, checksum_sha256, status
                    ) VALUES (
                        :generation_job_id, 'video', 'url', :object_key, :public_url,
                        'video/mp4', 0, 5, NULL, NULL, :checksum_sha256, 'ready'
                    )
                    """
                ),
                {
                    "generation_job_id": str(job.id),
                    "object_key": object_key,
                    "public_url": safe_url,
                    "checksum_sha256": checksum,
                },
            )

        await self.db.refresh(job)
        return job
