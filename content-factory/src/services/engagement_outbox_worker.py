import asyncio
import json
import logging

from sqlalchemy import text

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.redis import push_to_queue
from src.services.engagement_dispatcher import ENGAGEMENT_COMMANDS_QUEUE

logger = logging.getLogger(__name__)


async def _flush_one_batch() -> int:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                text(
                    """
                    SELECT eo.id, eo.payload_json, ei.scheduled_for, ei.mode
                    FROM engagement_outbox eo
                    JOIN engagement_intents ei ON ei.id = eo.intent_id
                    WHERE eo.status = 'pending'
                      AND ei.status = 'queued'
                      AND (
                        ei.mode = 'execute_now'
                        OR ei.scheduled_for IS NULL
                        OR ei.scheduled_for <= NOW()
                      )
                    ORDER BY eo.created_at ASC
                    LIMIT 1
                    FOR UPDATE OF eo SKIP LOCKED
                    """
                )
            )
            row = result.first()
            if not row:
                return 0
            ob_id, payload_json = row[0], row[1]
            await push_to_queue(ENGAGEMENT_COMMANDS_QUEUE, payload_json)
            await session.execute(
                text(
                    """
                    UPDATE engagement_outbox
                    SET status = 'sent', updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": str(ob_id)},
            )
            return 1


async def engagement_outbox_runner(stop: asyncio.Event) -> None:
    interval = max(
        50,
        int(getattr(settings, "ENGAGEMENT_OUTBOX_POLL_INTERVAL_MS", settings.PUBLISH_OUTBOX_POLL_INTERVAL_MS)),
    ) / 1000.0
    while not stop.is_set():
        try:
            n = 0
            while not stop.is_set():
                processed = await _flush_one_batch()
                if processed == 0:
                    break
                n += processed
            if n > 0:
                logger.info("engagement_outbox flushed %s row(s)", n)
        except Exception as exc:
            logger.exception("engagement_outbox_worker error: %s", exc)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
