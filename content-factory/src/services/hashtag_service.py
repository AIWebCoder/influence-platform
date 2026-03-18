from typing import List, Dict

class HashtagService:
    def __init__(self):
        # Mock database for MVP
        self.mock_db = {
            "fitness": [
                "#gymlife", "#fitnessmotivation", "#workout", "#fitfam", 
                "#healthylifestyle", "#gains", "#bodybuilding", "#fitnessjourney"
            ],
            "travel": [
                "#wanderlust", "#travelphotography", "#explore", "#vacation",
                "#beautifuldestinations", "#travelgram", "#adventure", "#instatravel"
            ],
            "business": [
                "#entrepreneur", "#business", "#success", "#mindset", 
                "#hustle", "#leadership", "#marketing", "#startup"
            ]
        }

    async def search_hashtags(self, niche: str, keyword: str = "") -> List[str]:
        """
        Return a list of tailored hashtags based on niche and keyword.
        In the future this will hit an external API or run ML locally.
        """
        base_hashtags = self.mock_db.get(niche.lower(), ["#instagood", "#viral", "#foryou"])
        
        if keyword:
            keyword = keyword.lower()
            return [t for t in base_hashtags if keyword in t]
        
        return base_hashtags
