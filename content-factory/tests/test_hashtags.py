import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.main import app

@pytest_asyncio.fixture
async def ac() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

@pytest.mark.asyncio
async def test_search_hashtags(ac: AsyncClient):
    response = await ac.get("/hashtags/search?niche=fitness")
    assert response.status_code == 200
    data = response.json()
    assert "#gymlife" in data
    
@pytest.mark.asyncio
async def test_search_hashtags_with_keyword(ac: AsyncClient):
    response = await ac.get("/hashtags/search?niche=fitness&keyword=gym")
    assert response.status_code == 200
    data = response.json()
    assert "#gymlife" in data
    assert "#fitfam" not in data
