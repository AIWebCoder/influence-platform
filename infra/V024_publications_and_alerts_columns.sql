-- Content Factory alerts API expects message + is_read (see alembic a1b2c3d4e5f6_add_alerts_table).
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_alerts_account ON alerts(account_id);
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);

-- Distribution-engine publications listings + /publications/stats + /queue/stats.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS failure_type VARCHAR(50);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS instagram_post_id TEXT;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS engagement_score DECIMAL(10,2);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_publications_published_at ON publications(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_publications_retry_count
  ON publications(retry_count) WHERE status IN ('failed', 'retrying');
CREATE INDEX IF NOT EXISTS idx_publications_failure_type ON publications(failure_type);
