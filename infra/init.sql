-- ─────────────────────────────────────────
-- INFLUENCE PLATFORM — Schema Initial
-- Phase 0 — Jour 1
-- ─────────────────────────────────────────

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────
-- CONTENT FACTORY TABLES
-- ─────────────────────────────────────────

CREATE TABLE niches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    hashtags JSONB DEFAULT '[]',
    posting_times JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    niche_id UUID REFERENCES niches(id),
    name VARCHAR(200) NOT NULL,
    caption_template TEXT NOT NULL,
    visual_prompt TEXT,
    hashtag_groups JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE content_packets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('post', 'story', 'reel', 'carousel')),
    caption TEXT,
    visual_url TEXT,
    visual_urls JSONB DEFAULT '[]',
    hashtags JSONB DEFAULT '[]',
    target_accounts JSONB DEFAULT '[]',
    scheduled_at TIMESTAMPTZ,
    niche VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'publishing', 'published', 'failed', 'cancelled')),
    metadata JSONB DEFAULT '{}',
    variant VARCHAR(5),
    template_id UUID REFERENCES templates(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_content_packets_status ON content_packets(status);
CREATE INDEX idx_content_packets_scheduled_at ON content_packets(scheduled_at);
CREATE INDEX idx_content_packets_niche ON content_packets(niche);

-- Generated assets (durable, reusable outputs from generation jobs)
CREATE TABLE IF NOT EXISTS generated_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE CASCADE,
    asset_type VARCHAR(20) NOT NULL CHECK (asset_type IN ('image', 'video', 'thumbnail')),
    storage_provider VARCHAR(20) NOT NULL,
    object_key TEXT NOT NULL,
    public_url TEXT NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    width INTEGER,
    height INTEGER,
    checksum_sha256 TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_assets_job_id ON generated_assets(generation_job_id);
CREATE INDEX IF NOT EXISTS idx_generated_assets_status ON generated_assets(status);

-- Publish intents (created from generation outputs; dispatch happens later)
CREATE TABLE IF NOT EXISTS publication_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    generation_job_id UUID REFERENCES generation_jobs(id) ON DELETE CASCADE,
    primary_asset_id UUID REFERENCES generated_assets(id) ON DELETE RESTRICT,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('reel', 'post', 'story')),
    caption TEXT,
    hashtags JSONB DEFAULT '[]',
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('publish_now', 'save_for_later', 'scheduled')),
    scheduled_for TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'ready', 'queued', 'published', 'partial_failed', 'failed')),
    platform_post_id TEXT,
    published_at TIMESTAMPTZ,
    error_message TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publication_intents_job_id ON publication_intents(generation_job_id);
CREATE INDEX IF NOT EXISTS idx_publication_intents_status ON publication_intents(status);

-- Per-account targets attached to an intent
CREATE TABLE IF NOT EXISTS publication_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_intent_id UUID REFERENCES publication_intents(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    platform VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'uncertain')),
    external_post_id TEXT,
    external_post_url TEXT,
    provider_container_id TEXT,
    publish_stage VARCHAR(50),
    last_error TEXT,
    published_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(publication_intent_id, account_id)
);

-- Publish command outbox (DB source of truth; Redis filled by background worker)
CREATE TABLE IF NOT EXISTS publish_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intent_id UUID NOT NULL REFERENCES publication_intents(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES publication_targets(id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (intent_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_publish_outbox_status_created ON publish_outbox (status, created_at);

-- ─────────────────────────────────────────
-- DISTRIBUTION ENGINE TABLES
-- ─────────────────────────────────────────

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) NOT NULL UNIQUE,
    password_encrypted TEXT NOT NULL,
    ig_access_token TEXT,
    ig_token_expires_at TIMESTAMPTZ,
    ig_user_id TEXT,
    email VARCHAR(200),
    proxy_id UUID,
    fingerprint JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'warming', 'banned', 'suspended')),
    health_score INTEGER DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
    warmup_started_at TIMESTAMPTZ,
    warmup_completed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    daily_post_count INTEGER DEFAULT 0,
    total_posts INTEGER DEFAULT 0,
    followers_count INTEGER DEFAULT 0,
    safe_mode BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proxies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    host VARCHAR(200) NOT NULL,
    port INTEGER NOT NULL,
    username VARCHAR(100),
    password_encrypted TEXT,
    provider VARCHAR(50),
    country VARCHAR(10),
    is_active BOOLEAN DEFAULT true,
    assigned_account_id UUID REFERENCES accounts(id),
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lier les proxies aux comptes
ALTER TABLE accounts ADD CONSTRAINT fk_proxy FOREIGN KEY (proxy_id) REFERENCES proxies(id);

CREATE TABLE publications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_packet_id UUID REFERENCES content_packets(id),
    account_id UUID REFERENCES accounts(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'retry')),
    instagram_post_id VARCHAR(200),
    published_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    engagement_score INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_publications_status ON publications(status);
CREATE INDEX idx_publications_account ON publications(account_id);
CREATE INDEX idx_publications_content ON publications(content_packet_id);

-- At most one row in "published" per (account, content_packet) - hard idempotency for live publishes
CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_unique_published_per_account_packet
    ON publications (account_id, content_packet_id)
    WHERE (status = 'published');

-- ─────────────────────────────────────────
-- ALERTS TABLE
-- ─────────────────────────────────────────

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES accounts(id),
    type VARCHAR(50) NOT NULL CHECK (type IN ('ban', 'shadowban', 'warning', 'action_block')),
    message TEXT,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_account ON alerts(account_id);
CREATE INDEX idx_alerts_is_read ON alerts(is_read);

-- Users (multi-user RBAC)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ix_users_email ON users(email);

-- Analytics events (engagement tracking)
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id UUID,
    niche VARCHAR(100) NOT NULL,
    content_type VARCHAR(50) NOT NULL,
    posting_hour INTEGER NOT NULL,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_analytics_niche ON analytics_events(niche);
CREATE INDEX idx_analytics_content_type ON analytics_events(content_type);

-- Add platform column to accounts (default: instagram)
DO $$ BEGIN
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS platform VARCHAR(20) DEFAULT 'instagram';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─────────────────────────────────────────
-- SEED DATA — Niches de base
-- ─────────────────────────────────────────

INSERT INTO niches (name, description, hashtags, posting_times) VALUES
('fitness', 'Sport, musculation, bien-être', '["#fitness", "#workout", "#gym", "#motivation", "#health"]', '[8, 12, 18]'),
('food', 'Cuisine, recettes, restaurants', '["#food", "#foodie", "#recipe", "#cooking", "#yummy"]', '[11, 13, 19]'),
('travel', 'Voyage, aventure, tourisme', '["#travel", "#wanderlust", "#explore", "#adventure", "#vacation"]', '[9, 15, 20]'),
('business', 'Entrepreneuriat, mindset, success', '["#business", "#entrepreneur", "#success", "#mindset", "#motivation"]', '[7, 12, 17]'),
('lifestyle', 'Mode de vie, luxe, quotidien', '["#lifestyle", "#daily", "#inspiration", "#living", "#goals"]', '[10, 14, 20]');

-- ─────────────────────────────────────────
-- UPDATED_AT triggers
-- ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_content_packets_updated_at
    BEFORE UPDATE ON content_packets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_publications_updated_at
    BEFORE UPDATE ON publications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_generated_assets_updated_at
    BEFORE UPDATE ON generated_assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_publication_intents_updated_at
    BEFORE UPDATE ON publication_intents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_publication_targets_updated_at
    BEFORE UPDATE ON publication_targets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_publish_outbox_updated_at
    BEFORE UPDATE ON publish_outbox
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- PHASE 11: Data Analytics
-- ─────────────────────────────────────────

-- Post Metrics (Task 11.1)
CREATE TABLE IF NOT EXISTS post_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publication_id UUID REFERENCES publications(id) ON DELETE CASCADE,
    content_packet_id UUID REFERENCES content_packets(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    instagram_post_id VARCHAR(200),
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    shares_count INTEGER DEFAULT 0,
    saves_count INTEGER DEFAULT 0,
    reach_estimate INTEGER,
    impressions INTEGER,
    engagement_rate FLOAT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_post_metrics_content ON post_metrics(content_packet_id);
CREATE INDEX idx_post_metrics_account ON post_metrics(account_id);
CREATE INDEX idx_post_metrics_recorded ON post_metrics(recorded_at);
CREATE INDEX IF NOT EXISTS idx_post_metrics_publication ON post_metrics(publication_id, recorded_at DESC);

-- Proxy Performance (Task 11.3)
CREATE TABLE IF NOT EXISTS proxy_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proxy_id UUID REFERENCES proxies(id) ON DELETE CASCADE,
    response_time_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    request_type VARCHAR(50), -- login, fetch, post, story
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_proxy_performance_proxy ON proxy_performance(proxy_id);
CREATE INDEX idx_proxy_performance_created ON proxy_performance(created_at);

-- Caption Performance (Task 11.4)
CREATE TABLE IF NOT EXISTS caption_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_packet_id UUID REFERENCES content_packets(id) ON DELETE CASCADE,
    caption_text TEXT,
    variant VARCHAR(5), -- A, B, etc.
    total_likes INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    total_engagement INTEGER DEFAULT 0,
    engagement_rate FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_caption_performance_content ON caption_performance(content_packet_id);
CREATE INDEX idx_caption_performance_variant ON caption_performance(variant);

-- A/B Tests
CREATE TABLE IF NOT EXISTS ab_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    niche VARCHAR(100),
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'paused')),
    variant_a_config JSONB,
    variant_b_config JSONB,
    winner VARCHAR(5), -- A or B
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ab_tests_status ON ab_tests(status);
CREATE INDEX idx_ab_tests_niche ON ab_tests(niche);

-- ─────────────────────────────────────────
-- PHASE 6: Production Hardening
-- ─────────────────────────────────────────

-- Account Actions Tracking (Task 6.6)
CREATE TABLE IF NOT EXISTS account_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    action_type VARCHAR(20) NOT NULL, -- like, follow, unfollow, comment, dm, post, story
    target_id VARCHAR(255),
    target_username VARCHAR(255),
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_account_actions_account_id ON account_actions(account_id);
CREATE INDEX idx_account_actions_type ON account_actions(action_type);
CREATE INDEX idx_account_actions_created_at ON account_actions(created_at);

-- Daily action counts for rate limiting (Task 6.1)
CREATE TABLE IF NOT EXISTS daily_action_counts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    action_type VARCHAR(20) NOT NULL,
    count INTEGER DEFAULT 0,
    date DATE NOT NULL,
    UNIQUE(account_id, action_type, date)
);

CREATE INDEX idx_daily_action_counts_date ON daily_action_counts(date);

-- Cooldown tracking (Task 6.2)
CREATE TABLE IF NOT EXISTS action_cooldowns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    action_type VARCHAR(20) NOT NULL,
    target_type VARCHAR(20) NOT NULL, -- user, hashtag, location
    target_id VARCHAR(255),
    cooldown_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_action_cooldowns_account ON action_cooldowns(account_id);
CREATE INDEX idx_action_cooldowns_until ON action_cooldowns(cooldown_until);

-- ─────────────────────────────────────────
-- PHASE 13: Publication Monitoring & Reliability
-- ─────────────────────────────────────────

-- Add retry tracking columns to publications
ALTER TABLE publications ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS failure_type VARCHAR(50);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Expand status CHECK to include new retry states
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_status_check;
ALTER TABLE publications ADD CONSTRAINT publications_status_check 
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'retry', 'permanently_failed', 'retrying'));

-- Indexes for retry queries
CREATE INDEX IF NOT EXISTS idx_publications_retry_count ON publications(retry_count) WHERE status IN ('failed', 'retrying');
CREATE INDEX IF NOT EXISTS idx_publications_failure_type ON publications(failure_type);
CREATE INDEX IF NOT EXISTS idx_publications_next_retry_at ON publications(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Intent / publication_targets → publications (monitoring)
ALTER TABLE publications ADD COLUMN IF NOT EXISTS publication_target_id UUID REFERENCES publication_targets(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_publications_publication_target_id
  ON publications (publication_target_id)
  WHERE publication_target_id IS NOT NULL;

