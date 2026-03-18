from typing import Dict, List, Optional, Any
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class ABTestEngine:
    """A/B testing framework for content optimization."""
    
    @staticmethod
    def calculate_engagement_score(likes: int, comments: int, shares: int, saves: int) -> int:
        """Calculate weighted engagement score."""
        return likes + (comments * 2) + (shares * 3) + (saves * 2)
    
    @staticmethod
    def determine_category(score: int, median: float) -> str:
        """Determine performance category based on score vs median."""
        if score >= median * 1.5:
            return "top"
        elif score >= median * 0.7:
            return "average"
        else:
            return "poor"
    
    @staticmethod
    async def record_variant_performance(
        content_packet_id: str,
        variant: str,
        caption_text: str,
        likes: int = 0,
        comments: int = 0,
        shares: int = 0,
        saves: int = 0,
    ):
        """Record performance metrics for a variant."""
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        engagement_score = ABTestEngine.calculate_engagement_score(likes, comments, shares, saves)
        
        async with AsyncSessionLocal() as session:
            await session.execute(
                text("""
                    INSERT INTO caption_performance 
                    (content_packet_id, variant, caption_text, engagement_score, posted_at)
                    VALUES (:packet_id, :variant, :caption, :score, NOW())
                """),
                {
                    "packet_id": content_packet_id,
                    "variant": variant,
                    "caption": caption_text[:500],  # Truncate for storage
                    "score": engagement_score,
                }
            )
            await session.commit()
        
        logger.info(f"Recorded A/B variant {variant} performance: {engagement_score}")
    
    @staticmethod
    async def get_top_performing_captions(limit: int = 10) -> List[Dict]:
        """Get top performing captions for analysis."""
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text("""
                    SELECT variant, caption_text, engagement_score, posted_at
                    FROM caption_performance
                    WHERE performance_category = 'top'
                    ORDER BY engagement_score DESC
                    LIMIT :limit
                """),
                {"limit": limit}
            )
            rows = result.fetchall()
        
        return [
            {
                "variant": row.variant,
                "caption": row.caption_text,
                "score": row.engagement_score,
                "posted_at": row.posted_at.isoformat() if row.posted_at else None,
            }
            for row in rows
        ]
    
    @staticmethod
    async def analyze_variant_performance() -> Dict[str, Any]:
        """Analyze A/B test results and return insights."""
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        async with AsyncSessionLocal() as session:
            # Get average scores by variant
            result = await session.execute(
                text("""
                    SELECT 
                        variant,
                        COUNT(*) as sample_size,
                        AVG(engagement_score) as avg_score,
                        MAX(engagement_score) as max_score,
                        MIN(engagement_score) as min_score
                    FROM caption_performance
                    WHERE engagement_score IS NOT NULL
                    GROUP BY variant
                """)
            )
            rows = result.fetchall()
            
            variant_stats = {}
            for row in rows:
                variant_stats[row.variant] = {
                    "sample_size": row.sample_size,
                    "avg_score": float(row.avg_score) if row.avg_score else 0,
                    "max_score": row.max_score,
                    "min_score": row.min_score,
                }
            
            # Get top-performing caption characteristics
            top_result = await session.execute(
                text("""
                    SELECT caption_text
                    FROM caption_performance
                    WHERE performance_category = 'top'
                    ORDER BY engagement_score DESC
                    LIMIT 5
                """)
            )
            top_captions = [row.caption_text for row in top_result.fetchall()]
        
        return {
            "variant_stats": variant_stats,
            "top_captions": top_captions,
            "recommendation": ABTestEngine._generate_recommendation(variant_stats),
        }
    
    @staticmethod
    def _generate_recommendation(variant_stats: Dict) -> str:
        """Generate recommendation based on A/B test data."""
        if not variant_stats:
            return "Not enough data to generate recommendations yet."
        
        a_stats = variant_stats.get("A", {"avg_score": 0})
        b_stats = variant_stats.get("B", {"avg_score": 0})
        
        if a_stats["avg_score"] > b_stats["avg_score"] * 1.2:
            return "Variant A is performing significantly better. Consider using Variant A style captions."
        elif b_stats["avg_score"] > a_stats["avg_score"] * 1.2:
            return "Variant B is performing significantly better. Consider using Variant B style captions."
        else:
            return "Both variants perform similarly. Continue testing to gather more data."
    
    @staticmethod
    async def get_content_type_performance() -> Dict[str, Any]:
        """Analyze performance by content type (post, story, reel, carousel)."""
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text("""
                    SELECT 
                        cp.type as content_type,
                        COUNT(*) as count,
                        AVG(pm.engagement_score) as avg_engagement,
                        SUM(pm.likes) as total_likes,
                        SUM(pm.comments) as total_comments,
                        SUM(pm.saves) as total_saves
                    FROM caption_performance cp
                    LEFT JOIN post_metrics pm ON cp.content_packet_id = pm.content_packet_id
                    GROUP BY cp.type
                """)
            )
            rows = result.fetchall()
        
        return {
            row.content_type: {
                "count": row.count,
                "avg_engagement": float(row.avg_engagement) if row.avg_engagement else 0,
                "total_likes": row.total_likes or 0,
                "total_comments": row.total_comments or 0,
                "total_saves": row.total_saves or 0,
            }
            for row in rows
        }
