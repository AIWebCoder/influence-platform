import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from datetime import date, timedelta
import uuid

from src.main import app

@pytest_asyncio.fixture
async def ac() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

@pytest.mark.asyncio
async def test_get_calendar_empty(ac: AsyncClient):
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    response = await ac.get(f"/scheduling/calendar?start_date={today}&end_date={tomorrow}")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_update_status_not_found(ac: AsyncClient):
    fake_id = str(uuid.uuid4())
    response = await ac.patch(f"/scheduling/{fake_id}/status", json={"status": "published"})
    assert response.status_code == 404
