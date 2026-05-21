"""Add engagement_intents and engagement_outbox tables

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-05-20 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "engagement_intents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("account_id", UUID(as_uuid=True), sa.ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("platform", sa.String(30), nullable=False, server_default="instagram"),
        sa.Column("action_type", sa.String(30), nullable=False),
        sa.Column("target_type", sa.String(30), nullable=False, server_default="comment"),
        sa.Column("target_id", sa.String(255), nullable=False),
        sa.Column("target_username", sa.String(255), nullable=True),
        sa.Column("parent_target_id", sa.String(255), nullable=True),
        sa.Column("message_text", sa.Text(), nullable=True),
        sa.Column("mode", sa.String(20), nullable=False, server_default="execute_now"),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="ready"),
        sa.Column("external_result_id", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "action_type IN ('comment_like', 'comment_reply', 'dm_send')",
            name="ck_engagement_intents_action_type",
        ),
        sa.CheckConstraint(
            "target_type IN ('comment', 'user', 'thread')",
            name="ck_engagement_intents_target_type",
        ),
        sa.CheckConstraint(
            "mode IN ('execute_now', 'scheduled')",
            name="ck_engagement_intents_mode",
        ),
        sa.CheckConstraint(
            "status IN ('ready', 'queued', 'processing', 'completed', 'failed')",
            name="ck_engagement_intents_status",
        ),
    )
    op.create_index("idx_engagement_intents_account", "engagement_intents", ["account_id"])
    op.create_index("idx_engagement_intents_status", "engagement_intents", ["status"])
    op.create_index("idx_engagement_intents_action", "engagement_intents", ["action_type"])
    op.create_unique_constraint("uq_engagement_intents_idempotency", "engagement_intents", ["idempotency_key"])

    op.create_table(
        "engagement_outbox",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("intent_id", UUID(as_uuid=True), sa.ForeignKey("engagement_intents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("NOW()")),
        sa.CheckConstraint("status IN ('pending', 'sent')", name="ck_engagement_outbox_status"),
    )
    op.create_index("idx_engagement_outbox_status_created", "engagement_outbox", ["status", "created_at"])
    op.create_unique_constraint("uq_engagement_outbox_intent", "engagement_outbox", ["intent_id"])


def downgrade() -> None:
    op.drop_table("engagement_outbox")
    op.drop_table("engagement_intents")
