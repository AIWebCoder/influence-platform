import redis.asyncio as aioredis
from src.core.config import settings

redis_client: aioredis.Redis = None


async def init_redis():
    global redis_client
    redis_client = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True
    )
    await redis_client.ping()
    print("✅ Redis connecté")


async def get_redis() -> aioredis.Redis:
    return redis_client


async def push_to_queue(queue_name: str, payload: str):
    await redis_client.lpush(queue_name, payload)


async def pop_from_queue(queue_name: str) -> str | None:
    return await redis_client.rpop(queue_name)
