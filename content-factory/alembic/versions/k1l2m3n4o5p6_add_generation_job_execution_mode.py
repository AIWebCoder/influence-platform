"""Add generation_jobs.execution_mode

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-04-21 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "generation_jobs",
        sa.Column(
            "execution_mode",
            sa.String(length=32),
            nullable=False,
            server_default="scene_based",
        ),
    )
    op.create_index(
        "ix_generation_jobs_execution_mode",
        "generation_jobs",
        ["execution_mode"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_generation_jobs_execution_mode", table_name="generation_jobs")
    op.drop_column("generation_jobs", "execution_mode")
