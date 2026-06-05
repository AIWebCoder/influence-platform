from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import ContentPacket
from src.models.generation_job import GenerationJob


def _visual_type_for_job(payload: dict[str, Any]) -> Optional[str]:
    content_type = str(payload.get("content_type") or payload.get("type") or "reel").lower()
    if content_type in ("reel", "video", "story"):
        return "video"
    if content_type in ("post", "carousel"):
        return "image"
    return None


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

    async def upsert_from_generation_job(self, job: GenerationJob) -> ContentPacket:
        """Create or update a calendar row for a completed studio job (P2.6)."""
        payload = dict(job.input_payload or {})
        job_id = str(job.id)
        result = await self.db.execute(
            select(ContentPacket).where(
                ContentPacket.metadata_json["generation_job_id"].as_string() == job_id
            )
        )
        packet = result.scalars().first()
        if not packet:
            packet = ContentPacket(
                type=str(payload.get("content_type") or payload.get("type") or "reel"),
                status="pending",
                metadata_json={"generation_job_id": job_id},
            )
            self.db.add(packet)

        packet.caption = payload.get("caption") or packet.caption
        packet.hashtags = payload.get("hashtags") or packet.hashtags or []
        packet.niche = str(payload.get("niche") or packet.niche or "lifestyle")
        packet.target_accounts = payload.get("target_accounts") or packet.target_accounts or []
        packet.visual_url = job.output_url or packet.visual_url
        packet.visual_type = _visual_type_for_job(payload)
        raw_template = payload.get("template_id")
        if raw_template:
            try:
                packet.template_id = UUID(str(raw_template))
            except (TypeError, ValueError):
                pass
        scheduled_raw = payload.get("scheduled_at")
        if scheduled_raw and not packet.scheduled_at:
            try:
                packet.scheduled_at = datetime.fromisoformat(str(scheduled_raw).replace("Z", "+00:00"))
            except ValueError:
                pass
        # content_packets.status CHECK allows pending|queued|publishing|published|failed|cancelled only.
        packet.status = "pending"
        meta = dict(packet.metadata_json or {})
        meta["generation_job_id"] = job_id
        meta["output_url"] = job.output_url
        packet.metadata_json = meta
        await self.db.flush()
        await self.db.refresh(packet)
        return packet
