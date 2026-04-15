import pytest
import pytest_asyncio
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient, ASGITransport
from src.main import app
from src.core.database import Base, engine


from sqlalchemy import text

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    # Setup DB: just clean data before the test, assuming schema exists from init.sql
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f"TRUNCATE TABLE {table.name} CASCADE;"))
            
    yield
    
    # Teardown DB: clean data again
    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f"TRUNCATE TABLE {table.name} CASCADE;"))


@pytest.fixture(autouse=True)
def mock_redis():
    with patch('src.api.content.push_to_queue') as mock:
        yield mock

@pytest.fixture(autouse=True)
def mock_gemini():
    with patch('src.services.generation_task.GeminiService.generate_caption', new_callable=AsyncMock) as mock:
        mock.return_value = {
            "caption": "Mocked AI caption",
            "hashtags": ["#mockai"]
        }
        yield mock

@pytest.fixture(autouse=True)
def mock_openai():
    with patch('src.services.generation_task.OpenAIService.generate_image', new_callable=AsyncMock) as mock:
        mock.return_value = "https://mocked.openai.url/image.jpg"
        yield mock


@pytest.mark.asyncio
async def test_generate_mock_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/content/generate",
            json={"niche": "fitness", "target_accounts": ["acc1"]}
        )
    assert response.status_code == 200
    data = response.json()
    assert data["niche"] == "fitness"
    assert data["status"] == "pending"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_contents():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Generate one content
        await ac.post(
            "/content/generate",
            json={"niche": "fitness", "target_accounts": ["acc1"]}
        )
        
        # List contents
        response = await ac.get("/content")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 1
        assert data[0]["niche"] == "fitness"

@pytest.mark.asyncio
async def test_generate_bulk_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/content/generate/bulk",
            json={"niche": "fitness", "target_accounts": ["acc1"], "count": 3}
        )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 3
    for item in data:
        assert item["status"] == "pending"

@pytest.mark.asyncio
async def test_generate_ab_test():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/content/generate/ab-test",
            json={"niche": "fitness", "target_accounts": ["acc1"]}
        )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["metadata"]["variant"] == "A"
    assert data[1]["metadata"]["variant"] == "B"

