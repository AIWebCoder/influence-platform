"""Add visual_type column to content_packets

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-04-13 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'f6g7h8i9j0k1'
down_revision = 'e5f6g7h8i9j0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'content_packets',
        sa.Column('visual_type', sa.String(10), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('content_packets', 'visual_type')
