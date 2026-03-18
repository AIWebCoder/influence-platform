-- ─────────────────────────────────────────
-- PHASE 16: Advanced Analytics Engine
-- Migration V005
-- ─────────────────────────────────────────

-- Track statistics for each publication over time
CREATE TABLE IF NOT EXISTS post_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_id UUID NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    engagement_rate DECIMAL(5,2),
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track follower count and engagement trends for accounts
CREATE TABLE IF NOT EXISTS account_growth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast timeseries retrieval
CREATE INDEX IF NOT EXISTS idx_post_metrics_pub ON post_metrics(publication_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_growth_acc ON account_growth(account_id, recorded_at DESC);
