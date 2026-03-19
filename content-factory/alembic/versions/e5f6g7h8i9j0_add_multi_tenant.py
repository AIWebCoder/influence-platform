"""Add multi-tenant architecture (organizations, subscriptions, usage)

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-18 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = 'e5f6g7h8i9j0'
down_revision = 'd4e5f6g7h8i9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'organizations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(100), unique=True, nullable=False),
        sa.Column('plan', sa.String(20), nullable=False, server_default='free'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('stripe_customer_id', sa.String(100), unique=True, nullable=True),
        sa.Column('stripe_subscription_id', sa.String(100), unique=True, nullable=True),
        sa.Column('subscription_status', sa.String(20), nullable=True),
        sa.Column('subscription_expires_at', sa.DateTime(), nullable=True),
        sa.Column('max_accounts', sa.Integer(), server_default='5'),
        sa.Column('max_posts_per_month', sa.Integer(), server_default='100'),
        sa.Column('max_users', sa.Integer(), server_default='3'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('trial_ends_at', sa.DateTime(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true')),
    )
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)
    
    op.add_column('users', sa.Column('organization_id', UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=True))
    op.create_index('ix_users_organization_id', 'users', ['organization_id'])
    
    op.create_table(
        'subscriptions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('organization_id', UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('plan', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('stripe_subscription_id', sa.String(100), unique=True, nullable=True),
        sa.Column('stripe_price_id', sa.String(100), nullable=True),
        sa.Column('current_period_start', sa.DateTime(), nullable=False),
        sa.Column('current_period_end', sa.DateTime(), nullable=False),
        sa.Column('cancel_at_period_end', sa.Boolean(), server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_subscriptions_organization_id', 'subscriptions', ['organization_id'])
    
    op.create_table(
        'usage_records',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('organization_id', UUID(as_uuid=True), sa.ForeignKey('organizations.id'), nullable=False),
        sa.Column('resource_type', sa.String(50), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('period_start', sa.DateTime(), nullable=False),
        sa.Column('period_end', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index('ix_usage_records_organization_id', 'usage_records', ['organization_id'])
    op.create_index('ix_usage_records_period', 'usage_records', ['period_start', 'period_end'])


def downgrade() -> None:
    op.drop_index('ix_usage_records_period', table_name='usage_records')
    op.drop_index('ix_usage_records_organization_id', table_name='usage_records')
    op.drop_table('usage_records')
    
    op.drop_index('ix_subscriptions_organization_id', table_name='subscriptions')
    op.drop_table('subscriptions')
    
    op.drop_index('ix_users_organization_id', table_name='users')
    op.drop_column('users', 'organization_id')
    
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_table('organizations')
