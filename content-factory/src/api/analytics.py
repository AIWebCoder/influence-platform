from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional, List
from datetime import datetime, timedelta

from src.core.database import get_db
from src.core.security import get_current_user

router = APIRouter()


class EngagementEvent(BaseModel):
    content_id: str
    niche: str
    content_type: str
    posting_hour: int
    likes: int = 0
    comments: int = 0
    shares: int = 0
    saves: int = 0


class PostMetricsRecord(BaseModel):
    content_packet_id: str
    account_id: str
    instagram_post_id: Optional[str] = None
    likes_count: int = 0
    comments_count: int = 0
    shares_count: int = 0
    saves_count: int = 0
    reach_estimate: Optional[int] = None
    impressions: Optional[int] = None


class ProxyPerformanceRecord(BaseModel):
    proxy_id: str
    response_time_ms: int
    success: bool = True
    error_message: Optional[str] = None
    request_type: str


class CaptionPerformanceRecord(BaseModel):
    content_packet_id: str
    caption_text: str
    variant: str
    total_likes: int = 0
    total_comments: int = 0


class ABTestCreate(BaseModel):
    name: str
    niche: Optional[str] = None
    variant_a_config: dict
    variant_b_config: dict


class ABTestUpdate(BaseModel):
    status: Optional[str] = None
    winner: Optional[str] = None


class CaptionScoreRequest(BaseModel):
    caption: str
    hashtags: Optional[List[str]] = None


@router.post("/caption/score")
async def score_caption_api(
    request: CaptionScoreRequest,
    _user: dict = Depends(get_current_user),
):
    """Score a caption and return detailed breakdown."""
    from src.services.captionScorer import score_caption
    return score_caption(request.caption, request.hashtags)


@router.post("/post-metrics")
async def record_post_metrics(
    metrics: PostMetricsRecord,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Record post engagement metrics."""
    await db.execute(
        text("""
            INSERT INTO post_metrics 
                (content_packet_id, account_id, instagram_post_id, likes_count, 
                 comments_count, shares_count, saves_count, reach_estimate, impressions)
            VALUES 
                (:content_packet_id, :account_id, :instagram_post_id, :likes_count,
                 :comments_count, :shares_count, :saves_count, :reach_estimate, :impressions)
        """),
        {
            "content_packet_id": metrics.content_packet_id,
            "account_id": metrics.account_id,
            "instagram_post_id": metrics.instagram_post_id,
            "likes_count": metrics.likes_count,
            "comments_count": metrics.comments_count,
            "shares_count": metrics.shares_count,
            "saves_count": metrics.saves_count,
            "reach_estimate": metrics.reach_estimate,
            "impressions": metrics.impressions,
        },
    )
    await db.commit()
    return {"message": "Post metrics recorded"}


@router.get("/post-metrics/{content_packet_id}")
async def get_post_metrics(
    content_packet_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get metrics for a specific post."""
    result = await db.execute(
        text("""
            SELECT * FROM post_metrics 
            WHERE content_packet_id = :content_packet_id
            ORDER BY recorded_at DESC
            LIMIT 1
        """),
        {"content_packet_id": content_packet_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No metrics found for this post")
    return {
        "content_packet_id": str(row.content_packet_id),
        "likes_count": row.likes_count,
        "comments_count": row.comments_count,
        "shares_count": row.shares_count,
        "saves_count": row.saves_count,
        "reach_estimate": row.reach_estimate,
        "impressions": row.impressions,
        "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
    }


@router.get("/post-metrics/aggregate/by-niche")
async def get_post_metrics_by_niche(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get aggregated post metrics by niche."""
    result = await db.execute(
        text("""
            SELECT 
                cp.niche,
                COUNT(pm.id) as total_posts,
                SUM(pm.likes_count) as total_likes,
                SUM(pm.comments_count) as total_comments,
                SUM(pm.shares_count) as total_shares,
                SUM(pm.saves_count) as total_saves,
                AVG(pm.engagement_rate) as avg_engagement_rate
            FROM post_metrics pm
            JOIN content_packets cp ON pm.content_packet_id = cp.id
            WHERE pm.recorded_at >= :start_date
            GROUP BY cp.niche
            ORDER BY total_likes DESC
        """),
        {"start_date": datetime.utcnow() - timedelta(days=days)},
    )
    rows = result.fetchall()
    return {
        "period_days": days,
        "niches": [
            {
                "niche": row.niche,
                "total_posts": row.total_posts,
                "total_likes": int(row.total_likes or 0),
                "total_comments": int(row.total_comments or 0),
                "total_shares": int(row.shares_count or 0),
                "total_saves": int(row.saves_count or 0),
                "avg_engagement_rate": float(row.avg_engagement_rate or 0),
            }
            for row in rows
        ],
    }


@router.post("/proxy-performance")
async def record_proxy_performance(
    record: ProxyPerformanceRecord,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Record proxy performance metrics."""
    await db.execute(
        text("""
            INSERT INTO proxy_performance 
                (proxy_id, response_time_ms, success, error_message, request_type)
            VALUES 
                (:proxy_id, :response_time_ms, :success, :error_message, :request_type)
        """),
        {
            "proxy_id": record.proxy_id,
            "response_time_ms": record.response_time_ms,
            "success": record.success,
            "error_message": record.error_message,
            "request_type": record.request_type,
        },
    )
    await db.commit()
    return {"message": "Proxy performance recorded"}


@router.get("/proxy-performance/summary")
async def get_proxy_performance_summary(
    hours: int = 24,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get proxy performance summary."""
    result = await db.execute(
        text("""
            SELECT 
                p.id,
                p.host,
                p.port,
                COUNT(pp.id) as total_requests,
                SUM(CASE WHEN pp.success THEN 1 ELSE 0 END) as successful_requests,
                AVG(pp.response_time_ms) as avg_response_time,
                MAX(pp.created_at) as last_request
            FROM proxies p
            LEFT JOIN proxy_perference pp ON p.id = pp.proxy_id
                AND pp.created_at >= :start_time
            GROUP BY p.id, p.host, p.port
            ORDER BY avg_response_time ASC
        """),
        {"start_time": datetime.utcnow() - timedelta(hours=hours)},
    )
    rows = result.fetchall()
    return {
        "period_hours": hours,
        "proxies": [
            {
                "proxy_id": str(row.id),
                "host": row.host,
                "port": row.port,
                "total_requests": row.total_requests,
                "success_rate": float(row.successful_requests / row.total_requests * 100) if row.total_requests > 0 else 0,
                "avg_response_time_ms": float(row.avg_response_time or 0),
                "last_request": row.last_request.isoformat() if row.last_request else None,
            }
            for row in rows
        ],
    }


@router.post("/caption-performance")
async def record_caption_performance(
    record: CaptionPerformanceRecord,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Record caption A/B test performance."""
    total_engagement = record.total_likes + record.total_comments
    await db.execute(
        text("""
            INSERT INTO caption_performance 
                (content_packet_id, caption_text, variant, total_likes, total_comments, total_engagement)
            VALUES 
                (:content_packet_id, :caption_text, :variant, :total_likes, :total_comments, :total_engagement)
        """),
        {
            "content_packet_id": record.content_packet_id,
            "caption_text": record.caption_text[:500],
            "variant": record.variant,
            "total_likes": record.total_likes,
            "total_comments": record.total_comments,
            "total_engagement": total_engagement,
        },
    )
    await db.commit()
    return {"message": "Caption performance recorded"}


@router.get("/caption-performance/leaderboard")
async def get_caption_leaderboard(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get top performing captions."""
    result = await db.execute(
        text("""
            SELECT 
                cp.id,
                cp.caption_text,
                cp.variant,
                SUM(cp.total_likes) as total_likes,
                SUM(cp.total_comments) as total_comments,
                SUM(cp.total_engagement) as total_engagement
            FROM caption_performance cp
            GROUP BY cp.id, cp.caption_text, cp.variant
            ORDER BY total_engagement DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    rows = result.fetchall()
    return {
        "leaderboard": [
            {
                "content_packet_id": str(row.id),
                "caption_preview": (row.caption_text or "")[:100] + "...",
                "variant": row.variant,
                "total_likes": row.total_likes,
                "total_comments": row.total_comments,
                "total_engagement": row.total_engagement,
            }
            for row in rows
        ],
    }


@router.get("/ab-tests")
async def list_ab_tests(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """List all A/B tests."""
    query = "SELECT * FROM ab_tests"
    params = {}
    if status:
        query += " WHERE status = :status"
        params["status"] = status
    query += " ORDER BY started_at DESC"
    
    result = await db.execute(text(query), params)
    rows = result.fetchall()
    return {
        "ab_tests": [
            {
                "id": str(row.id),
                "name": row.name,
                "niche": row.niche,
                "status": row.status,
                "winner": row.winner,
                "started_at": row.started_at.isoformat() if row.started_at else None,
                "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            }
            for row in rows
        ],
    }


@router.post("/ab-tests")
async def create_ab_test(
    test: ABTestCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Create a new A/B test."""
    result = await db.execute(
        text("""
            INSERT INTO ab_tests (name, niche, variant_a_config, variant_b_config)
            VALUES (:name, :niche, :variant_a_config, :variant_b_config)
            RETURNING id
        """),
        {
            "name": test.name,
            "niche": test.niche,
            "variant_a_config": test.variant_a_config,
            "variant_b_config": test.variant_b_config,
        },
    )
    row = result.fetchone()
    await db.commit()
    return {"id": str(row.id), "message": "A/B test created"}


@router.get("/ab-tests/{test_id}")
async def get_ab_test(
    test_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get A/B test details with variant performance."""
    result = await db.execute(
        text("""
            SELECT * FROM ab_tests WHERE id = :test_id
        """),
        {"test_id": test_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="A/B test not found")
    
    variant_a_result = await db.execute(
        text("""
            SELECT 
                SUM(total_likes) as likes,
                SUM(total_comments) as comments,
                SUM(total_engagement) as engagement
            FROM caption_performance 
            WHERE content_packet_id IN (
                SELECT id FROM content_packets WHERE variant = 'A'
            )
        """),
    )
    variant_b_result = await db.execute(
        text("""
            SELECT 
                SUM(total_likes) as likes,
                SUM(total_comments) as comments,
                SUM(total_engagement) as engagement
            FROM caption_performance 
            WHERE content_packet_id IN (
                SELECT id FROM content_packets WHERE variant = 'B'
            )
        """),
    )
    
    return {
        "id": str(row.id),
        "name": row.name,
        "niche": row.niche,
        "status": row.status,
        "winner": row.winner,
        "variant_a": {
            "config": row.variant_a_config,
        },
        "variant_b": {
            "config": row.variant_b_config,
        },
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


@router.patch("/ab-tests/{test_id}")
async def update_ab_test(
    test_id: str,
    update: ABTestUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Update A/B test status or winner."""
    updates = []
    params = {"test_id": test_id}
    
    if update.status:
        updates.append("status = :status")
        params["status"] = update.status
        if update.status == "completed":
            updates.append("completed_at = NOW()")
    
    if update.winner:
        updates.append("winner = :winner")
        params["winner"] = update.winner
    
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    
    query = f"UPDATE ab_tests SET {', '.join(updates)} WHERE id = :test_id"
    await db.execute(text(query), params)
    await db.commit()
    
    return {"message": "A/B test updated"}


@router.get("/engagement/trends")
async def get_engagement_trends(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get engagement trends over time."""
    result = await db.execute(
        text("""
            SELECT 
                DATE(created_at) as date,
                SUM(likes) as likes,
                SUM(comments) as comments,
                SUM(shares) as shares,
                SUM(saves) as saves
            FROM analytics_events
            WHERE created_at >= :start_date
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        """),
        {"start_date": datetime.utcnow() - timedelta(days=days)},
    )
    rows = result.fetchall()
    return {
        "period_days": days,
        "trends": [
            {
                "date": row.date.isoformat() if row.date else None,
                "likes": int(row.likes or 0),
                "comments": int(row.comments or 0),
                "shares": int(row.shares or 0),
                "saves": int(row.saves or 0),
            }
            for row in rows
        ],
    }


@router.post("/ingest")
async def ingest_event(
    event: EngagementEvent,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Record an engagement event for analytics."""
    await db.execute(
        text("""
            INSERT INTO analytics_events 
                (content_id, niche, content_type, posting_hour, likes, comments, shares, saves)
            VALUES 
                (:content_id, :niche, :content_type, :posting_hour, :likes, :comments, :shares, :saves)
        """),
        {
            "content_id": event.content_id,
            "niche": event.niche,
            "content_type": event.content_type,
            "posting_hour": event.posting_hour,
            "likes": event.likes,
            "comments": event.comments,
            "shares": event.shares,
            "saves": event.saves,
        },
    )
    return {"message": "Event recorded"}


@router.get("/recommendations")
async def get_recommendations(
    niche: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """
    Get top 3 (content_type, posting_hour) combos for a niche.
    Scoring: 1*likes + 3*comments + 5*shares + 2*saves
    """
    result = await db.execute(
        text("""
            SELECT 
                content_type,
                posting_hour,
                SUM(likes + 3*comments + 5*shares + 2*saves) as engagement_score,
                COUNT(*) as sample_size
            FROM analytics_events
            WHERE niche = :niche
            GROUP BY content_type, posting_hour
            HAVING COUNT(*) >= 3
            ORDER BY engagement_score DESC
            LIMIT 3
        """),
        {"niche": niche},
    )
    rows = result.fetchall()

    if not rows:
        return {
            "niche": niche,
            "recommendations": [],
            "message": "Not enough data yet. Need at least 3 events per combo.",
        }

    return {
        "niche": niche,
        "recommendations": [
            {
                "content_type": row.content_type,
                "posting_hour": row.posting_hour,
                "engagement_score": float(row.engagement_score),
                "sample_size": row.sample_size,
            }
            for row in rows
        ],
    }


@router.get("/overview")
async def analytics_overview(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get a high-level analytics overview."""
    result = await db.execute(
        text("""
            SELECT 
                niche,
                COUNT(*) as events,
                SUM(likes) as total_likes,
                SUM(comments) as total_comments,
                SUM(shares) as total_shares,
                SUM(saves) as total_saves
            FROM analytics_events
            GROUP BY niche
            ORDER BY SUM(likes + 3*comments + 5*shares + 2*saves) DESC
        """)
    )
    rows = result.fetchall()

    return {
        "niches": [
            {
                "niche": row.niche,
                "events": row.events,
                "total_likes": int(row.total_likes or 0),
                "total_comments": int(row.total_comments or 0),
                "total_shares": int(row.total_shares or 0),
                "total_saves": int(row.total_saves or 0),
            }
            for row in rows
        ],
    }
