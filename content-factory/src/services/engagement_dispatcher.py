import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.publish_validation import instagram_account_missing_fields

ENGAGEMENT_COMMANDS_QUEUE = "engagement:commands"
logger = logging.getLogger(__name__)

ACTION_TYPES = frozenset({"comment_like", "comment_reply", "dm_send"})
TARGET_TYPES = frozenset({"comment", "user", "thread"})


def _limit_action_type(action_type: str) -> str:
    """Map engagement action to account_actions limit bucket."""
    if action_type == "comment_like":
        return "comment_like"
    if action_type == "comment_reply":
        return "comment"
    if action_type == "dm_send":
        return "dm"
    return action_type


async def dispatch_engagement_intent(intent_id: str, db: AsyncSession) -> dict[str, Any]:
    intent_res = await db.execute(
        text(
            """
            SELECT
                ei.id::text,
                ei.status,
                ei.account_id::text,
                ei.platform,
                ei.action_type,
                ei.target_type,
                ei.target_id,
                ei.target_username,
                ei.parent_target_id,
                ei.message_text,
                ei.mode,
                ei.scheduled_for,
                COALESCE(a.ig_user_id, ''),
                COALESCE(a.ig_access_token, '')
            FROM engagement_intents ei
            JOIN accounts a ON a.id = ei.account_id
            WHERE ei.id = :intent_id
            LIMIT 1
            FOR UPDATE OF ei
            """
        ),
        {"intent_id": intent_id},
    )
    row = intent_res.first()
    if not row:
        raise ValueError("Engagement intent not found")

    current_status = str(row[1])
    if current_status == "queued":
        return {"intent_id": str(row[0]), "status": "queued", "note": "already_queued"}
    if current_status != "ready":
        raise ValueError("Engagement intent must be in ready status")

    action_type = str(row[5])
    if action_type == "comment_reply" and not str(row[10] or "").strip():
        raise ValueError("message_text is required for comment_reply")
    if action_type == "dm_send" and not str(row[10] or "").strip():
        raise ValueError("message_text is required for dm_send")

    ig_user_id = str(row[12] or "").strip()
    ig_access_token = str(row[13] or "").strip()
    platform = str(row[3] or "instagram").lower()
    if platform in ("instagram", ""):
        missing = instagram_account_missing_fields(ig_user_id, ig_access_token)
        if missing:
            raise ValueError(
                f"Account {str(row[2])} missing Instagram fields for engagement: " + ", ".join(missing)
            )

    scheduled_for = row[11]
    if scheduled_for is not None:
        now_utc = datetime.now(timezone.utc)
        sf = scheduled_for if scheduled_for.tzinfo else scheduled_for.replace(tzinfo=timezone.utc)
        if sf > now_utc:
            raise ValueError("Scheduled engagement intents are not dispatched yet; wait until scheduled_for")

    message = {
        "intent_id": str(row[0]),
        "account_id": str(row[2]),
        "platform": platform or "instagram",
        "ig_user_id": ig_user_id,
        "action_type": action_type,
        "limit_action_type": _limit_action_type(action_type),
        "target_type": str(row[6]),
        "target_id": str(row[7]),
        "target_username": str(row[8] or "") or None,
        "parent_target_id": str(row[9] or "") or None,
        "message_text": str(row[10] or "") or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db.execute(
        text(
            """
            INSERT INTO engagement_outbox (intent_id, payload_json, status)
            VALUES (CAST(:intent_id AS uuid), :payload_json, 'pending')
            ON CONFLICT (intent_id) DO UPDATE
            SET payload_json = EXCLUDED.payload_json,
                status = 'pending',
                updated_at = NOW()
            """
        ),
        {"intent_id": str(row[0]), "payload_json": json.dumps(message)},
    )
    await db.execute(
        text(
            """
            UPDATE engagement_intents
            SET status = 'queued',
                error_message = NULL,
                updated_at = NOW()
            WHERE id = :intent_id AND status = 'ready'
            """
        ),
        {"intent_id": intent_id},
    )
    await db.commit()
    logger.info("engagement_dispatch_success intent_id=%s action=%s", intent_id, action_type)
    return {"intent_id": str(row[0]), "status": "queued", "action_type": action_type}
