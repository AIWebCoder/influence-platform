import json
import logging
from datetime import datetime, timezone
from typing import Any

from prometheus_client import Counter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.publish_pipeline_log import log_publish_event, summarize_public_url
from src.services.publish_validation import (
    instagram_account_missing_fields,
    is_public_http_url,
)

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
                    primary_asset_id::text,
                    generation_job_id::text
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
            log_publish_event(
                "publish_dispatch_idempotent_already_queued",
                intent_id=str(intent[0]),
                publication_intent_status="queued",
                target_count=count,
                note="Dispatch skipped: intent already queued (no duplicate outbox flush).",
            )
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

        public_url = str(asset[1] or "").strip()
        if not is_public_http_url(public_url):
            raise ValueError(
                "Primary asset public_url must be a reachable http(s) URL for Instagram Graph API"
            )

        targets_res = await db.execute(
            text(
                """
                SELECT pt.id::text, pt.account_id::text, pt.platform,
                       COALESCE(a.ig_user_id, ''), COALESCE(a.ig_access_token, '')
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
            platform = str(target[2] or "").strip().lower()
            ig_user_id = str(target[3] or "").strip()
            ig_access_token = str(target[4] or "").strip()
            if platform in ("instagram", ""):
                missing = instagram_account_missing_fields(ig_user_id, ig_access_token)
                if missing:
                    raise ValueError(
                        f"Account {str(target[1])} missing Instagram publish fields: "
                        + ", ".join(missing)
                    )
            generation_job_id = str(intent[6] or "").strip() or None
            message = {
                "intent_id": str(intent[0]),
                "target_id": str(target[0]),
                "account_id": str(target[1]),
                "platform": str(target[2]),
                "ig_user_id": ig_user_id,
                "generation_job_id": generation_job_id,
                "content_type": str(intent[2]),
                "asset": {
                    "public_url": public_url,
                    "mime_type": str(asset[2]),
                },
                "caption": str(intent[3] or ""),
                "hashtags": hashtags,
                "created_at": created_at,
            }
            log_publish_event(
                "outbox_row_payload_built",
                intent_id=message["intent_id"],
                generation_job_id=generation_job_id,
                target_id=message["target_id"],
                account_id=message["account_id"],
                platform=message["platform"],
                ig_user_id=message["ig_user_id"],
                content_type=message["content_type"],
                asset_mime_type=message["asset"].get("mime_type"),
                asset_url_summary=summarize_public_url(str(asset[1])),
                caption_len=len(message["caption"] or ""),
                caption_preview=(message["caption"][:200] + "…") if len(message["caption"] or "") > 200 else message["caption"],
                hashtags=hashtags,
                queue_message=message,
            )
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

