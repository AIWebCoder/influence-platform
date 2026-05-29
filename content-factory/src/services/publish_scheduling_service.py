"""Editorial calendar and reschedule for publication_intents (Instagram publish schedule)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _day_bounds_utc(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    start_dt = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
    return start_dt, end_dt


class PublishSchedulingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_publish_calendar(
        self,
        *,
        start_date: date,
        end_date: date,
        niche: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        start_dt, end_dt = _day_bounds_utc(start_date, end_date)
        niche_filter = ""
        params: dict[str, Any] = {
            "start_dt": start_dt,
            "end_dt": end_dt,
            "unscheduled_limit": 50,
        }
        if niche:
            niche_filter = "AND COALESCE(gj.input_payload->>'niche', '') = :niche"
            params["niche"] = niche

        select_sql = f"""
            SELECT
                pi.id::text AS id,
                pi.generation_job_id::text AS generation_job_id,
                pi.content_type,
                pi.caption,
                pi.mode,
                pi.status,
                pi.scheduled_for,
                COALESCE(ga.public_url, '') AS visual_url,
                COALESCE(gj.input_payload->>'niche', '') AS niche,
                (
                    SELECT COUNT(*)::int
                    FROM publication_targets pt
                    WHERE pt.publication_intent_id = pi.id
                ) AS target_count
            FROM publication_intents pi
            LEFT JOIN generation_jobs gj ON gj.id = pi.generation_job_id
            LEFT JOIN generated_assets ga ON ga.id = pi.primary_asset_id
            WHERE pi.status NOT IN ('failed')
              {{extra_where}}
              {niche_filter}
            ORDER BY pi.scheduled_for ASC NULLS LAST, pi.updated_at DESC
            LIMIT :lim
        """

        def _map_row(r: Any) -> dict[str, Any]:
            scheduled_for = r["scheduled_for"]
            return {
                "id": str(r["id"]),
                "generation_job_id": (str(r["generation_job_id"]).strip() or None),
                "content_type": str(r["content_type"] or ""),
                "caption": r["caption"],
                "mode": str(r["mode"] or ""),
                "status": str(r["status"] or ""),
                "scheduled_at": scheduled_for.isoformat() if scheduled_for else None,
                "visual_url": (str(r["visual_url"]).strip() or None),
                "niche": (str(r["niche"]).strip() or None),
                "target_count": int(r["target_count"] or 0),
            }

        scheduled_res = await self.db.execute(
            text(
                select_sql.format(
                    extra_where="""
                      AND pi.scheduled_for IS NOT NULL
                      AND pi.scheduled_for >= :start_dt
                      AND pi.scheduled_for <= :end_dt
                    """
                )
            ),
            {**params, "lim": 150},
        )
        rows = [_map_row(r) for r in scheduled_res.mappings().all()]

        unscheduled_res = await self.db.execute(
            text(
                select_sql.format(
                    extra_where="""
                      AND pi.scheduled_for IS NULL
                      AND pi.status IN ('draft', 'ready')
                    """
                )
            ),
            {**params, "lim": params["unscheduled_limit"]},
        )
        rows.extend(_map_row(r) for r in unscheduled_res.mappings().all())
        return rows

    async def update_publish_intent_schedule(
        self,
        intent_id: uuid.UUID | str,
        scheduled_at: datetime,
    ) -> Optional[dict[str, Any]]:
        iid = uuid.UUID(str(intent_id))
        when = scheduled_at if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=timezone.utc)

        row = await self.db.execute(
            text(
                """
                SELECT id::text, status, mode
                FROM publication_intents
                WHERE id = :id
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"id": str(iid)},
        )
        hit = row.first()
        if not hit:
            return None

        status = str(hit[1])
        if status in ("queued", "published", "partial_failed"):
            raise ValueError("Cannot reschedule an intent that is already publishing or published")

        new_status = "ready" if status == "draft" else status
        await self.db.execute(
            text(
                """
                UPDATE publication_intents
                SET scheduled_for = :scheduled_for,
                    mode = 'scheduled',
                    status = :status,
                    updated_at = NOW()
                WHERE id = :id
                """
            ),
            {"id": str(iid), "scheduled_for": when, "status": new_status},
        )
        await self.db.commit()

        refreshed = await self.db.execute(
            text(
                """
                SELECT
                    pi.id::text,
                    pi.generation_job_id::text,
                    pi.content_type,
                    pi.caption,
                    pi.mode,
                    pi.status,
                    pi.scheduled_for,
                    COALESCE(ga.public_url, '') AS visual_url,
                    COALESCE(gj.input_payload->>'niche', '') AS niche,
                    (
                        SELECT COUNT(*)::int FROM publication_targets pt
                        WHERE pt.publication_intent_id = pi.id
                    ) AS target_count
                FROM publication_intents pi
                LEFT JOIN generation_jobs gj ON gj.id = pi.generation_job_id
                LEFT JOIN generated_assets ga ON ga.id = pi.primary_asset_id
                WHERE pi.id = :id
                """
            ),
            {"id": str(iid)},
        )
        r = refreshed.mappings().first()
        if not r:
            return None
        sf = r["scheduled_for"]
        return {
            "id": str(r["id"]),
            "generation_job_id": (str(r["generation_job_id"]).strip() or None),
            "content_type": str(r["content_type"] or ""),
            "caption": r["caption"],
            "mode": str(r["mode"] or ""),
            "status": str(r["status"] or ""),
            "scheduled_at": sf.isoformat() if sf else None,
            "visual_url": (str(r["visual_url"]).strip() or None),
            "niche": (str(r["niche"]).strip() or None),
            "target_count": int(r["target_count"] or 0),
        }
