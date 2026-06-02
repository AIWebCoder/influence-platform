from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.access_scope import AccessScope, allowed_account_ids, get_access_scope
from src.core.database import get_db

router = APIRouter()


class ReadyQueueItem(BaseModel):
    intent_id: str
    generation_job_id: str
    status: str
    content_type: Optional[str] = None
    caption: Optional[str] = None
    public_url: Optional[str] = None
    target_count: int = 0
    created_at: Optional[str] = None


@router.get("", response_model=List[ReadyQueueItem])
async def list_ready_queue(
    status: str = Query(default="ready", description="Comma-separated statuses, e.g. ready,draft"),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    allowed = frozenset({"ready", "draft", "queued", "dispatched", "published", "failed"})
    statuses = [s.strip().lower() for s in status.split(",") if s.strip().lower() in allowed]
    if not statuses:
        statuses = ["ready"]
    status_sql = ", ".join(f"'{s}'" for s in statuses)
    scope_clause = ""
    query_params: dict = {"limit": limit, "skip": skip}
    if not scope.is_fleet:
        allowed = await allowed_account_ids(db, scope)
        if not allowed:
            return []
        scope_clause = """
            AND EXISTS (
              SELECT 1 FROM publication_targets pt
              JOIN accounts a ON a.id = pt.account_id
              WHERE pt.publication_intent_id = pi.id
                AND pt.account_id = ANY(CAST(:scope_account_ids AS uuid[]))
            )
        """
        query_params["scope_account_ids"] = [str(a) for a in allowed]

    result = await db.execute(
        text(
            f"""
            SELECT
                pi.id::text AS intent_id,
                pi.generation_job_id::text AS generation_job_id,
                pi.status,
                pi.content_type,
                pi.caption,
                ga.public_url,
                pi.created_at,
                (
                    SELECT COUNT(*)::int
                    FROM publication_targets pt
                    WHERE pt.publication_intent_id = pi.id
                ) AS target_count
            FROM publication_intents pi
            LEFT JOIN generated_assets ga ON ga.id = pi.primary_asset_id
            WHERE pi.status IN ({status_sql})
            {scope_clause}
            ORDER BY pi.created_at DESC NULLS LAST
            LIMIT :limit OFFSET :skip
            """
        ),
        query_params,
    )
    rows: list[ReadyQueueItem] = []
    for row in result.mappings().all():
        created = row.get("created_at")
        rows.append(
            ReadyQueueItem(
                intent_id=row["intent_id"],
                generation_job_id=row["generation_job_id"],
                status=row["status"],
                content_type=row.get("content_type"),
                caption=row.get("caption"),
                public_url=row.get("public_url"),
                target_count=int(row.get("target_count") or 0),
                created_at=created.isoformat() if created else None,
            )
        )
    return rows
