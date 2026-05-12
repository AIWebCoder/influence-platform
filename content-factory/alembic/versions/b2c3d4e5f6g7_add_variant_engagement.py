"""Add variant and engagement_score columns

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    content_packet_columns = {col["name"] for col in inspector.get_columns('content_packets')}
    if 'variant' not in content_packet_columns:
        op.add_column('content_packets', sa.Column('variant', sa.String(5), nullable=True))

    publication_columns = {col["name"] for col in inspector.get_columns('publications')}
    if 'engagement_score' not in publication_columns:
        op.add_column('publications', sa.Column('engagement_score', sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    publication_columns = {col["name"] for col in inspector.get_columns('publications')}
    if 'engagement_score' in publication_columns:
        op.drop_column('publications', 'engagement_score')

    content_packet_columns = {col["name"] for col in inspector.get_columns('content_packets')}
    if 'variant' in content_packet_columns:
        op.drop_column('content_packets', 'variant')
