from datetime import date, datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.scheduling_service import SchedulingService
from src.models.content import ContentPacket

router = APIRouter()

class StatusUpdate(BaseModel):
    status: str


class ScheduleUpdate(BaseModel):
    scheduled_at: datetime


class CalendarResponse(BaseModel):
    id: uuid.UUID
    caption: Optional[str] = None
    visual_url: Optional[str] = None
    hashtags: list[str] = []
    scheduled_at: Optional[datetime] = None
    niche: Optional[str] = None
    status: str
    template_id: Optional[uuid.UUID] = None

    model_config = ConfigDict(from_attributes=True)

@router.get("/calendar", response_model=List[CalendarResponse])
async def get_calendar(
    start_date: date,
    end_date: date,
    niche: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    svc = SchedulingService(db)
    packets = await svc.get_editorial_calendar(start_date=start_date, end_date=end_date, niche=niche)
    return packets

@router.patch("/{packet_id}/status", response_model=CalendarResponse)
async def update_packet_status(
    packet_id: uuid.UUID,
    update_data: StatusUpdate,
    db: AsyncSession = Depends(get_db)
):
    svc = SchedulingService(db)
    allowed_statuses = {"pending", "queued", "published", "failed"}
    if update_data.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")
        
    packet = await svc.update_status(packet_id, update_data.status)
    if not packet:
        raise HTTPException(status_code=404, detail="ContentPacket not found")
    return packet


@router.patch("/{packet_id}/schedule", response_model=CalendarResponse)
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
