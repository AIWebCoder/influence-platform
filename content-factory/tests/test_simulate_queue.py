"""Queue simulation endpoint — no Kie tokens."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from src.core.config import settings
from src.main import app


@pytest.mark.asyncio
async def test_simulate_queue_disabled_by_default():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/generation-jobs/simulate-queue",
            json={"topic": "Demo", "niche": "lifestyle"},
        )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_simulate_queue_creates_completed_job(monkeypatch):
    monkeypatch.setattr(settings, "GENERATION_ALLOW_QUEUE_SIMULATION", True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/generation-jobs/simulate-queue",
            json={
                "topic": "Boss demo queue item",
                "niche": "lifestyle",
                "content_type": "reel",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "completed"
        job_id = body["job_id"]
        uuid.UUID(job_id)

        list_res = await client.get(
            "/generation-jobs",
            params={"ready_to_publish": True, "limit": 50},
        )
        assert list_res.status_code == 200
        page = list_res.json()
        assert any(item["id"] == job_id for item in page["items"])

        assets_res = await client.get(f"/generation-jobs/{job_id}/assets")
        assert assets_res.status_code == 200
        assets = assets_res.json()
        assert any(a.get("asset_type") == "video" for a in assets)
