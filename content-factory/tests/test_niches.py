import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from src.main import app


@pytest_asyncio.fixture
async def ac() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_list_niches_from_db(ac: AsyncClient):
    response = await ac.get("/niches")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if data:
        assert "id" in data[0]
        assert "name" in data[0]


@pytest.mark.asyncio
async def test_create_and_delete_niche(ac: AsyncClient):
    name = "test-niche-phase2"
    create = await ac.post(
        "/niches",
        json={
            "name": name,
            "description": "Phase 2 test niche",
            "hashtags": ["#phase2"],
            "posting_times": [9, 18],
        },
    )
    assert create.status_code == 201
    niche_id = create.json()["id"]

    get_one = await ac.get(f"/niches/{niche_id}")
    assert get_one.status_code == 200
    assert get_one.json()["name"] == name

    delete = await ac.delete(f"/niches/{niche_id}")
    assert delete.status_code == 204
