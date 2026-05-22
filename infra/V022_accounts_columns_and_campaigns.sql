-- Align `accounts` with distribution-engine / dashboard (seed scripts expect these columns).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'inactive';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS health_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'instagram';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safe_mode BOOLEAN DEFAULT true;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_status_check
  CHECK (status IN (
    'active', 'inactive', 'warming', 'banned', 'suspended', 'shadowbanned',
    'cooldown', 'flagged', 'resting'
  ));

-- Phase 19 campaigns (from V007); many stacks never ran V007 on an old init.sql volume.
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    target_niche VARCHAR(100),
    target_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    snapshot_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    content_count INTEGER DEFAULT 0,
    total_engagement_rate DECIMAL(5,2) DEFAULT 0,
    total_followers_gained INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns;
CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
