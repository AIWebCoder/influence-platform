-- Phase 19: Campaign Automation Engine

-- Campaign Types: growth, content, engagement
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- growth, content, engagement
    status VARCHAR(20) DEFAULT 'active', -- active, paused, completed
    target_niche VARCHAR(100),
    target_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}', -- thresholds, rules, specific targets
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tracking snapshots for campaigns
CREATE TABLE IF NOT EXISTS campaign_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
    snapshot_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    content_count INTEGER DEFAULT 0,
    total_engagement_rate DECIMAL(5,2) DEFAULT 0,
    total_followers_gained INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
