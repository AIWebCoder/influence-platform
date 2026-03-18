"""Add variant and engagement_score columns

Revision ID: b2c3d4e5f6g7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6g7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('content_packets', sa.Column('variant', sa.String(5), nullable=True))
    op.add_column('publications', sa.Column('engagement_score', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('publications', 'engagement_score')
    op.drop_column('content_packets', 'variant')
