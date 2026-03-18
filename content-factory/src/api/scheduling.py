from datetime import date
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from src.core.database import get_db
from src.services.scheduling_service import SchedulingService
from src.models.content import ContentPacket

router = APIRouter()

class StatusUpdate(BaseModel):
    status: str

# Re-use ContentPacket response model from api/content.py conceptually
# But redefine here for simplicity, or ideally import it. We'll specify a simplified response
class CalendarResponse(BaseModel):
    id: uuid.UUID
    caption: Optional[str] = None
    visual_url: Optional[str] = None
    hashtags: list[str] = []
    scheduled_at: Optional[date] = None # Or datetime
    niche: Optional[str] = None
    status: str
    template_id: Optional[uuid.UUID] = None
    
    class Config:
        from_attributes = True

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
