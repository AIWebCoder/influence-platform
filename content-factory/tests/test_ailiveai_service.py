import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services import ailiveai_service


@pytest.fixture
def instant_sleep(monkeypatch):
    async def _no_sleep(_delay: float = 0) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)


@pytest.fixture
def ailiveai_settings(monkeypatch):
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_API_KEY", "test-key", raising=False)
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_BASE_URL", "https://api.example.test", raising=False)
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_POLL_BASE_URL", "https://api.example.test", raising=False)
    monkeypatch.setattr(ailiveai_service.settings, "GENERATION_AILIVEAI_MAX_POLLS", 60, raising=False)


@pytest.mark.asyncio
async def test_generate_video_success(instant_sleep, ailiveai_settings):
    post_resp = MagicMock()
    post_resp.status_code = 200
    post_resp.text = '{"promptId":"p1","seed":"1"}'
    post_resp.json.return_value = {"promptId": "p1", "seed": "1"}

    poll1 = MagicMock()
    poll1.status_code = 200
    poll1.text = "{}"
    poll1.json.return_value = {"promptId": "p1", "medias": [{"id": "1", "mediaType": "IMAGE", "mediaUrl": "https://x/i.jpg"}]}

    poll2 = MagicMock()
    poll2.status_code = 200
    poll2.text = "{}"
    poll2.json.return_value = {
        "promptId": "p1",
        "medias": [
            {"id": "1", "mediaType": "IMAGE", "mediaUrl": "https://x/i.jpg"},
            {"id": "2", "mediaType": "VIDEO", "mediaUrl": "https://cdn.example/out.mp4"},
        ],
    }

    client_instance = MagicMock()
    client_instance.post = AsyncMock(return_value=post_resp)
    client_instance.get = AsyncMock(side_effect=[poll1, poll2])

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=client_instance)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("src.services.ailiveai_service.httpx.AsyncClient", return_value=mock_cm):
        svc = ailiveai_service.AiliveaiService()
        out = await svc.generate_video("hello world", media_id="img-99", trace={})

    assert out["video_url"] == "https://cdn.example/out.mp4"
    assert out["status"] == "completed"
    assert out["error"] is None
    assert out.get("source_media_id") == "img-99"
    assert out.get("source_image_url") == "https://x/i.jpg"


@pytest.mark.asyncio
async def test_generate_video_api_error(instant_sleep, ailiveai_settings):
    post_resp = MagicMock()
    post_resp.status_code = 502
    post_resp.text = "bad gateway"

    client_instance = MagicMock()
    client_instance.post = AsyncMock(return_value=post_resp)

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=client_instance)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("src.services.ailiveai_service.httpx.AsyncClient", return_value=mock_cm):
        svc = ailiveai_service.AiliveaiService()
        out = await svc.generate_video("hello", media_id="mid")

    assert out["video_url"] is None
    assert out["status"] == "failed"
    assert str(out.get("error") or "").startswith("HTTP_502")


@pytest.mark.asyncio
async def test_generate_video_timeout(instant_sleep, ailiveai_settings, monkeypatch):
    monkeypatch.setattr(ailiveai_service.settings, "GENERATION_AILIVEAI_MAX_POLLS", 2, raising=False)

    post_resp = MagicMock()
    post_resp.status_code = 200
    post_resp.text = '{"promptId":"p1"}'
    post_resp.json.return_value = {"promptId": "p1", "seed": "1"}

    poll = MagicMock()
    poll.status_code = 200
    poll.text = "{}"
    poll.json.return_value = {"promptId": "p1", "medias": [{"id": "1", "mediaType": "IMAGE", "mediaUrl": "https://x/i.jpg"}]}

    client_instance = MagicMock()
    client_instance.post = AsyncMock(return_value=post_resp)
    client_instance.get = AsyncMock(return_value=poll)

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=client_instance)
    mock_cm.__aexit__ = AsyncMock(return_value=None)

    with patch("src.services.ailiveai_service.httpx.AsyncClient", return_value=mock_cm):
        svc = ailiveai_service.AiliveaiService()
        out = await svc.generate_video("hello", media_id="mid")

    assert out["video_url"] is None
    assert "TIMEOUT" in (out.get("error") or "")
    assert out["status"] == "failed"


@pytest.mark.asyncio
async def test_service_init_missing_key_generates_error_dict(monkeypatch):
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_API_KEY", "", raising=False)
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_API_TOKEN", "", raising=False)
    monkeypatch.setattr(ailiveai_service.settings, "AILIVEAI_BASE_URL", "https://api.example.test", raising=False)
    monkeypatch.setattr(
        type(ailiveai_service.settings),
        "resolved_ailiveai_api_key",
        lambda _self: "",
    )

    svc = ailiveai_service.AiliveaiService()
    out = await svc.generate_video("x", media_id="m1")
    assert out["video_url"] is None
    assert out["status"] == "failed"
    assert out["error"] == "NO_AILIVEAI_API_KEY"
