import re
from typing import Dict, List, Tuple, Optional
import logging

logger = logging.getLogger(__name__)


class CaptionScorer:
    """Score generated captions for quality and engagement potential."""
    
    # Weight factors for scoring
    WEIGHTS = {
        "length": 0.15,
        "hook": 0.20,
        "cta": 0.15,
        "hashtags": 0.15,
        "emoji": 0.10,
        "questions": 0.10,
        "variety": 0.15,
    }
    
    # Optimal ranges
    OPTIMAL_LENGTH = (100, 300)
    OPTIMAL_HASHTAGS = (5, 15)
    
    @staticmethod
    def score_caption(caption: str, hashtags: Optional[List[str]] = None) -> Dict:
        """
        Score a caption and return detailed breakdown.
        
        Returns:
            {
                "total_score": 0-100,
                "grade": "A"|"B"|"C"|"D"|"F",
                "breakdown": {...},
                "suggestions": [...]
            }
        """
        hashtags = hashtags or []
        
        breakdown = {
            "length_score": CaptionScorer._score_length(caption),
            "hook_score": CaptionScorer._score_hook(caption),
            "cta_score": CaptionScorer._score_cta(caption),
            "hashtag_score": CaptionScorer._score_hashtags(hashtags),
            "emoji_score": CaptionScorer._score_emoji(caption),
            "question_score": CaptionScorer._score_questions(caption),
            "variety_score": CaptionScorer._score_variety(caption),
        }
        
        # Calculate weighted total
        total = sum(
            breakdown[key] * CaptionScorer.WEIGHTS[key.replace("_score", "")]
            for key in breakdown
        )
        
        # Determine grade
        if total >= 80:
            grade = "A"
        elif total >= 65:
            grade = "B"
        elif total >= 50:
            grade = "C"
        elif total >= 35:
            grade = "D"
        else:
            grade = "F"
        
        # Generate suggestions
        suggestions = CaptionScorer._generate_suggestions(breakdown, caption, hashtags)
        
        return {
            "total_score": round(total, 1),
            "grade": grade,
            "breakdown": breakdown,
            "suggestions": suggestions,
        }
    
    @staticmethod
    def _score_length(caption: str) -> float:
        """Score based on optimal length."""
        length = len(caption)
        min_opt, max_opt = CaptionScorer.OPTIMAL_LENGTH
        
        if min_opt <= length <= max_opt:
            return 100
        elif length < min_opt:
            return max(0.0, (length / min_opt) * 100)
        else:
            # Penalize over-length
            excess = length - max_opt
            penalty = min(30.0, (excess / 100) * 30)
            return max(0.0, 100 - penalty)
    
    @staticmethod
    def _score_hook(caption: str) -> float:
        """Score based on having a strong opening hook."""
        caption_lower = caption.lower().strip()
        
        hooks = [
            "did you know",
            "here's the truth",
            "stop doing",
            "start doing",
            "secret",
            "hack",
            "mistake",
            "warning",
            "fact",
            "tip",
            "how to",
            "why you should",
            "this is how",
            "learn",
            "finally",
        ]
        
        for hook in hooks:
            if caption_lower.startswith(hook):
                return 100
        
        # Check first 50 chars
        first_part = caption_lower[:50]
        for hook in hooks[:5]:
            if hook in first_part:
                return 80
        
        return 30
    
    @staticmethod
    def _score_cta(caption: str) -> float:
        """Score based on having a call-to-action."""
        ctas = [
            "comment",
            "share",
            "save",
            "follow",
            "click",
            "link in bio",
            "dm",
            "tag",
            "let me know",
            "what do you think",
        ]
        
        caption_lower = caption.lower()
        
        for cta in ctas:
            if cta in caption_lower:
                return 100
        
        return 20
    
    @staticmethod
    def _score_hashtags(hashtags: List[str]) -> float:
        """Score based on optimal hashtag count."""
        count = len(hashtags)
        min_opt, max_opt = CaptionScorer.OPTIMAL_HASHTAGS
        
        if min_opt <= count <= max_opt:
            return 100
        elif count < min_opt:
            return max(0.0, (count / min_opt) * 80)
        else:
            # Penalize too many hashtags
            excess = count - max_opt
            penalty = min(40.0, excess * 5.0)
            return max(0.0, 100.0 - penalty)
    
    @staticmethod
    def _score_emoji(caption: str) -> float:
        """Score based on emoji usage."""
        emoji_pattern = re.compile(
            "[\U0001F600-\U0001F64F"
            "\U0001F300-\U0001F5FF"
            "\U0001F680-\U0001F6FF"
            "\U0001F1E0-\U0001F1FF"
            "\U00002702-\U000027B0"
            "\U000024C2-\U0001F251]+"
        )
        
        emojis = emoji_pattern.findall(caption)
        emoji_count = len(emojis)
        
        if 1 <= emoji_count <= 3:
            return 100
        elif emoji_count == 0:
            return 40
        elif emoji_count <= 5:
            return 80
        else:
            return max(0, 100 - (emoji_count - 5) * 15)
    
    @staticmethod
    def _score_questions(caption: str) -> float:
        """Score based on having questions (engagement driver)."""
        question_count = caption.count("?")
        
        if question_count == 1:
            return 100
        elif question_count == 2:
            return 90
        elif question_count > 2:
            return 70
        elif question_count == 0:
            return 30.0
        
        return 0.0
    
    @staticmethod
    def _score_variety(caption: str) -> float:
        """Score based on text variety (paragraphs, line breaks)."""
        lines = caption.split("\n")
        non_empty_lines = [l.strip() for l in lines if l.strip()]
        
        if len(non_empty_lines) >= 3:
            return 100
        elif len(non_empty_lines) == 2:
            return 80
        elif len(non_empty_lines) == 1:
            # Check for paragraph separator
            if len(caption) > 200:
                return 60
            return 40
        
        return 50
    
    @staticmethod
    def _generate_suggestions(breakdown: Dict, caption: str, hashtags: List[str]) -> List[str]:
        """Generate improvement suggestions."""
        suggestions = []
        
        if breakdown["length_score"] < 60:
            suggestions.append("Caption is too short or too long. Aim for 100-300 characters.")
        
        if breakdown["hook_score"] < 50:
            suggestions.append("Add a stronger hook at the start (e.g., 'Did you know...', 'Stop doing this...').")
        
        if breakdown["cta_score"] < 50:
            suggestions.append("Add a call-to-action (e.g., 'Comment below', 'Save for later').")
        
        if breakdown["hashtag_score"] < 60:
            if len(hashtags) < 5:
                suggestions.append("Add more hashtags (5-15 recommended).")
            elif len(hashtags) > 15:
                suggestions.append("Reduce hashtags to avoid looking spammy (5-15 recommended).")
        
        if breakdown["emoji_score"] < 50:
            suggestions.append("Add 1-3 emojis to make the caption more visually appealing.")
        
        if breakdown["question_score"] < 50:
            suggestions.append("Add a question to drive engagement.")
        
        if breakdown["variety_score"] < 60:
            suggestions.append("Break up the caption into multiple short paragraphs.")
        
        if not suggestions:
            suggestions.append("Great caption! Ready for publishing.")
        
        return suggestions


# Convenience function
def score_caption(caption: str, hashtags: Optional[List[str]] = None) -> Dict:
    """Quick scoring function."""
    return CaptionScorer.score_caption(caption, hashtags)
