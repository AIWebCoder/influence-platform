from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


class PromptOptimizer:
    """Analyze top-performing content to improve AI prompts."""
    
    # Common patterns in high-performing content
    HOOK_PATTERNS = [
        "did you know",
        "here's the truth",
        "stop doing",
        "start doing",
        "secret",
        "hack",
        "mistake",
        "warning",
        "this is how",
    ]
    
    CTA_PATTERNS = [
        "comment below",
        "let me know",
        "share this",
        "save this",
        "follow for more",
        "link in bio",
    ]
    
    @staticmethod
    async def analyze_top_performers() -> Dict:
        """Analyze top-performing captions to extract patterns."""
        from src.services.abTestEngine import ABTestEngine
        
        top_captions = await ABTestEngine.get_top_performing_captions(limit=20)
        
        if not top_captions:
            return {
                "patterns": {},
                "recommendations": [],
                "improved_prompt": None,
            }
        
        patterns = {
            "hooks": [],
            "ctas": [],
            "hashtag_count": [],
            "avg_length": 0,
            "question_usage": 0,
        }
        
        for caption in top_captions:
            text = caption.get("caption", "").lower()
            
            # Find hooks
            for hook in PromptOptimizer.HOOK_PATTERNS:
                if hook in text:
                    patterns["hooks"].append(hook)
            
            # Find CTAs
            for cta in PromptOptimizer.CTA_PATTERNS:
                if cta in text:
                    patterns["ctas"].append(cta)
            
            # Track metrics
            patterns["avg_length"] += len(text)
            if "?" in text:
                patterns["question_usage"] += 1
        
        # Calculate averages
        count = len(top_captions)
        patterns["avg_length"] = patterns["avg_length"] / count if count > 0 else 0
        patterns["question_usage"] = patterns["question_usage"] / count if count > 0 else 0
        
        # Get most common hooks and CTAs
        from collections import Counter
        common_hooks = Counter(patterns["hooks"]).most_common(3)
        common_ctas = Counter(patterns["ctas"]).most_common(3)
        
        # Generate improved prompt
        improved_prompt = PromptOptimizer._build_improved_prompt(common_hooks, common_ctas, patterns)
        
        # Generate recommendations
        recommendations = PromptOptimizer._generate_recommendations(patterns, common_hooks, common_ctas)
        
        return {
            "patterns": {
                "top_hooks": [h[0] for h in common_hooks],
                "top_ctas": [c[0] for c in common_ctas],
                "avg_length": round(patterns["avg_length"], 0),
                "question_usage_pct": round(patterns["question_usage"] * 100, 1),
            },
            "recommendations": recommendations,
            "improved_prompt": improved_prompt,
        }
    
    @staticmethod
    def _build_improved_prompt(common_hooks, common_ctas, patterns) -> str:
        """Build an improved prompt based on analysis."""
        hook_str = ", ".join([f'"{h[0]}"' for h in common_hooks[:2]]) if common_hooks else "a compelling hook"
        cta_str = ", ".join([f'"{c[0]}"' for c in common_ctas[:2]]) if common_ctas else "a call-to-action"
        
        improved = f"""Generate an Instagram caption that:
- Starts with {hook_str}
- Is {int(patterns['avg_length'])} characters (100-300 recommended)
- Includes {cta_str}
- Uses 5-15 relevant hashtags
- Contains a question to drive engagement
- Has good formatting with line breaks
- Feels authentic and engaging"""
        
        return improved
    
    @staticmethod
    def _generate_recommendations(patterns, common_hooks, common_ctas) -> List[str]:
        """Generate actionable recommendations."""
        recommendations = []
        
        # Hook recommendations
        if not common_hooks:
            recommendations.append("Add strong opening hooks like 'Did you know' or 'Here's the truth' to grab attention")
        
        # CTA recommendations
        if not common_ctas:
            recommendations.append("Include clear calls-to-action like 'Comment below' or 'Save for later'")
        
        # Question recommendations
        if patterns["question_usage"] < 0.5:
            recommendations.append("Add questions to your captions to drive engagement")
        
        # Length recommendations
        if patterns["avg_length"] < 100:
            recommendations.append("Your captions might be too short. Try adding more context.")
        elif patterns["avg_length"] > 300:
            recommendations.append("Your captions might be too long. Try condensing the message.")
        
        # Default recommendation
        if not recommendations:
            recommendations.append("Great content! Continue analyzing to find more optimization opportunities.")
        
        return recommendations
    
    @staticmethod
    async def optimize_for_niche(niche: str) -> Dict:
        """Get niche-specific optimization recommendations."""
        # Niche-specific tips
        niche_tips = {
            "fitness": {
                "hooks": ["stop doing", "here's the truth", "mistake"],
                "ctas": ["save this", "share with a friend", "link in bio"],
                "hashtags": 10,
            },
            "food": {
                "hooks": ["here's the recipe", "you need to try", "secret"],
                "ctas": ["save for later", "comment what you think", "share"],
                "hashtags": 12,
            },
            "travel": {
                "hooks": ["this is how", "hidden gem", "you need to visit"],
                "ctas": ["save this", "follow for more", "pin this"],
                "hashtags": 15,
            },
            "business": {
                "hooks": ["did you know", "stop doing", "mistake"],
                "ctas": ["comment below", "let me know", "share this"],
                "hashtags": 8,
            },
            "lifestyle": {
                "hooks": ["daily", "here's how", "truth about"],
                "ctas": ["save this", "follow for more", "link in bio"],
                "hashtags": 10,
            },
        }
        
        tips = niche_tips.get(niche.lower(), niche_tips["lifestyle"])
        
        return {
            "niche": niche,
            "recommended_hooks": tips["hooks"],
            "recommended_ctas": tips["ctas"],
            "recommended_hashtags": tips["hashtags"],
            "tips": [
                f"Start with: {', '.join(tips['hooks'])}",
                f"Include CTA: {', '.join(tips['ctas'])}",
                f"Use {tips['recommended_hashtags']} hashtags",
            ]
        }
