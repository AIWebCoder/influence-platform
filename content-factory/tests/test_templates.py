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
async def test_create_template(ac: AsyncClient):
    payload = {
        "name": "Test Template",
        "caption_template": "Hello {{niche}}!",
        "visual_prompt": "A picture of a {{niche}} dog",
        "hashtag_groups": ["#dogsofinstagram", "#cute"],
        "is_active": True
    }
    
    response = await ac.post("/templates/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Template"
    assert "id" in data

@pytest.mark.asyncio
async def test_get_templates(ac: AsyncClient):
    response = await ac.get("/templates/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
