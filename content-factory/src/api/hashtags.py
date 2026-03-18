from typing import List, Optional
from fastapi import APIRouter, Query

from src.services.hashtag_service import HashtagService

router = APIRouter()
svc = HashtagService()

@router.get("/search", response_model=List[str])
async def search_hashtags(
    niche: str = Query(..., description="Niche to search tags for"),
    keyword: Optional[str] = Query("", description="Keyword to filter tags")
):
    """Returns tailored and optimized hashtags based on niche and keyword."""
    return await svc.search_hashtags(niche=niche, keyword=keyword)
