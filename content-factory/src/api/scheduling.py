from datetime import date, datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.publish_scheduling_service import PublishSchedulingService
from src.services.scheduling_service import SchedulingService
from src.models.content import ContentPacket

router = APIRouter()

class StatusUpdate(BaseModel):
    status: str


class ScheduleUpdate(BaseModel):
    scheduled_at: datetime


class PublishCalendarItem(BaseModel):
    """Instagram publish intent on the editorial calendar."""

    id: str
    generation_job_id: Optional[str] = None
    content_type: str = "reel"
    caption: Optional[str] = None
    visual_url: Optional[str] = None
    scheduled_at: Optional[datetime] = Field(
        default=None,
        description="scheduled_for on publication_intents",
    )
    niche: Optional[str] = None
    status: str
    mode: str = "scheduled"
    target_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class CalendarResponse(BaseModel):
    """Legacy content_packets calendar row (deprecated)."""

    id: uuid.UUID
    caption: Optional[str] = None
    visual_url: Optional[str] = None
    hashtags: list[str] = []
    scheduled_at: Optional[datetime] = None
    niche: Optional[str] = None
    status: str
    template_id: Optional[uuid.UUID] = None

    model_config = ConfigDict(from_attributes=True)


@router.get("/calendar", response_model=List[PublishCalendarItem])
async def get_publish_calendar(
    start_date: date,
    end_date: date,
    niche: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Publication intents scheduled for Instagram (replaces legacy content_packets calendar)."""
    svc = PublishSchedulingService(db)
    rows = await svc.get_publish_calendar(start_date=start_date, end_date=end_date, niche=niche)
    return [PublishCalendarItem(**row) for row in rows]


@router.patch("/publish-intents/{intent_id}/schedule", response_model=PublishCalendarItem)
async def update_publish_intent_schedule(
    intent_id: uuid.UUID,
    update_data: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
):
    svc = PublishSchedulingService(db)
    try:
        row = await svc.update_publish_intent_schedule(intent_id, update_data.scheduled_at)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Publication intent not found")
    return PublishCalendarItem(**row)


# --- Legacy content_packets endpoints (kept for old clients) ---


@router.get("/packets-calendar", response_model=List[CalendarResponse], include_in_schema=False)
async def get_legacy_packets_calendar(
    start_date: date,
    end_date: date,
    niche: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    svc = SchedulingService(db)
    packets = await svc.get_editorial_calendar(start_date=start_date, end_date=end_date, niche=niche)
    return packets


@router.patch("/{packet_id}/status", response_model=CalendarResponse, include_in_schema=False)
async def update_packet_status(
    packet_id: uuid.UUID,
    update_data: StatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    svc = SchedulingService(db)
    allowed_statuses = {"pending", "queued", "published", "failed"}
    if update_data.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    packet = await svc.update_status(packet_id, update_data.status)
    if not packet:
        raise HTTPException(status_code=404, detail="ContentPacket not found")
    return packet


@router.patch("/{packet_id}/schedule", response_model=CalendarResponse, include_in_schema=False)
async def update_packet_schedule(
    packet_id: uuid.UUID,
    update_data: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
):
    svc = SchedulingService(db)
    packet = await svc.update_scheduled_at(packet_id, update_data.scheduled_at)
    if not packet:
        raise HTTPException(status_code=404, detail="ContentPacket not found")
    return packet
