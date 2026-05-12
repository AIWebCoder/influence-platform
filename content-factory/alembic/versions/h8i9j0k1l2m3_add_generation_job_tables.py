"""Add generation_jobs, generation_steps, generation_scenes

Revision ID: h8i9j0k1l2m3
Revises: f6g7h8i9j0k1
Create Date: 2026-04-13 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision = "h8i9j0k1l2m3"
down_revision = "f6g7h8i9j0k1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generation_jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_payload", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("output_url", sa.Text(), nullable=True),
        sa.Column("logs", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_generation_jobs_status", "generation_jobs", ["status"])

    op.create_table(
        "generation_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_name", sa.String(64), nullable=False),
        sa.Column("step_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("metadata", JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_generation_steps_job_id", "generation_steps", ["job_id"])
    op.create_index("ix_generation_steps_status", "generation_steps", ["status"])
    op.create_unique_constraint(
        "uq_generation_steps_job_step",
        "generation_steps",
        ["job_id", "step_name"],
    )

    op.create_table(
        "generation_scenes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scene_index", sa.Integer(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("duration", sa.Integer(), nullable=False),
        sa.Column("scene_role", sa.String(32), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("start_image_url", sa.Text(), nullable=True),
        sa.Column("end_image_url", sa.Text(), nullable=True),
        sa.Column("video_url", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_generation_scenes_job_id", "generation_scenes", ["job_id"])
    op.create_index("ix_generation_scenes_status", "generation_scenes", ["status"])


def downgrade() -> None:
    op.drop_index("ix_generation_scenes_status", table_name="generation_scenes")
    op.drop_index("ix_generation_scenes_job_id", table_name="generation_scenes")
    op.drop_table("generation_scenes")

    op.drop_constraint("uq_generation_steps_job_step", "generation_steps", type_="unique")
    op.drop_index("ix_generation_steps_status", table_name="generation_steps")
    op.drop_index("ix_generation_steps_job_id", table_name="generation_steps")
    op.drop_table("generation_steps")

    op.drop_index("ix_generation_jobs_status", table_name="generation_jobs")
    op.drop_table("generation_jobs")
