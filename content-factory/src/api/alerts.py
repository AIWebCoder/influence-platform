from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional

from src.core.access_scope import AccessScope, alerts_scope_clause, allowed_account_ids, get_access_scope
from src.core.database import get_db
from src.api.deps_scope import require_write_access

router = APIRouter()


@router.get("")
async def get_alerts(
    is_read: Optional[bool] = None,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    """Get all alerts, optionally filtered by read status."""
    accounts = await allowed_account_ids(db, scope)
    scope_sql, scope_params = alerts_scope_clause(scope, accounts)
    query = f"SELECT id, account_id, type, message, is_read, created_at FROM alerts WHERE ({scope_sql})"
    params = dict(scope_params)

    if is_read is not None:
        query += " AND is_read = :is_read"
        params["is_read"] = is_read

    query += " ORDER BY created_at DESC LIMIT 50"
    result = await db.execute(text(query), params)
    rows = result.fetchall()

    return [
        {
            "id": str(row.id),
            "account_id": str(row.account_id) if row.account_id else None,
            "type": row.type,
            "message": row.message,
            "is_read": row.is_read,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.get("/unread/count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    """Get count of unread alerts."""
    accounts = await allowed_account_ids(db, scope)
    scope_sql, scope_params = alerts_scope_clause(scope, accounts)
    result = await db.execute(
        text(f"SELECT COUNT(*) as count FROM alerts WHERE is_read = false AND ({scope_sql})"),
        scope_params,
    )
    row = result.fetchone()
    return {"unread_count": row.count if row else 0}


@router.post("/read-all")
async def mark_all_alerts_read(
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """Mark every unread alert as read (must be registered before /read/{alert_id})."""
    accounts = await allowed_account_ids(db, scope)
    scope_sql, scope_params = alerts_scope_clause(scope, accounts)
    result = await db.execute(
        text(f"UPDATE alerts SET is_read = true WHERE is_read = false AND ({scope_sql})"),
        scope_params,
    )
    return {"status": "success", "marked_count": result.rowcount}


@router.post("/read/{alert_id}")
async def mark_alert_read(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """Mark a single alert as read."""
    accounts = await allowed_account_ids(db, scope)
    scope_sql, scope_params = alerts_scope_clause(scope, accounts)
    scope_params["alert_id"] = alert_id
    result = await db.execute(
        text(
            f"""
            UPDATE alerts SET is_read = true
            WHERE id = :alert_id::uuid AND ({scope_sql})
            RETURNING id
            """
        ),
        scope_params,
    )
    if not result.fetchone():
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "success"}
