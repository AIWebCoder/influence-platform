-- ─────────────────────────────────────────
-- PHASE 16: Advanced Analytics Engine
-- Migration V005
-- Canonical post_metrics shape lives in init.sql (content_packet_id + publication_id + counts).
-- This file only adds follower growth + aligns existing DBs.
-- ─────────────────────────────────────────

-- Link metrics rows to publications when upgrading older DBs (idempotent)
ALTER TABLE post_metrics ADD COLUMN IF NOT EXISTS publication_id UUID REFERENCES publications(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_post_metrics_publication ON post_metrics(publication_id, recorded_at DESC);

-- Track follower count and engagement trends for accounts
CREATE TABLE IF NOT EXISTS account_growth (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    posts_count INTEGER DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_growth_acc ON account_growth(account_id, recorded_at DESC);
