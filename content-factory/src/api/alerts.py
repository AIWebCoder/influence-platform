from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional

from src.core.database import get_db

router = APIRouter()


@router.get("")
async def get_alerts(is_read: Optional[bool] = None, db: AsyncSession = Depends(get_db)):
    """Get all alerts, optionally filtered by read status."""
    query = "SELECT id, account_id, type, message, is_read, created_at FROM alerts"
    params = {}

    if is_read is not None:
        query += " WHERE is_read = :is_read"
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
async def get_unread_count(db: AsyncSession = Depends(get_db)):
    """Get count of unread alerts."""
    result = await db.execute(
        text("SELECT COUNT(*) as count FROM alerts WHERE is_read = false")
    )
    row = result.fetchone()
    return {"unread_count": row.count if row else 0}


@router.post("/read-all")
async def mark_all_alerts_read(db: AsyncSession = Depends(get_db)):
    """Mark every unread alert as read (must be registered before /read/{alert_id})."""
    result = await db.execute(
        text(
            "UPDATE alerts SET is_read = true WHERE is_read = false RETURNING id"
        )
    )
    rows = result.fetchall()
    await db.commit()
    return {"status": "ok", "marked_count": len(rows)}


@router.post("/read/{alert_id}")
async def mark_alert_read(alert_id: str, db: AsyncSession = Depends(get_db)):
    """Mark a single alert as read."""
    result = await db.execute(
        text("UPDATE alerts SET is_read = true WHERE id = :id RETURNING id"),
        {"id": alert_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found",
        )
    await db.commit()
    return {"status": "ok", "id": alert_id}
