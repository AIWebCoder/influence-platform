import uuid
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from src.core.redis import push_to_queue
from src.core.config import settings
from src.core.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from src.services.content_service import ContentService
from src.services.gemini_service import GeminiService
from src.services.openai_service import OpenAIService
from src.models.content import ContentPacket as DBContentPacket

router = APIRouter()


# ─────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────

class ContentGenerateRequest(BaseModel):
    niche: str
    type: str = "post"
    target_accounts: list[str]
    scheduled_at: Optional[str] = None
    template_id: Optional[str] = None
    campaign_id: Optional[str] = None


class ContentPacket(BaseModel):
    id: str
    type: str
    caption: str
    visual_url: Optional[str] = None
    visual_type: Optional[str] = None
    hashtags: list[str]
    target_accounts: list[str]
    scheduled_at: str
    niche: str
    status: str
    metadata: dict
    created_at: str


# ─────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────

from fastapi import BackgroundTasks

class BulkGenerateRequest(BaseModel):
    niche: str
    type: str = "post"
    target_accounts: list[str]
    count: int = 1

@router.post("/generate", response_model=ContentPacket)
async def generate_content(
    request: ContentGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Génère un packet de contenu via IA (Claude + DALL-E) en arrière-plan.

    Deprecated for new integrations: prefer `POST /generation-jobs` for orchestrated,
    step-tracked generation with scene-level retries.
    """
    from src.services.generation_task import generate_single_content
    
    packet_id = str(uuid.uuid4())
    metadata = {
        "template_id": request.template_id,
        "campaign_id": request.campaign_id,
        "variant": "original"
    }
    
    # Save pending to Database
    db_packet = DBContentPacket(
        id=packet_id,
        type=request.type,
        caption="Generation in progress...",
        visual_url=None,
        hashtags=[],
        target_accounts=request.target_accounts,
        scheduled_at=datetime.fromisoformat(request.scheduled_at) if request.scheduled_at else None,
        niche=request.niche,
        status="pending",
        metadata_json=metadata,
        template_id=request.template_id
    )
    
    service = ContentService(db)
    await service.create_packet(db_packet)

    background_tasks.add_task(generate_single_content, request, db_packet.id)

    return ContentPacket(
        id=str(db_packet.id),
        type=db_packet.type,
        caption=db_packet.caption,
        visual_url="",
        hashtags=[],
        target_accounts=db_packet.target_accounts,
        scheduled_at=db_packet.scheduled_at.isoformat() if db_packet.scheduled_at else datetime.now(timezone.utc).isoformat(),
        niche=db_packet.niche,
        status=db_packet.status,
        metadata=db_packet.metadata_json,
        created_at=db_packet.created_at.isoformat() if db_packet.created_at else datetime.now(timezone.utc).isoformat()
    )


@router.post("/generate/bulk", response_model=list[ContentPacket])
async def generate_bulk_content(
    request: BulkGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    from src.services.generation_task import generate_bulk_content_task
    
    service = ContentService(db)
    packets = []
    packet_ids = []
    requests = []
    
    for _ in range(request.count):
        packet_id = str(uuid.uuid4())
        db_packet = DBContentPacket(
            id=packet_id,
            type=request.type,
            caption="Generation in progress...",
            target_accounts=request.target_accounts,
            niche=request.niche,
            status="pending",
            metadata_json={}
        )
        await service.create_packet(db_packet)
        packets.append({
            "id": str(db_packet.id),
            "type": db_packet.type,
            "caption": db_packet.caption,
            "hashtags": [],
            "target_accounts": db_packet.target_accounts,
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
            "niche": db_packet.niche,
            "status": db_packet.status,
            "metadata": {},
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        packet_ids.append(db_packet.id)
        
        # Build individual request for task
        task_req = ContentGenerateRequest(
            niche=request.niche,
            type=request.type,
            target_accounts=request.target_accounts
        )
        requests.append(task_req)
        
    background_tasks.add_task(generate_bulk_content_task, requests, packet_ids)
    
    return packets

@router.post("/generate/ab-test", response_model=list[ContentPacket])
async def generate_ab_test(
    request: ContentGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Génère deux variantes (A et B) avec des styles distincts."""
    from src.services.generation_task import generate_single_content
    service = ContentService(db)
    packets = []
    
    campaign_id = request.campaign_id or str(uuid.uuid4())
    variants = [
        {"v": "A", "style": "educational and informative"},
        {"v": "B", "style": "engaging with a strong hook and promotional tone"}
    ]
    
    for var in variants:
        variant_code = var["v"]
        variant_style = var["style"]
        
        db_packet = DBContentPacket(
            id=str(uuid.uuid4()),
            type=request.type,
            caption=f"Generation in progress (Variant {variant_code}: {variant_style})...",
            target_accounts=request.target_accounts,
            niche=request.niche,
            status="pending",
            metadata_json={
                "campaign_id": campaign_id, 
                "variant": variant_code,
                "variant_style": variant_style
            }
        )
        await service.create_packet(db_packet)
        packets.append({
            "id": str(db_packet.id),
            "type": db_packet.type,
            "caption": db_packet.caption,
            "hashtags": [],
            "target_accounts": db_packet.target_accounts,
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
            "niche": db_packet.niche,
            "status": db_packet.status,
            "metadata": db_packet.metadata_json,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        background_tasks.add_task(generate_single_content, request, db_packet.id)
        
    return packets


@router.get("/queue/size")
async def get_queue_size():
    """Retourne le nombre de contenus en attente de publication"""
    from src.core.redis import get_redis
    redis = await get_redis()
    size = await redis.llen(settings.CONTENT_QUEUE_NAME)
    return {"queue": settings.CONTENT_QUEUE_NAME, "size": size}


@router.get("", response_model=list[ContentPacket])
async def list_contents(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    """Liste tous les contenus"""
    service = ContentService(db)
    db_packets = await service.get_packets(skip=skip, limit=limit)
    return [
        ContentPacket(
            id=str(p.id),
            type=p.type,
            caption=p.caption,
            visual_url=p.visual_url,
            visual_type=p.visual_type,
            hashtags=p.hashtags,
            target_accounts=p.target_accounts,
            scheduled_at=p.scheduled_at.isoformat() if p.scheduled_at else "",
            niche=p.niche,
            status=p.status,
            metadata=p.metadata_json,
            created_at=p.created_at.isoformat() if p.created_at else ""
        ) for p in db_packets
    ]


@router.get("/{content_id}", response_model=ContentPacket)
async def get_content(content_id: str, db: AsyncSession = Depends(get_db)):
    """Récupère un packet de contenu par son ID"""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
        
    return ContentPacket(
        id=str(p.id),
        type=p.type,
        caption=p.caption,
        visual_url=p.visual_url,
        visual_type=p.visual_type,
        hashtags=p.hashtags,
        target_accounts=p.target_accounts,
        scheduled_at=p.scheduled_at.isoformat() if p.scheduled_at else "",
        niche=p.niche,
        status=p.status,
        metadata=p.metadata_json,
        created_at=p.created_at.isoformat() if p.created_at else ""
    )


@router.put("/{content_id}", response_model=ContentPacket)
async def update_content(content_id: str, request: ContentGenerateRequest, db: AsyncSession = Depends(get_db)):
    """Met à jour un packet de contenu"""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
        
    p.niche = request.niche
    p.type = request.type
    p.target_accounts = request.target_accounts
    if request.scheduled_at:
        p.scheduled_at = datetime.fromisoformat(request.scheduled_at)
    if request.template_id:
        p.template_id = request.template_id
        
    p = await service.update_packet(p)
    return ContentPacket(
        id=str(p.id),
        type=p.type,
        caption=p.caption,
        visual_url=p.visual_url,
        visual_type=p.visual_type,
        hashtags=p.hashtags,
        target_accounts=p.target_accounts,
        scheduled_at=p.scheduled_at.isoformat() if p.scheduled_at else "",
        niche=p.niche,
        status=p.status,
        metadata=p.metadata_json,
        created_at=p.created_at.isoformat() if p.created_at else ""
    )


class ContentEditRequest(BaseModel):
    caption: Optional[str] = None
    hashtags: Optional[list[str]] = None


@router.patch("/{content_id}", response_model=ContentPacket)
async def patch_content(content_id: str, request: ContentEditRequest, db: AsyncSession = Depends(get_db)):
    """Patch caption and/or hashtags on a content packet (lightweight edit)."""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")

    if request.caption is not None:
        p.caption = request.caption
    if request.hashtags is not None:
        p.hashtags = request.hashtags

    p = await service.update_packet(p)
    return ContentPacket(
        id=str(p.id),
        type=p.type,
        caption=p.caption,
        visual_url=p.visual_url,
        visual_type=p.visual_type,
        hashtags=p.hashtags,
        target_accounts=p.target_accounts,
        scheduled_at=p.scheduled_at.isoformat() if p.scheduled_at else "",
        niche=p.niche,
        status=p.status,
        metadata=p.metadata_json,
        created_at=p.created_at.isoformat() if p.created_at else ""
    )


@router.delete("/{content_id}")
async def delete_content(content_id: str, db: AsyncSession = Depends(get_db)):
    """Supprime un packet de contenu"""
    service = ContentService(db)
    success = await service.delete_packet(content_id)
    if not success:
        raise HTTPException(status_code=404, detail="Content not found")
    return {"message": "Content deleted successfully"}


class EngagementRequest(BaseModel):
    likes: int = 0
    comments: int = 0
    shares: int = 0


@router.post("/{content_id}/engagement")
async def log_engagement(content_id: str, request: EngagementRequest, db: AsyncSession = Depends(get_db)):
    """
    Log engagement metrics for a published content packet.
    Computes engagement_score = likes + (comments * 2) + (shares * 3)
    and updates the linked publication record.
    """
    from sqlalchemy import text

    engagement_score = request.likes + (request.comments * 2) + (request.shares * 3)

    # Update the publication(s) linked to this content packet
    result = await db.execute(
        text(
            "UPDATE publications SET engagement_score = :score WHERE content_packet_id = :cid RETURNING id"
        ),
        {"score": engagement_score, "cid": content_id},
    )
    rows = result.fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="No publications found for this content")

    await db.commit()

    return {
        "content_id": content_id,
        "engagement_score": engagement_score,
        "likes": request.likes,
        "comments": request.comments,
        "shares": request.shares,
        "publications_updated": len(rows),
    }

