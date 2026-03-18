from typing import Dict, List, Optional
import logging
from collections import Counter

logger = logging.getLogger(__name__)


class TrendingDetector:
    """Detect trending hashtags per niche based on performance."""
    
    # Niche-specific hashtag groups
    NICHE_HASHTAG_GROUPS = {
        "fitness": {
            "trending": ["fitnessmotivation", "gymlife", "workoutmotivation", "fitfam", "bodybuilding", "fitnessjourney", "gains", "training"],
            "seasonal": ["newyearfitness", "summerbody", "mondaymotivation", "transformationtuesday"],
        },
        "food": {
            "trending": ["foodie", "foodstagram", "instafood", "delicious", "yummy", "foodporn", "homemade", "recipe"],
            "seasonal": ["comfortfood", "holidayrecipes", "summerrecipes", "healthyholidays"],
        },
        "travel": {
            "trending": ["wanderlust", "travelgram", "travelphotography", "adventure", "exploremore", "vacation", "travelblogger", "bucketlist"],
            "seasonal": ["springtravel", "summervibes", "falltravel", "wintergetaway"],
        },
        "business": {
            "trending": ["entrepreneur", "successmindset", "businessowner", "motivation", "success", "hustle", "mindset", "leadership"],
            "seasonal": ["newyearnewgoals", "quarterlygoals", "yearinreview"],
        },
        "lifestyle": {
            "trending": ["lifestyle", "lifestyleblogger", "dailylife", "goodvibes", "positivevibes", "grateful", "blessed", "goals"],
            "seasonal": ["newyearnewme", "seasonchange", "weekendvibes"],
        },
    }
    
    @staticmethod
    async def get_trending_for_niche(niche: str, limit: int = 10) -> Dict:
        """
        Get trending hashtags for a niche.
        
        Returns:
            {
                "niche": "fitness",
                "trending": ["#gymlife", "#workoutmotivation"],
                "recommended_count": 5,
                "sources": ["performance", "trending", "seasonal"]
            }
        """
        niche = niche.lower()
        groups = TrendingDetector.NICHE_HASHTAG_GROUPS.get(niche, {})
        
        all_tags = []
        sources = []
        
        # Get trending from predefined groups
        if "trending" in groups:
            all_tags.extend(groups["trending"])
            sources.append("trending")
        
        # Add seasonal if applicable
        if "seasonal" in groups:
            all_tags.extend(groups["seasonal"])
            sources.append("seasonal")
        
        # Analyze performance from database
        perf_tags = await TrendingDetector._get_top_performing_tags(niche)
        if perf_tags:
            all_tags.extend(perf_tags)
            sources.append("performance")
        
        # Get top tags with counts
        tag_counts = Counter(all_tags)
        top_tags = [f"#{tag}" for tag, _ in tag_counts.most_common(limit)]
        
        # Recommended count
        recommended_count = min(5 + len([t for t in top_tags if t in groups.get("trending", [])]), 15)
        
        return {
            "niche": niche,
            "trending": top_tags,
            "recommended_count": recommended_count,
            "sources": list(set(sources)),
            "all_available": list(set(all_tags)),
        }
    
    @staticmethod
    async def _get_top_performing_tags(niche: str) -> List[str]:
        """Get top performing hashtags from database."""
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    text("""
                        SELECT cp.hashtags
                        FROM content_packets cp
                        JOIN publications p ON cp.id = p.content_packet_id
                        WHERE cp.niche = :niche
                        AND p.engagement_score > 50
                        ORDER BY p.engagement_score DESC
                        LIMIT 20
                    """),
                    {"niche": niche}
                )
                rows = result.fetchall()
            
            # Extract hashtags from JSON
            all_hashtags = []
            for row in rows:
                if row.hashtags:
                    if isinstance(row.hashtags, list):
                        all_hashtags.extend(row.hashtags)
                    elif isinstance(row.hashtags, str):
                        import json
                        try:
                            tags = json.loads(row.hashtags)
                            all_hashtags.extend(tags)
                        except:
                            pass
            
            # Get top performing
            tag_counts = Counter(all_hashtags)
            return [tag for tag, _ in tag_counts.most_common(10)]
            
        except Exception as e:
            logger.warning(f"Could not fetch top tags: {e}")
            return []
    
    @staticmethod
    async def suggest_mix(niche: str, target_count: int = 10) -> Dict:
        """Suggest a mix of hashtags for optimal reach."""
        trending = await TrendingDetector.get_trending_for_niche(niche, limit=15)
        
        trending_tags = trending["trending"]
        
        # Create mix: trending + niche-specific + discovery
        mix = {
            "trending": trending_tags[:min(3, target_count)],
            "niche": trending_tags[3:min(6, target_count)],
            "discovery": trending_tags[6:min(10, target_count)],
        }
        
        all_mix = mix["trending"] + mix["niche"] + mix["discovery"]
        
        return {
            "niche": niche,
            "total_count": len(all_mix),
            "mix": mix,
            "suggested_tags": all_mix,
            "strategy": "3 trending + 3 niche + 4 discovery",
        }


class HealthPublisher:
    """Health-based publishing decisions."""
    
    @staticmethod
    async def should_publish(account_id: str, proposed_time: str = None) -> Dict:
        """
        Determine if account should publish based on health.
        
        Returns:
            {
                "should_publish": true/false,
                "reason": "...",
                "risk_level": "low/medium/high",
                "recommended_action": "publish/postpone/stop"
            }
        """
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text("""
                    SELECT health_score, status, daily_post_count, last_activity_at
                    FROM accounts
                    WHERE id = :account_id
                """),
                {"account_id": account_id}
            )
            row = result.fetchone()
        
        if not row:
            return {
                "should_publish": False,
                "reason": "Account not found",
                "risk_level": "unknown",
                "recommended_action": "stop"
            }
        
        health_score = row.health_score or 100
        status = row.status or "active"
        daily_count = row.daily_post_count or 0
        
        # Decision logic based on health
        if status in ["banned", "shadowbanned"]:
            return {
                "should_publish": False,
                "reason": f"Account status: {status}",
                "risk_level": "critical",
                "recommended_action": "stop"
            }
        
        if status == "resting":
            return {
                "should_publish": False,
                "reason": "Account is in resting mode",
                "risk_level": "high",
                "recommended_action": "postpone"
            }
        
        # Health score based decisions
        if health_score < 20:
            return {
                "should_publish": False,
                "reason": f"Critical health score: {health_score}",
                "risk_level": "critical",
                "recommended_action": "stop",
                "suggestion": "Review account for issues before continuing"
            }
        
        if health_score < 40:
            if daily_count >= 1:
                return {
                    "should_publish": False,
                    "reason": f"Low health ({health_score}) - already posted today",
                    "risk_level": "high",
                    "recommended_action": "postpone",
                    "suggestion": "Wait until health improves"
                }
            else:
                return {
                    "should_publish": True,
                    "reason": f"Low health ({health_score}) - limited posting allowed",
                    "risk_level": "medium",
                    "recommended_action": "publish",
                    "suggestion": "Consider reducing activity further"
                }
        
        if health_score < 60:
            if daily_count >= 3:
                return {
                    "should_publish": False,
                    "reason": f"Fair health ({health_score}) - daily limit reached",
                    "risk_level": "medium",
                    "recommended_action": "postpone"
                }
            else:
                return {
                    "should_publish": True,
                    "reason": f"Health OK ({health_score})",
                    "risk_level": "low",
                    "recommended_action": "publish"
                }
        
        # Good health
        return {
            "should_publish": True,
            "reason": f"Health good ({health_score})",
            "risk_level": "low",
            "recommended_action": "publish"
        }
