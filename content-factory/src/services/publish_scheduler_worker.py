"""Dispatch publication intents when scheduled_for is due."""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import text

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.services.publish_dispatcher import dispatch_publish_intent
from src.services.publish_pipeline_log import log_publish_event

logger = logging.getLogger(__name__)


async def _dispatch_due_batch(limit: int = 5) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text(
                """
                SELECT id::text
                FROM publication_intents
                WHERE mode = 'scheduled'
                  AND status = 'ready'
                  AND scheduled_for IS NOT NULL
                  AND scheduled_for <= NOW()
                ORDER BY scheduled_for ASC
                LIMIT :lim
                """
            ),
            {"lim": limit},
        )
        intent_ids = [str(r[0]) for r in result.fetchall()]

    dispatched = 0
    for intent_id in intent_ids:
        async with AsyncSessionLocal() as session:
            try:
                out = await dispatch_publish_intent(intent_id, session)
                log_publish_event(
                    "publish_scheduled_auto_dispatch",
                    intent_id=intent_id,
                    dispatch_response=out,
                )
                dispatched += 1
                logger.info(
                    "publish_scheduler dispatched intent_id=%s targets=%s",
                    intent_id,
                    out.get("dispatched_targets"),
                )
            except Exception as exc:
                logger.exception(
                    "publish_scheduler failed intent_id=%s error=%s",
                    intent_id,
                    exc,
                )
                log_publish_event(
                    "publish_scheduled_auto_dispatch_failed",
                    intent_id=intent_id,
                    error=str(exc),
                )
                try:
                    from src.services.alert_service import notify_publish_intent_failed

                    async with AsyncSessionLocal() as alert_session:
                        await notify_publish_intent_failed(alert_session, intent_id, str(exc))
                except Exception as alert_exc:
                    logger.warning("publish intent alert failed: %s", alert_exc)
    return dispatched


async def publish_scheduler_runner(stop: asyncio.Event) -> None:
    if not settings.PUBLISH_SCHEDULER_ENABLED:
        logger.info("publish_scheduler disabled (PUBLISH_SCHEDULER_ENABLED=false)")
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=60.0)
            except asyncio.TimeoutError:
                continue
        return

    interval = max(5.0, int(settings.PUBLISH_SCHEDULER_POLL_INTERVAL_MS) / 1000.0)
    logger.info("publish_scheduler started interval=%ss", interval)
    while not stop.is_set():
        try:
            n = await _dispatch_due_batch()
            if n > 0:
                logger.info("publish_scheduler dispatched %s due intent(s)", n)
        except Exception as exc:
            logger.exception("publish_scheduler_runner error: %s", exc)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
