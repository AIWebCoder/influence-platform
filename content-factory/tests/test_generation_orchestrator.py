"""P1: orchestrator distribution step behavior."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.services.generation_orchestrator import _step_distribution


@pytest.mark.asyncio
async def test_distribution_skips_legacy_queue_in_publish_intents_mode(monkeypatch):
    monkeypatch.setattr(
        "src.services.generation_orchestrator.settings.GENERATION_DISTRIBUTION_MODE",
        "publish_intents",
    )

    job = MagicMock()
    job.id = "00000000-0000-0000-0000-000000000001"
    job.input_payload = {}
    job.output_url = "https://cdn.example.com/video.mp4"
    job.progress = 50
    job.steps = []

    step = MagicMock()
    step.step_metadata = None
    step.progress = 0

    db = AsyncMock()
    svc = MagicMock()

    with patch(
        "src.services.generation_orchestrator._abort_if_job_or_step_cancelling",
        AsyncMock(),
    ):
        with patch("src.services.generation_orchestrator.push_to_queue") as push_mock:
            with patch("src.services.generation_orchestrator.emit"):
                await _step_distribution(db, svc, job, step)

    push_mock.assert_not_called()
    assert step.step_metadata.get("skipped_legacy_queue") is True
    assert step.step_metadata.get("distribution_mode") == "publish_intents"
    assert step.progress == 100


@pytest.mark.asyncio
async def test_distribution_enqueues_legacy_queue_when_configured(monkeypatch):
    monkeypatch.setattr(
        "src.services.generation_orchestrator.settings.GENERATION_DISTRIBUTION_MODE",
        "legacy_queue",
    )
    monkeypatch.setattr(
        "src.services.generation_orchestrator.settings.CONTENT_QUEUE_NAME",
        "content:ready",
    )

    job = MagicMock()
    job.id = "00000000-0000-0000-0000-000000000002"
    job.input_payload = {
        "caption": "hi",
        "hashtags": ["#test"],
        "target_accounts": ["acc-1"],
        "content_type": "post",
    }
    job.output_url = "https://cdn.example.com/image.jpg"
    job.progress = 50
    job.steps = []

    step = MagicMock()
    step.step_metadata = None
    step.progress = 0

    db = AsyncMock()
    svc = MagicMock()

    with patch(
        "src.services.generation_orchestrator._abort_if_job_or_step_cancelling",
        AsyncMock(),
    ):
        with patch("src.services.generation_orchestrator.push_to_queue", AsyncMock()) as push_mock:
            with patch("src.services.generation_orchestrator.emit"):
                await _step_distribution(db, svc, job, step)

    push_mock.assert_awaited_once()
    assert step.step_metadata.get("queue") == "content:ready"
