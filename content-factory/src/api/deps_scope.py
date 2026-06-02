"""FastAPI dependencies for access scope and write guards."""

from fastapi import Depends, HTTPException, status

from src.core.access_scope import AccessScope, get_access_scope


async def require_write_access(scope: AccessScope = Depends(get_access_scope)) -> AccessScope:
    """Block viewers from mutating routes."""
    if scope.role == "viewer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Read-only access for viewer role",
        )
    return scope
