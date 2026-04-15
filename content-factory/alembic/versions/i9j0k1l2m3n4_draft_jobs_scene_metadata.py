"""Draft job default status + scene_metadata JSONB

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-13 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "generation_scenes",
        sa.Column("scene_metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.alter_column(
        "generation_jobs",
        "status",
        server_default="draft",
    )


def downgrade() -> None:
    op.alter_column("generation_jobs", "status", server_default="pending")
    op.drop_column("generation_scenes", "scene_metadata")
