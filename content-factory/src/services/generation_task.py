import uuid
import json
import asyncio
from typing import List, Optional
from datetime import datetime, timezone
import difflib

from fastapi import HTTPException
from src.core.database import AsyncSessionLocal
from src.core.config import settings
from src.core.redis import push_to_queue

from src.services.gemini_service import GeminiService
from src.services.kie_service import KieService
from src.services.content_service import ContentService
from src.models.content import ContentPacket as DBContentPacket
from src.api.content import ContentGenerateRequest, ContentPacket


async def check_duplication(caption: str, niche: str, db_session) -> bool:
    """Check if the given caption is too similar to existing recent packets in the same niche."""
    svc = ContentService(db_session)
    # Ideally only check the last 100 or so to save memory
    existing_packets = await svc.get_packets(limit=50) 
    
    for packet in existing_packets:
        if packet.niche == niche and packet.caption:
            similarity = difflib.SequenceMatcher(None, caption, packet.caption).ratio()
            if similarity > 0.8: # 80% similarity threshold
                return True
    return False


async def generate_single_content(request: ContentGenerateRequest, db_packet_id: uuid.UUID) -> None:
    """Background task to generate content and update the database."""
    async with AsyncSessionLocal() as db:
        svc = ContentService(db)
        packet = await svc.get_packet_by_id(str(db_packet_id))
        if not packet:
            return
            
        gemini = GeminiService()
        kie_svc = KieService()

        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                # 1. Text Generation
                variant_style = packet.metadata_json.get("variant_style") if packet.metadata_json else None
                generated_data = await gemini.generate_caption(request.niche, variant_style=variant_style)
                
                # Deduplication check
                is_duplicate = await check_duplication(generated_data["caption"], request.niche, db)
                if is_duplicate and attempt < max_attempts - 1:
                    continue # Try generating again
                
                # 2. Visual Generation via kie.ai (image or video based on content type)
                visual_url = None
                visual_type = "image"  # default
                if settings.KIE_API_KEY and settings.KIE_API_KEY not in ("",):
                    try:
                        visual_prompt = f"A high quality aesthetic instagram image for the '{request.niche}' niche. The topic matches: {generated_data['caption'][:50]}..."
                        if request.type == "reel":
                            visual_url = await kie_svc.generate_video(visual_prompt, duration=15)
                            visual_type = "video"
                        else:
                            # story → 9:16, post/carousel → 1:1
                            aspect_ratio = "9:16" if request.type == "story" else "1:1"
                            visual_url = await kie_svc.generate_image(visual_prompt, aspect_ratio=aspect_ratio)
                            visual_type = "image"
                    except Exception as img_err:
                        print(f"⚠️ kie.ai visual generation failed (non-blocking): {img_err}")
                        visual_url = None
                else:
                    print("ℹ️ KIE_API_KEY not configured — skipping visual generation")
                
                # Update Packet
                packet.caption = generated_data["caption"]
                packet.hashtags = generated_data["hashtags"]
                packet.visual_url = visual_url
                packet.visual_type = visual_type
                packet.status = "queued" # ready for distribution
                
                await db.commit()
                await db.refresh(packet)
                
                # 3. Push to Redis distribution queue
                export_data = ContentPacket(
                    id=str(packet.id),
                    type=packet.type,
                    caption=packet.caption,
                    visual_url=packet.visual_url,
                    visual_type=packet.visual_type,
                    hashtags=packet.hashtags,
                    target_accounts=packet.target_accounts,
                    scheduled_at=packet.scheduled_at.isoformat() if packet.scheduled_at else datetime.now(timezone.utc).isoformat(),
                    niche=packet.niche,
                    status=packet.status,
                    metadata=packet.metadata_json,
                    created_at=packet.created_at.isoformat() if packet.created_at else datetime.now(timezone.utc).isoformat()
                )
                await push_to_queue(
                    settings.CONTENT_QUEUE_NAME,
                    json.dumps(export_data.model_dump())
                )
                break
                
            except Exception as e:
                if attempt == max_attempts - 1:
                    packet.status = "failed"
                    await db.commit()


async def generate_bulk_content_task(requests: List[ContentGenerateRequest], db_packet_ids: List[uuid.UUID]):
    """Run multiple single generation tasks concurrently."""
    tasks = [generate_single_content(req, pid) for req, pid in zip(requests, db_packet_ids)]
    await asyncio.gather(*tasks)
