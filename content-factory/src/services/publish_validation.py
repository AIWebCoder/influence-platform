"""Shared validation for Instagram publish-intent pipeline (P0)."""

from __future__ import annotations

from urllib.parse import urlparse


def is_public_http_url(url: str) -> bool:
    u = str(url or "").strip()
    if not u:
        return False
    try:
        p = urlparse(u)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False


def instagram_account_missing_fields(
    ig_user_id: str | None,
    ig_access_token: str | None,
) -> list[str]:
    missing: list[str] = []
    if not str(ig_user_id or "").strip():
        missing.append("ig_user_id")
    if not str(ig_access_token or "").strip():
        missing.append("ig_access_token")
    return missing