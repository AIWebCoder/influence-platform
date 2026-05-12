import asyncio
import json
import logging

from prometheus_client import Counter
from sqlalchemy import text

from src.core.config import settings
from src.core.database import AsyncSessionLocal
from src.core.redis import push_to_queue
from src.services.publish_dispatcher import PUBLISH_COMMANDS_QUEUE
from src.services.publish_pipeline_log import log_publish_event

logger = logging.getLogger(__name__)
PUBLISH_OUTBOX_RECOVERED_TOTAL = Counter(
    "publish_outbox_recovered_total",
    "Total number of stale publish_outbox rows recovered to pending",
)
PUBLISH_OUTBOX_FLUSHED_TOTAL = Counter(
    "publish_outbox_flushed_total",
    "Total number of publish_outbox rows sent to redis publish queue",
)


async def _recover_stale_sent_rows() -> int:
    stale_seconds = max(60, int(settings.PUBLISH_OUTBOX_STALE_SENT_SECONDS))
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                text(
                    """
                    UPDATE publish_outbox po
                    SET status = 'pending',
                        updated_at = NOW()
                    FROM publication_targets pt
                    WHERE po.target_id = pt.id
                      AND po.status = 'sent'
                      AND pt.status = 'pending'
                      AND pt.retry_count = 0
                      AND po.updated_at < NOW() - (:stale_seconds::text || ' seconds')::interval
                    RETURNING po.id, po.intent_id, po.target_id
                    """
                ),
                {"stale_seconds": str(stale_seconds)},
            )
            rows = result.fetchall()
            recovered = len(rows)
    if recovered > 0:
        PUBLISH_OUTBOX_RECOVERED_TOTAL.inc(recovered)
        sample = [
            {
                "outbox_id": str(r[0]),
                "intent_id": str(r[1]) if r[1] is not None else None,
                "target_id": str(r[2]) if r[2] is not None else None,
            }
            for r in rows[:8]
        ]
        logger.warning(
            "publish_outbox recovered %s stale sent row(s) to pending (threshold=%ss) sample=%s",
            recovered,
            stale_seconds,
            sample,
        )
        for row in rows[:20]:
            log_publish_event(
                "publish_outbox_stale_sent_recovered",
                outbox_id=str(row[0]),
                intent_id=str(row[1]) if row[1] is not None else None,
                target_id=str(row[2]) if row[2] is not None else None,
                stale_seconds=stale_seconds,
                note="Outbox row reset to pending for re-flush; check duplicate-publish risk if worker also retried.",
            )
    return recovered


async def _flush_one_batch() -> int:
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                text(
                    """
                    SELECT id, payload_json
                    FROM publish_outbox
                    WHERE status = 'pending'
                    ORDER BY created_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """
                )
            )
            row = result.first()
            if not row:
                return 0
            ob_id, payload_json = row[0], row[1]
            await push_to_queue(PUBLISH_COMMANDS_QUEUE, payload_json)
            try:
                parsed = json.loads(payload_json) if isinstance(payload_json, str) else payload_json
            except Exception:
                parsed = None
            log_publish_event(
                "redis_publish_commands_push",
                redis_queue=PUBLISH_COMMANDS_QUEUE,
                outbox_row_id=str(ob_id),
                payload=parsed if isinstance(parsed, dict) else {"raw_preview": str(payload_json)[:500]},
            )
            await session.execute(
                text(
                    """
                    UPDATE publish_outbox
                    SET status = 'sent', updated_at = NOW()
                    WHERE id = :id
                    """
                ),
                {"id": str(ob_id)},
            )
            PUBLISH_OUTBOX_FLUSHED_TOTAL.inc()
            return 1


async def publish_outbox_runner(stop: asyncio.Event) -> None:
    interval = max(50, int(settings.PUBLISH_OUTBOX_POLL_INTERVAL_MS)) / 1000.0
    try:
        await _recover_stale_sent_rows()
    except Exception as exc:
        logger.exception("publish_outbox stale recovery failed: %s", exc)
    while not stop.is_set():
        try:
            n = 0
            while not stop.is_set():
                processed = await _flush_one_batch()
                if processed == 0:
                    break
                n += processed
            if n > 0:
                logger.info("publish_outbox flushed %s row(s)", n)
        except Exception as exc:
            logger.exception("publish_outbox_worker error: %s", exc)
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue