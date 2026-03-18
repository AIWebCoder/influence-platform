from datetime import date
from typing import List, Optional
import uuid

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import ContentPacket

class SchedulingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_editorial_calendar(self, start_date: date, end_date: date, niche: Optional[str] = None) -> List[ContentPacket]:
        # Fetch packets scheduled between start_date and end_date
        query = select(ContentPacket).where(
            func.date(ContentPacket.scheduled_at) >= start_date,
            func.date(ContentPacket.scheduled_at) <= end_date
        )
        if niche:
            query = query.where(ContentPacket.niche == niche)
            
        query = query.order_by(ContentPacket.scheduled_at.asc())
        
        result = await self.db.execute(query)
        return result.scalars().all()

    async def update_status(self, packet_id: uuid.UUID, status: str) -> Optional[ContentPacket]:
        # allowed statuses: pending, queued, published, failed
        query = select(ContentPacket).where(ContentPacket.id == packet_id)
        result = await self.db.execute(query)
        packet = result.scalars().first()
        
        if packet:
            packet.status = status
            await self.db.commit()
            await self.db.refresh(packet)
            return packet
        return None
