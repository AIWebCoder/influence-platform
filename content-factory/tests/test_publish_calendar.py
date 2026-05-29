"""Publish calendar API (publication_intents)."""

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.mark.asyncio
async def test_publish_calendar_week():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(
            "/scheduling/calendar",
            params={"start_date": "2026-01-01", "end_date": "2026-01-07"},
        )
    assert res.status_code == 200
    assert isinstance(res.json(), list)


@pytest.mark.asyncio
async def test_publish_intent_schedule_not_found():
    import uuid

    transport = ASGITransport(app=app)
    missing = str(uuid.uuid4())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.patch(
            f"/scheduling/publish-intents/{missing}/schedule",
            json={"scheduled_at": "2026-06-01T12:00:00+00:00"},
        )
    assert res.status_code == 404
