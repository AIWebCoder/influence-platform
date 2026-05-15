"""Idempotent content_packets columns missing on DBs stamped ahead of Alembic."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

_CONTENT_PACKET_ALTERS = (
    "ALTER TABLE content_packets ADD COLUMN IF NOT EXISTS visual_type VARCHAR(10)",
)


async def ensure_content_schema(conn: AsyncConnection) -> None:
    for sql in _CONTENT_PACKET_ALTERS:
        await conn.execute(text(sql))
