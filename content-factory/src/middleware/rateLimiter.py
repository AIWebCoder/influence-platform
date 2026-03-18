from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import Dict, Tuple
import time


class RateLimiter:
    """Simple in-memory rate limiter (use Redis for distributed)."""
    
    # Rate limits per role
    RATE_LIMITS = {
        "admin": {"requests": 1000, "window": 60},      # 1000 req/min
        "operator": {"requests": 500, "window": 60},    # 500 req/min
        "viewer": {"requests": 100, "window": 60},       # 100 req/min
    }
    
    # Endpoint-specific limits
    ENDPOINT_LIMITS = {
        "/auth/login": {"requests": 5, "window": 60},      # 5 login attempts/min
        "/content/generate": {"requests": 20, "window": 60}, # 20 generations/min
    }
    
    def __init__(self):
        self.requests: Dict[str, list] = {}
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier from request."""
        # Try to get user email from auth header
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            # Use token prefix as identifier (not decoding)
            return f"token_{auth_header[:20]}"
        
        # Fall back to IP
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"
    
    def _clean_old_requests(self, client_id: str, window: int):
        """Remove requests outside the time window."""
        if client_id not in self.requests:
            return
        
        cutoff = time.time() - window
        self.requests[client_id] = [
            req_time for req_time in self.requests[client_id]
            if req_time > cutoff
        ]
    
    def check_rate_limit(
        self, 
        request: Request, 
        endpoint_limit: dict = None
    ) -> Tuple[bool, dict]:
        """
        Check if request is within rate limit.
        Returns (allowed, info_dict)
        """
        client_id = self._get_client_id(request)
        
        # Determine limit based on endpoint or default
        if endpoint_limit:
            limit_config = endpoint_limit
        else:
            # Try to get role from request state (set by auth)
            role = getattr(request.state, "user_role", "viewer")
            limit_config = self.RATE_LIMITS.get(role, self.RATE_LIMITS["viewer"])
        
        requests_limit = limit_config["requests"]
        window = limit_config["window"]
        
        # Clean old requests
        self._clean_old_requests(client_id, window)
        
        # Initialize if needed
        if client_id not in self.requests:
            self.requests[client_id] = []
        
        current_count = len(self.requests[client_id])
        
        if current_count >= requests_limit:
            # Calculate retry-after
            oldest = min(self.requests[client_id])
            retry_after = int(window - (time.time() - oldest)) + 1
            
            return False, {
                "limit": requests_limit,
                "remaining": 0,
                "reset": retry_after,
                "retry_after": retry_after
            }
        
        # Add current request
        self.requests[client_id].append(time.time())
        
        return True, {
            "limit": requests_limit,
            "remaining": requests_limit - current_count - 1,
            "reset": window
        }


# Global rate limiter instance
rate_limiter = RateLimiter()


async def rate_limit_middleware(request: Request, call_next):
    """Middleware to apply rate limiting."""
    # Skip rate limiting for health checks
    if request.url.path in ["/health", "/", "/metrics"]:
        return await call_next(request)
    
    # Check endpoint-specific limits first
    endpoint_limit = None
    for path, limit in RateLimiter.ENDPOINT_LIMITS.items():
        if request.url.path.startswith(path):
            endpoint_limit = limit
            break
    
    allowed, info = rate_limiter.check_rate_limit(request, endpoint_limit)
    
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": "Rate limit exceeded",
                "limit": info["limit"],
                "remaining": info["remaining"],
                "retry_after": info["retry_after"]
            },
            headers={
                "X-RateLimit-Limit": str(info["limit"]),
                "X-RateLimit-Remaining": str(info["remaining"]),
                "X-RateLimit-Reset": str(info["reset"]),
                "Retry-After": str(info["retry_after"])
            }
        )
    
    response = await call_next(request)
    
    # Add rate limit headers to response
    response.headers["X-RateLimit-Limit"] = str(info["limit"])
    response.headers["X-RateLimit-Remaining"] = str(info["remaining"])
    response.headers["X-RateLimit-Reset"] = str(info["reset"])
    
    return response
