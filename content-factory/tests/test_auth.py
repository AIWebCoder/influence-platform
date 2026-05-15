import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app
from src.core.config import settings

# The env-var fallback was removed; tests now go through the seeded admin DB row.
# `seed_first_admin()` inserts (ADMIN_EMAIL, ADMIN_PASSWORD) during the app lifespan.

@pytest.mark.asyncio
async def test_login_success():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/auth/login",
            data={"username": settings.ADMIN_EMAIL, "password": settings.ADMIN_PASSWORD},
        )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data.get("user", {}).get("role") == "admin"

@pytest.mark.asyncio
async def test_login_failure():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/auth/login",
            data={"username": settings.ADMIN_EMAIL, "password": "wrongpassword"},
        )
    assert response.status_code == 401
