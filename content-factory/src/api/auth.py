from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from datetime import timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.core.config import settings, ADMIN_PASSWORD_HASH
from src.core.security import verify_password, create_access_token
from src.core.database import get_db
from src.models.user import User

router = APIRouter()


@router.post("/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Login with email + password. Falls back to env-var admin if enabled and no users exist."""
    # Try DB-backed user first
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()

    if user:
        if not user.is_active:
            raise HTTPException(status_code=403, detail="Account is disabled")
        if not verify_password(form_data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        access_token = create_access_token(
            subject=user.email,
            role=user.role,
            expires_delta=timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
        )
        return {"access_token": access_token, "token_type": "bearer"}

    # Fallback: env-var admin (only if enabled)
    if settings.ADMIN_FALLBACK_ENABLED:
        if form_data.username == settings.ADMIN_USERNAME and verify_password(
            form_data.password, ADMIN_PASSWORD_HASH
        ):
            access_token = create_access_token(
                subject=form_data.username,
                role="admin",
                expires_delta=timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
            )
            return {"access_token": access_token, "token_type": "bearer"}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )
