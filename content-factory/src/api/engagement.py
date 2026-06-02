from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.access_scope import AccessScope, assert_account_access, get_access_scope
from src.api.deps_scope import require_write_access
from src.services.engagement_dispatcher import ACTION_TYPES, TARGET_TYPES, dispatch_engagement_intent

router = APIRouter()


class EngagementIntentCreate(BaseModel):
    account_id: str
    action_type: str = Field(..., description="comment_like | comment_reply | dm_send")
    target_id: str = Field(..., description="Instagram comment id, user id (IGSID), or thread id")
    target_type: str = Field(default="comment", description="comment | user | thread")
    target_username: Optional[str] = None
    parent_target_id: Optional[str] = Field(
        default=None, description="Media id when action is on a comment under owned media"
    )
    message_text: Optional[str] = None
    platform: str = "instagram"
    mode: str = Field(default="execute_now", description="execute_now | scheduled")
    scheduled_for: Optional[str] = None
    idempotency_key: str


class EngagementIntentResponse(BaseModel):
    intent_id: str
    status: str
    action_type: str
    account_id: str
    target_id: str
    message_text: Optional[str] = None
    error_message: Optional[str] = None
    external_result_id: Optional[str] = None
    created_at: Optional[str] = None


class EngagementDispatchResponse(BaseModel):
    intent_id: str
    status: str
    action_type: Optional[str] = None
    note: Optional[str] = None


def _parse_optional_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value or not str(value).strip():
        return None
    raw = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/intents", response_model=List[EngagementIntentResponse])
async def list_engagement_intents(
    status: str = Query(default="", description="Comma-separated statuses"),
    action_type: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    allowed_status = frozenset({"ready", "queued", "processing", "completed", "failed"})
    statuses = [s.strip().lower() for s in status.split(",") if s.strip().lower() in allowed_status]

    clauses: list[str] = []
    params: dict[str, Any] = {"limit": limit, "skip": skip}
    if scope.is_fleet:
        clauses.append("TRUE")
    else:
        from src.core.access_scope import allowed_account_ids

        allowed = await allowed_account_ids(db, scope)
        if not allowed:
            return []
        clauses.append("ei.account_id = ANY(CAST(:scope_account_ids AS uuid[]))")
        params["scope_account_ids"] = [str(a) for a in allowed]
    if statuses:
        status_sql = ", ".join(f"'{s}'" for s in statuses)
        clauses.append(f"ei.status IN ({status_sql})")
    if action_type.strip().lower() in ACTION_TYPES:
        clauses.append("ei.action_type = :action_type")
        params["action_type"] = action_type.strip().lower()

    where_sql = " AND ".join(clauses)
    result = await db.execute(
        text(
            f"""
            SELECT
                ei.id::text,
                ei.status,
                ei.action_type,
                ei.account_id::text,
                ei.target_id,
                ei.message_text,
                ei.error_message,
                ei.external_result_id,
                ei.created_at
            FROM engagement_intents ei
            JOIN accounts a ON a.id = ei.account_id
            WHERE {where_sql}
            ORDER BY ei.created_at DESC NULLS LAST
            LIMIT :limit OFFSET :skip
            """
        ),
        params,
    )
    rows: list[EngagementIntentResponse] = []
    for r in result.fetchall():
        created = r[8]
        rows.append(
            EngagementIntentResponse(
                intent_id=str(r[0]),
                status=str(r[1]),
                action_type=str(r[2]),
                account_id=str(r[3]),
                target_id=str(r[4]),
                message_text=r[5],
                error_message=r[6],
                external_result_id=r[7],
                created_at=created.isoformat() if created else None,
            )
        )
    return rows


@router.post("/intents", response_model=EngagementIntentResponse, status_code=201)
async def create_engagement_intent(
    body: EngagementIntentCreate,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    action = (body.action_type or "").strip().lower()
    if action not in ACTION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid action_type")
    target_type = (body.target_type or "comment").strip().lower()
    if target_type not in TARGET_TYPES:
        raise HTTPException(status_code=400, detail="Invalid target_type")
    mode = (body.mode or "execute_now").strip().lower()
    if mode not in ("execute_now", "scheduled"):
        raise HTTPException(status_code=400, detail="Invalid mode")
    idempotency_key = (body.idempotency_key or "").strip()
    if not idempotency_key:
        raise HTTPException(status_code=400, detail="idempotency_key is required")

    try:
        account_uuid = UUID(body.account_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid account_id")
    await assert_account_access(db, scope, account_uuid)

    existing = await db.execute(
        text("SELECT id::text, status FROM engagement_intents WHERE idempotency_key = :key LIMIT 1"),
        {"key": idempotency_key},
    )
    ex = existing.first()
    if ex:
        full = await db.execute(
            text(
                """
                SELECT id::text, status, action_type, account_id::text, target_id,
                       message_text, error_message, external_result_id, created_at
                FROM engagement_intents WHERE id = :id
                """
            ),
            {"id": str(ex[0])},
        )
        r = full.first()
        created = r[8]
        return EngagementIntentResponse(
            intent_id=str(r[0]),
            status=str(r[1]),
            action_type=str(r[2]),
            account_id=str(r[3]),
            target_id=str(r[4]),
            message_text=r[5],
            error_message=r[6],
            external_result_id=r[7],
            created_at=created.isoformat() if created else None,
        )

    scheduled_for = _parse_optional_iso_datetime(body.scheduled_for)
    if mode == "scheduled" and scheduled_for is None:
        raise HTTPException(status_code=400, detail="scheduled_for is required when mode is scheduled")

    acc = await db.execute(
        text("SELECT id::text FROM accounts WHERE id = :id LIMIT 1"),
        {"id": str(account_uuid)},
    )
    if not acc.first():
        raise HTTPException(status_code=404, detail="Account not found")

    ins = await db.execute(
        text(
            """
            INSERT INTO engagement_intents (
                account_id, platform, action_type, target_type, target_id,
                target_username, parent_target_id, message_text, mode, scheduled_for,
                status, idempotency_key
            )
            VALUES (
                :account_id, :platform, :action_type, :target_type, :target_id,
                :target_username, :parent_target_id, :message_text, :mode, :scheduled_for,
                'ready', :idempotency_key
            )
            RETURNING id::text, status, action_type, account_id::text, target_id,
                      message_text, error_message, external_result_id, created_at
            """
        ),
        {
            "account_id": str(account_uuid),
            "platform": (body.platform or "instagram").strip().lower(),
            "action_type": action,
            "target_type": target_type,
            "target_id": body.target_id.strip(),
            "target_username": body.target_username,
            "parent_target_id": body.parent_target_id,
            "message_text": body.message_text,
            "mode": mode,
            "scheduled_for": scheduled_for,
            "idempotency_key": idempotency_key,
        },
    )
    r = ins.first()
    await db.commit()
    created = r[8]
    return EngagementIntentResponse(
        intent_id=str(r[0]),
        status=str(r[1]),
        action_type=str(r[2]),
        account_id=str(r[3]),
        target_id=str(r[4]),
        message_text=r[5],
        error_message=r[6],
        external_result_id=r[7],
        created_at=created.isoformat() if created else None,
    )


@router.post("/intents/{intent_id}/dispatch", response_model=EngagementDispatchResponse)
async def dispatch_intent(
    intent_id: str,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    try:
        UUID(intent_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid intent id")
    row = await db.execute(
        text("SELECT account_id::text FROM engagement_intents WHERE id = :id LIMIT 1"),
        {"id": intent_id},
    )
    intent_row = row.first()
    if not intent_row:
        raise HTTPException(status_code=404, detail="Engagement intent not found")
    await assert_account_access(db, scope, intent_row[0])

    try:
        result = await dispatch_engagement_intent(intent_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return EngagementDispatchResponse(
        intent_id=result["intent_id"],
        status=result["status"],
        action_type=result.get("action_type"),
        note=result.get("note"),
    )
