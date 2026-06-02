"""Row-level access scope for organization + persona assignments."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.security import get_current_user
from src.models.user import User

DEFAULT_ORGANIZATION_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")


@dataclass(frozen=True)
class AccessScope:
    user_id: Optional[uuid.UUID]
    organization_id: uuid.UUID
    role: str
    mode: str
    persona_ids: Optional[tuple[uuid.UUID, ...]]

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_fleet(self) -> bool:
        return self.mode == "fleet" or self.is_admin

    @property
    def is_viewer(self) -> bool:
        return self.role == "viewer"

    def allows_persona(self, persona_id: Optional[uuid.UUID]) -> bool:
        if persona_id is None:
            return self.is_fleet
        if self.is_fleet:
            return True
        if not self.persona_ids:
            return False
        return persona_id in self.persona_ids


async def allowed_account_ids(db: AsyncSession, scope: AccessScope) -> list[uuid.UUID]:
    """Account UUIDs the user may access within the organization."""
    if scope.is_fleet:
        res = await db.execute(
            text(
                """
                SELECT id FROM accounts
                WHERE organization_id = :org_id OR organization_id IS NULL
                """
            ),
            {"org_id": str(scope.organization_id)},
        )
        return [uuid.UUID(str(r[0])) for r in res.fetchall()]
    if not scope.persona_ids:
        return []
    res = await db.execute(
        text(
            """
            SELECT id FROM accounts
            WHERE persona_id = ANY(CAST(:persona_ids AS uuid[]))
              AND (organization_id = :org_id OR organization_id IS NULL)
            """
        ),
        {
            "persona_ids": [str(p) for p in scope.persona_ids],
            "org_id": str(scope.organization_id),
        },
    )
    return [uuid.UUID(str(r[0])) for r in res.fetchall()]


async def assert_account_access(
    db: AsyncSession, scope: AccessScope, account_id: str | uuid.UUID
) -> uuid.UUID:
    try:
        aid = uuid.UUID(str(account_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid account_id") from exc
    allowed = {str(a) for a in await allowed_account_ids(db, scope)}
    if str(aid) not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this account")
    return aid


def alerts_scope_clause(scope: AccessScope, account_ids: list[uuid.UUID]) -> tuple[str, dict]:
    """SQL fragment: alerts visible to scope (global alerts + scoped accounts)."""
    if scope.is_fleet:
        return "TRUE", {}
    if not account_ids:
        return "(account_id IS NULL)", {}
    return (
        "(account_id IS NULL OR account_id = ANY(CAST(:scope_account_ids AS uuid[])))",
        {"scope_account_ids": [str(a) for a in account_ids]},
    )


async def _resolve_user_row(db: AsyncSession, current_user: dict) -> User:
    user_id_raw = current_user.get("user_id")
    if user_id_raw:
        try:
            uid = uuid.UUID(str(user_id_raw))
        except ValueError:
            uid = None
        if uid:
            result = await db.execute(select(User).where(User.id == uid))
            row = result.scalar_one_or_none()
            if row:
                return row

    email = (current_user.get("email") or current_user.get("sub") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user context")
    result = await db.execute(select(User).where(User.email == email))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return row


async def resolve_access_scope(db: AsyncSession, current_user: dict) -> AccessScope:
    user = await _resolve_user_row(db, current_user)
    org_id = user.organization_id
    if org_id is None:
        org_raw = current_user.get("organization_id")
        if org_raw:
            try:
                org_id = uuid.UUID(str(org_raw))
            except ValueError:
                org_id = None
    if org_id is None:
        org_id = DEFAULT_ORGANIZATION_ID

    mode = (settings.ACCESS_MODE or "scoped").strip().lower()
    if mode not in ("fleet", "scoped"):
        mode = "scoped"

    role_raw = (current_user.get("role") or user.role or "viewer").lower()
    role_aliases = {"operateur": "operator", "opérateur": "operator", "lecteur": "viewer"}
    role = role_aliases.get(role_raw, role_raw)
    if role not in ("admin", "operator", "viewer"):
        role = "viewer"
    persona_ids: Optional[tuple[uuid.UUID, ...]] = None

    if mode == "scoped" and role != "admin":
        res = await db.execute(
            text(
                """
                SELECT upa.persona_id
                FROM user_persona_assignments upa
                JOIN personas p ON p.id = upa.persona_id
                WHERE upa.user_id = :user_id
                  AND (p.organization_id = :org_id OR p.organization_id IS NULL)
                """
            ),
            {"user_id": str(user.id), "org_id": str(org_id)},
        )
        persona_ids = tuple(uuid.UUID(str(r[0])) for r in res.fetchall())

    return AccessScope(
        user_id=user.id,
        organization_id=org_id,
        role=role,
        mode=mode,
        persona_ids=persona_ids,
    )


async def get_access_scope(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccessScope:
    return await resolve_access_scope(db, current_user)


async def resolve_optional_access_scope(
    db: AsyncSession,
    current_user: Optional[dict],
) -> Optional[AccessScope]:
    if current_user is None:
        return None
    return await resolve_access_scope(db, current_user)


def _job_target_account_ids(job) -> list[uuid.UUID]:
    payload = job.input_payload if isinstance(job.input_payload, dict) else {}
    raw = payload.get("target_accounts") or []
    ids: list[uuid.UUID] = []
    for item in raw:
        if isinstance(item, dict) and item.get("id"):
            try:
                ids.append(uuid.UUID(str(item["id"])))
            except ValueError:
                continue
    return ids


async def filter_content_packets_for_scope(
    db: AsyncSession, packets: list, scope: AccessScope
) -> list:
    """Keep packets whose target_accounts intersect allowed accounts."""
    if scope.is_fleet:
        return packets
    allowed = {str(a) for a in await allowed_account_ids(db, scope)}
    if not allowed:
        return []
    filtered = []
    for packet in packets:
        targets = getattr(packet, "target_accounts", None) or []
        if not isinstance(targets, list):
            continue
        target_ids = {str(t).strip() for t in targets if t}
        if target_ids & allowed:
            filtered.append(packet)
    return filtered


async def assert_content_packet_access(
    db: AsyncSession, scope: AccessScope, packet
) -> None:
    visible = await filter_content_packets_for_scope(db, [packet], scope)
    if not visible:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this content")


async def filter_generation_jobs_for_scope(db: AsyncSession, jobs: list, scope: Optional[AccessScope]) -> list:
    if scope is None:
        return []

    filtered = []
    for job in jobs:
        if job.organization_id and job.organization_id != scope.organization_id:
            continue
        if scope.is_fleet:
            filtered.append(job)
            continue
        if scope.user_id and job.created_by_user_id == scope.user_id:
            filtered.append(job)
            continue
        if not scope.persona_ids:
            continue
        target_ids = _job_target_account_ids(job)
        if not target_ids:
            continue
        res = await db.execute(
            text(
                """
                SELECT COUNT(*)::int
                FROM accounts
                WHERE id = ANY(CAST(:account_ids AS uuid[]))
                  AND persona_id = ANY(CAST(:persona_ids AS uuid[]))
                """
            ),
            {
                "account_ids": [str(a) for a in target_ids],
                "persona_ids": [str(p) for p in scope.persona_ids],
            },
        )
        if int(res.scalar() or 0) > 0:
            filtered.append(job)
    return filtered


def require_persona_access(scope: AccessScope, persona_id: Optional[uuid.UUID]) -> None:
    if not scope.allows_persona(persona_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this persona")
