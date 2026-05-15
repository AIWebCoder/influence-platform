"""Compatibility shim — historically this exposed a get_current_user that only accepted ADMIN_USERNAME.

That behaviour is incompatible with DB-backed operator/viewer users introduced with role-based auth.
Re-export the canonical implementation from ``src.core.security`` so any lingering imports keep working
while honouring the JWT ``role`` claim.
"""
from src.core.security import get_current_user  # noqa: F401

__all__ = ["get_current_user"]
