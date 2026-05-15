"""User management endpoints.

- ``/users`` (admin only): CRUD over the user table — create operators, list, update role/active, reset password, delete.
- ``/users/me`` (any authenticated user): read profile / change own password.

Guards:
- Admin cannot demote or deactivate the only remaining admin.
- Admin cannot delete or deactivate their own account.
- Passwords go through the project-wide ``validate_password_strength`` policy.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import (
    get_current_user,
    get_password_hash,
    validate_password_strength,
    verify_password,
)
from src.models.user import User

router = APIRouter()

ALLOWED_ROLES = ("admin", "operator", "viewer")

# Loose RFC-ish check; we intentionally accept reserved TLDs (.local, .internal, …) used in private deployments.
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


def _normalize_email(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Email must be a string")
    cleaned = value.strip().lower()
    if not _EMAIL_RE.match(cleaned):
        raise ValueError("Not a valid email address")
    return cleaned


class UserCreate(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    role: str = "operator"

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        return _normalize_email(v)


class UserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


class UserResponse(BaseModel):
    id: str
    email: str
    role: str
    is_active: bool
    created_at: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def _serialize(u: User) -> UserResponse:
    return UserResponse(
        id=str(u.id),
        email=u.email,
        role=u.role,
        is_active=bool(u.is_active),
        created_at=u.created_at.isoformat() if u.created_at else "",
    )


async def _count_active_admins(db: AsyncSession, exclude_user_id: Optional[str] = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


def _enforce_password_policy(password: str) -> None:
    ok, msg = validate_password_strength(password)
    if not ok:
        raise HTTPException(status_code=400, detail=msg or "Password does not meet the security policy")


# ---------------------------------------------------------------------------
# Self-service ("/me") — any authenticated user
# ---------------------------------------------------------------------------


@router.get("/me", response_model=UserResponse)
async def read_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current authenticated user's row."""
    result = await db.execute(select(User).where(User.email == current_user.get("email")))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _serialize(user)


@router.post("/me/password")
async def change_my_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Authenticated user changes their own password (must supply the current one)."""
    result = await db.execute(select(User).where(User.email == current_user.get("email")))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    _enforce_password_policy(payload.new_password)
    user.hashed_password = get_password_hash(payload.new_password)
    await db.flush()
    return {"message": "Password updated"}


# ---------------------------------------------------------------------------
# Admin CRUD
# ---------------------------------------------------------------------------


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    request: UserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Admin creates a new user (operator by default)."""
    if request.role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(ALLOWED_ROLES)}")

    _enforce_password_policy(request.password)

    email = request.email.lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=email,
        hashed_password=get_password_hash(request.password),
        role=request.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return _serialize(user)


@router.get("/", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """Admin lists every user, newest first."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return [_serialize(u) for u in result.scalars().all()]


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Admin updates role / active / password on an existing user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_self = (user.email == admin.get("email"))

    if payload.role is not None:
        if payload.role not in ALLOWED_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(ALLOWED_ROLES)}")
        # Prevent removing the last active admin
        if user.role == "admin" and payload.role != "admin":
            remaining = await _count_active_admins(db, exclude_user_id=str(user.id))
            if remaining == 0:
                raise HTTPException(status_code=400, detail="Cannot demote the last remaining admin")
        if is_self and payload.role != "admin":
            raise HTTPException(status_code=400, detail="Admins cannot demote themselves")
        user.role = payload.role

    if payload.is_active is not None:
        if is_self and payload.is_active is False:
            raise HTTPException(status_code=400, detail="Admins cannot deactivate their own account")
        if user.role == "admin" and payload.is_active is False:
            remaining = await _count_active_admins(db, exclude_user_id=str(user.id))
            if remaining == 0:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last remaining admin")
        user.is_active = payload.is_active

    if payload.password is not None:
        _enforce_password_policy(payload.password)
        user.hashed_password = get_password_hash(payload.password)

    await db.flush()
    await db.refresh(user)
    return _serialize(user)


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    admin: dict = Depends(require_admin),
):
    """Admin deletes a user. Cannot delete self or the last active admin."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email == admin.get("email"):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    if user.role == "admin":
        remaining = await _count_active_admins(db, exclude_user_id=str(user.id))
        if remaining == 0:
            raise HTTPException(status_code=400, detail="Cannot delete the last remaining admin")

    await db.delete(user)
    return {"message": "User deleted successfully"}
