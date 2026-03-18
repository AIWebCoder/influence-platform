from typing import List, Optional
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import ContentPacket

class ContentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_packets(self, skip: int = 0, limit: int = 100) -> List[ContentPacket]:
        result = await self.db.execute(select(ContentPacket).offset(skip).limit(limit))
        return result.scalars().all()

    async def get_packet_by_id(self, packet_id: str) -> Optional[ContentPacket]:
        result = await self.db.execute(select(ContentPacket).filter(ContentPacket.id == packet_id))
        return result.scalars().first()

    async def create_packet(self, packet: ContentPacket) -> ContentPacket:
        self.db.add(packet)
        await self.db.flush()
        await self.db.refresh(packet)
        return packet

    async def update_packet(self, packet: ContentPacket) -> ContentPacket:
        await self.db.flush()
        await self.db.refresh(packet)
        return packet

    async def delete_packet(self, packet_id: str) -> bool:
        packet = await self.get_packet_by_id(packet_id)
        if not packet:
            return False
        await self.db.delete(packet)
        await self.db.flush()
        return True
