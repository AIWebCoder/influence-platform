import os
import time
import json
import hashlib
from functools import wraps
from typing import Optional, Any, Callable
import redis.asyncio as redis


class CacheService:
    """Redis-based caching service for API responses."""
    
    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.default_ttl = 300  # 5 minutes
        self.enabled = True
        
    async def initialize(self, redis_url: str):
        """Initialize Redis connection."""
        try:
            self.redis_client = redis.from_url(redis_url, decode_responses=True)
            await self.redis_client.ping()
            print("✅ Cache service initialized")
        except Exception as e:
            print(f"⚠️ Cache service disabled: {e}")
            self.enabled = False
    
    def _generate_key(self, prefix: str, *args, **kwargs) -> str:
        """Generate cache key from arguments."""
        key_parts = [prefix] + [str(arg) for arg in args]
        key_parts += [f"{k}={v}" for k, v in sorted(kwargs.items())]
        key_string = ":".join(key_parts)
        
        if len(key_string) > 200:
            hash_suffix = hashlib.md5(key_string.encode()).hexdigest()[:16]
            key_string = f"{prefix}:{hash_suffix}"
        
        return f"cache:{key_string}"
    
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        if not self.enabled or not self.redis_client:
            return None
        
        try:
            value = await self.redis_client.get(key)
            if value:
                return json.loads(value)
        except Exception as e:
            print(f"Cache get error: {e}")
        
        return None
    
    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set value in cache with TTL."""
        if not self.enabled or not self.redis_client:
            return False
        
        try:
            ttl = ttl or self.default_ttl
            serialized = json.dumps(value)
            await self.redis_client.setex(key, ttl, serialized)
            return True
        except Exception as e:
            print(f"Cache set error: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        """Delete key from cache."""
        if not self.enabled or not self.redis_client:
            return False
        
        try:
            await self.redis_client.delete(key)
            return True
        except Exception as e:
            print(f"Cache delete error: {e}")
            return False
    
    async def invalidate_prefix(self, prefix: str) -> int:
        """Invalidate all keys with given prefix."""
        if not self.enabled or not self.redis_client:
            return 0
        
        try:
            pattern = f"cache:{prefix}:*"
            keys = await self.redis_client.keys(pattern)
            if keys:
                return await self.redis_client.delete(*keys)
        except Exception as e:
            print(f"Cache invalidate error: {e}")
        
        return 0
    
    def cached(self, prefix: str, ttl: Optional[int] = None):
        """Decorator for caching function results."""
        def decorator(func: Callable):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                if not self.enabled:
                    return await func(*args, **kwargs)
                
                cache_key = self._generate_key(prefix, *args, **kwargs)
                
                cached_value = await self.get(cache_key)
                if cached_value is not None:
                    return cached_value
                
                result = await func(*args, **kwargs)
                
                if result is not None:
                    await self.set(cache_key, result, ttl)
                
                return result
            return wrapper
        return decorator


cache_service = CacheService()


async def init_cache(redis_url: str):
    """Initialize cache service."""
    await cache_service.initialize(redis_url)
