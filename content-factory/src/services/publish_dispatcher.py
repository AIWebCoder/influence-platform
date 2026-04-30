import json
import logging
from datetime import datetime, timezone
from typing import Any

from prometheus_client import Counter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

PUBLISH_COMMANDS_QUEUE = "publish:commands"
logger = logging.getLogger(__name__)

PUBLISH_INTENT_DISPATCHED_TOTAL = Counter(
    "publish_intent_dispatched_total",
    "Total number of publish intents dispatched to outbox",
)
PUBLISH_INTENT_DISPATCH_FAILED_TOTAL = Counter(
    "publish_intent_dispatch_failed_total",
    "Total number of publish intent dispatch failures",
)


def _normalize_hashtags(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(x) for x in raw if isinstance(x, str)]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if isinstance(x, str)]
        except Exception:
            return []
    return []


async def dispatch_publish_intent(intent_id: str, db: AsyncSession) -> dict[str, Any]:
    try:
        intent_res = await db.execute(
            text(
                """
                SELECT
                    id::text,
                    status,
                    content_type,
                    caption,
                    hashtags,
                    primary_asset_id::text
                FROM publication_intents
                WHERE id = :intent_id
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"intent_id": intent_id},
        )
        intent = intent_res.first()
        if not intent:
            raise ValueError("Publish intent not found")

        current_status = str(intent[1])
        if current_status == "queued":
            count_res = await db.execute(
                text("SELECT COUNT(*)::int FROM publication_targets WHERE publication_intent_id = :intent_id"),
                {"intent_id": intent_id},
            )
            count = int(count_res.scalar_one() or 0)
            return {
                "intent_id": str(intent[0]),
                "status": "queued",
                "dispatched_targets": count,
            }
        if current_status != "ready":
            raise ValueError("Publish intent must be in ready status")

        primary_asset_id = str(intent[5]) if intent[5] else ""
        if not primary_asset_id:
            raise ValueError("Primary asset is missing")

        asset_res = await db.execute(
            text(
                """
                SELECT id::text, public_url, mime_type
                FROM generated_assets
                WHERE id = :asset_id
                LIMIT 1
                """
            ),
            {"asset_id": primary_asset_id},
        )
        asset = asset_res.first()
        if not asset:
            raise ValueError("Primary asset is missing")

        targets_res = await db.execute(
            text(
                """
                SELECT pt.id::text, pt.account_id::text, pt.platform, COALESCE(a.ig_user_id, '')
                FROM publication_targets pt
                JOIN accounts a ON a.id = pt.account_id
                WHERE publication_intent_id = :intent_id
                ORDER BY pt.created_at ASC
                """
            ),
            {"intent_id": intent_id},
        )
        targets = targets_res.fetchall()
        if not targets:
            raise ValueError("Publish intent has no targets")

        await db.execute(
            text(
                """
                UPDATE publication_targets
                SET status = 'pending',
                    updated_at = NOW()
                WHERE publication_intent_id = :intent_id
                  AND status IN ('pending', 'failed', 'uncertain')
                """
            ),
            {"intent_id": intent_id},
        )

        created_at = datetime.now(timezone.utc).isoformat()
        hashtags = _normalize_hashtags(intent[4])
        for target in targets:
            ig_user_id = str(target[3] or "").strip()
            if not ig_user_id:
                raise ValueError(f"Instagram user id missing for account {str(target[1])}")
            message = {
                "intent_id": str(intent[0]),
                "target_id": str(target[0]),
                "account_id": str(target[1]),
                "platform": str(target[2]),
                "ig_user_id": ig_user_id,
                "content_type": str(intent[2]),
                "asset": {
                    "public_url": str(asset[1]),
                    "mime_type": str(asset[2]),
                },
                "caption": str(intent[3] or ""),
                "hashtags": hashtags,
                "created_at": created_at,
            }
            await db.execute(
                text(
                    """
                    INSERT INTO publish_outbox (intent_id, target_id, payload_json, status)
                    VALUES (CAST(:intent_id AS uuid), CAST(:target_id AS uuid), :payload_json, 'pending')
                    ON CONFLICT (intent_id, target_id) DO UPDATE
                    SET payload_json = EXCLUDED.payload_json,
                        status = 'pending',
                        updated_at = NOW()
                    """
                ),
                {
                    "intent_id": str(intent[0]),
                    "target_id": str(target[0]),
                    "payload_json": json.dumps(message),
                },
            )

        await db.execute(
            text(
                """
                UPDATE publication_intents
                SET status = 'queued',
                    error_message = NULL,
                    updated_at = NOW()
                WHERE id = :intent_id
                  AND status = 'ready'
                """
            ),
            {"intent_id": intent_id},
        )

        await db.commit()
        PUBLISH_INTENT_DISPATCHED_TOTAL.inc()
        logger.info(
            "publish_dispatch_success intent_id=%s status=queued dispatched_targets=%s",
            str(intent[0]),
            len(targets),
        )
        return {
            "intent_id": str(intent[0]),
            "status": "queued",
            "dispatched_targets": len(targets),
        }
    except Exception as exc:
        PUBLISH_INTENT_DISPATCH_FAILED_TOTAL.inc()
        logger.error("publish_dispatch_failure intent_id=%s error=%s", intent_id, str(exc))
        await db.rollback()
        raise

