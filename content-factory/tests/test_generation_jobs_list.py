"""List and delete generation jobs API."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest.mark.asyncio
async def test_list_generation_jobs_empty():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/generation-jobs", params={"limit": 5})
    assert res.status_code == 200
    assert isinstance(res.json(), list)


@pytest.mark.asyncio
async def test_list_ready_to_publish_filter():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/generation-jobs", params={"ready_to_publish": True, "limit": 5})
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_delete_generation_job_not_found():
    transport = ASGITransport(app=app)
    missing = str(uuid.uuid4())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.delete(f"/generation-jobs/{missing}")
    assert res.status_code == 404
