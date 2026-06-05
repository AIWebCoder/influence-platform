import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from src.main import app
from src.services.topic_suggestion_service import (
    default_topics_for_niche,
    fallback_topic_suggestions,
    normalize_topic_examples,
)


@pytest_asyncio.fixture
async def ac() -> AsyncClient:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def test_normalize_topic_examples_dedupes_and_trims():
    raw = ["  alpha  ", "alpha", "", "beta"]
    assert normalize_topic_examples(raw) == ["alpha", "beta"]


def test_default_topics_for_niche_fallback():
    topics = default_topics_for_niche("unknown-niche")
    assert len(topics) >= 1
    assert default_topics_for_niche("fitness")[0]


def test_fallback_topic_suggestions_uses_db_pool_first():
    topics = fallback_topic_suggestions(
        "fitness",
        count=3,
        db_examples=["custom topic from db"],
    )
    assert topics[0] == "custom topic from db"
    assert len(topics) == 3


@pytest.mark.asyncio
async def test_topic_suggestions_endpoint(ac: AsyncClient):
    mock_topics = [
        "morning mobility for desk workers",
        "15-minute HIIT with no equipment",
    ]
    with patch(
        "src.services.topic_suggestion_service.generate_topic_suggestions",
        new_callable=AsyncMock,
        return_value=mock_topics,
    ):
        response = await ac.post(
            "/generation-jobs/topic-suggestions",
            json={"niche": "fitness", "content_type": "reel", "execution_mode": "multi_scene_single_video"},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["topics"] == mock_topics


@pytest.mark.asyncio
async def test_topic_suggestions_endpoint_falls_back_when_llm_fails(ac: AsyncClient):
    with patch(
        "src.services.topic_suggestion_service.generate_topic_suggestions",
        new_callable=AsyncMock,
        side_effect=RuntimeError("quota exceeded"),
    ):
        response = await ac.post(
            "/generation-jobs/topic-suggestions",
            json={"niche": "fitness", "content_type": "reel", "execution_mode": "multi_scene_single_video"},
        )
    assert response.status_code == 200
    topics = response.json()["topics"]
    assert len(topics) >= 1
    assert all(isinstance(item, str) and item.strip() for item in topics)