from fastapi import APIRouter
router = APIRouter()

@router.get("")
async def list_niches():
    # TODO Phase 1
    return ["fitness", "food", "travel", "business", "lifestyle"]
