from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from src.core.database import get_db
from src.core.redis import get_redis

router = APIRouter()


@router.get("")
async def health_check(
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis)
):
    checks = {}
    is_healthy = True

    # Check PostgreSQL connection
    try:
        await db.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as e:
        checks["postgres"] = f"error: {str(e)}"
        is_healthy = False

    # Check Redis connection
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = f"error: {str(e)}"
        is_healthy = False

    # Check database tables
    try:
        result = await db.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """))
        tables = [row[0] for row in result.fetchall()]
        checks["tables"] = f"{len(tables)} found"
        
        if len(tables) < 5:
            is_healthy = False
    except Exception as e:
        checks["tables"] = f"error: {str(e)}"
        is_healthy = False

    return {
        "status": "healthy" if is_healthy else "degraded",
        "service": "content-factory",
        "checks": checks
    }
