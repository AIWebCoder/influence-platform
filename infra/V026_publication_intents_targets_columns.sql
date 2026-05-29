-- Align publication_intents / publication_targets with infra/V016_bootstrap_publish_tables.sql
-- (legacy DBs often have minimal stubs without caption, mode, platform, etc.)

ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS hashtags JSONB DEFAULT '[]'::jsonb;
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'publish_now';
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS platform_post_id TEXT;
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE publication_intents ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS platform VARCHAR(30) NOT NULL DEFAULT 'instagram';
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS external_post_id TEXT;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS external_post_url TEXT;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;

CREATE INDEX IF NOT EXISTS idx_publication_intents_job_id ON publication_intents(generation_job_id);
CREATE INDEX IF NOT EXISTS idx_publication_intents_status ON publication_intents(status);
CREATE INDEX IF NOT EXISTS idx_publication_targets_intent_id ON publication_targets(publication_intent_id);
