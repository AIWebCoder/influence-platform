import uuid
import json
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from src.core.redis import push_to_queue
from src.core.config import settings
from src.core.database import get_db
from src.core.access_scope import (
    AccessScope,
    assert_account_access,
    assert_content_packet_access,
    filter_content_packets_for_scope,
    get_access_scope,
)
from src.api.deps_scope import require_write_access
from sqlalchemy.ext.asyncio import AsyncSession
from src.services.content_service import ContentService
from src.services.gemini_service import GeminiService
from src.models.content import ContentPacket as DBContentPacket

router = APIRouter()
logger = logging.getLogger(__name__)


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


class CaptionGenerateRequest(BaseModel):
    niche: str
    topic: Optional[str] = None
    content_type: Optional[str] = None
    variant_style: Optional[str] = None


class CaptionGenerateResponse(BaseModel):
    caption: str
    hashtags: list[str]


def _prefer_anthropic_for_caption() -> bool:
    if str(getattr(settings, "TEXT_PROVIDER_PRIMARY", "gemini")).strip().lower() == "anthropic":
        return bool((settings.resolved_anthropic_api_key() or "").strip())
    if (settings.GEMINI_API_KEY or "").strip():
        return False
    return bool((settings.resolved_anthropic_api_key() or "").strip())


@router.post("/generate", response_model=ContentPacket)
async def generate_content(
    request: ContentGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """
    Génère un packet de contenu via IA (Claude + DALL-E) en arrière-plan.

    Deprecated for new integrations: prefer `POST /generation-jobs` for orchestrated,
    step-tracked generation with scene-level retries.
    """
    for account_id in request.target_accounts:
        await assert_account_access(db, scope, account_id)

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


@router.post("/caption/generate", response_model=CaptionGenerateResponse)
async def generate_caption_for_publish(request: CaptionGenerateRequest):
    """Generate caption + hashtags for manual publish flows (dashboard, tools)."""
    from src.services.anthropic_service import AnthropicService

    use_anthropic = _prefer_anthropic_for_caption()
    if use_anthropic and not (settings.resolved_anthropic_api_key() or "").strip():
        raise HTTPException(
            status_code=503,
            detail="Anthropic API key is not configured (set ANTHROPIC_API_KEY or CLAUDE_API_KEY).",
        )
    if not use_anthropic and not (settings.GEMINI_API_KEY or "").strip():
        raise HTTPException(
            status_code=503,
            detail="Gemini API key is not configured (set GEMINI_API_KEY) or enable Anthropic as TEXT_PROVIDER_PRIMARY.",
        )

    niche = (request.niche or "").strip() or "lifestyle"
    topic_raw = (request.topic or "").strip()
    topic = topic_raw or None
    content_type = (request.content_type or "").strip() or None
    try:
        if use_anthropic:
            svc = AnthropicService()
            result = await svc.generate_caption(
                niche,
                variant_style=request.variant_style,
                topic=topic,
                content_type=content_type,
            )
        else:
            svc = GeminiService()
            result = await svc.generate_caption(
                niche,
                variant_style=request.variant_style,
                topic=topic,
                content_type=content_type,
                trace={"step": "caption_generate_api"},
            )
    except Exception as e:
        logger.exception("caption_generate_failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    caption = result.get("caption")
    hashtags_raw = result.get("hashtags")
    if not isinstance(caption, str) or not isinstance(hashtags_raw, list):
        raise HTTPException(status_code=502, detail="Invalid model response shape")
    hashtags = [str(h).lstrip("#").strip() for h in hashtags_raw if str(h).strip()]
    return CaptionGenerateResponse(caption=caption.strip(), hashtags=hashtags)


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
async def list_contents(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    """Liste tous les contenus"""
    service = ContentService(db)
    db_packets = await filter_content_packets_for_scope(
        db, await service.get_packets(skip=skip, limit=limit), scope
    )
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
async def get_content(
    content_id: str,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(get_access_scope),
):
    """Récupère un packet de contenu par son ID"""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
    await assert_content_packet_access(db, scope, p)

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
async def update_content(
    content_id: str,
    request: ContentGenerateRequest,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """Met à jour un packet de contenu"""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
    await assert_content_packet_access(db, scope, p)
    for account_id in request.target_accounts:
        await assert_account_access(db, scope, account_id)

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
async def patch_content(
    content_id: str,
    request: ContentEditRequest,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """Patch caption and/or hashtags on a content packet (lightweight edit)."""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
    await assert_content_packet_access(db, scope, p)

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
async def delete_content(
    content_id: str,
    db: AsyncSession = Depends(get_db),
    scope: AccessScope = Depends(require_write_access),
):
    """Supprime un packet de contenu"""
    service = ContentService(db)
    p = await service.get_packet_by_id(content_id)
    if not p:
        raise HTTPException(status_code=404, detail="Content not found")
    await assert_content_packet_access(db, scope, p)
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

