-- ─────────────────────────────────────────
-- PHASE 13: Publication Monitoring & Reliability
-- Migration V002
-- ─────────────────────────────────────────

-- Add new columns for retry tracking
ALTER TABLE publications ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS failure_type VARCHAR(50);

-- Expand status CHECK to include new states
ALTER TABLE publications DROP CONSTRAINT IF EXISTS publications_status_check;
ALTER TABLE publications ADD CONSTRAINT publications_status_check 
  CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'retry', 'permanently_failed', 'retrying'));

-- Index for retry queries
CREATE INDEX IF NOT EXISTS idx_publications_retry_count ON publications(retry_count) WHERE status IN ('failed', 'retrying');
CREATE INDEX IF NOT EXISTS idx_publications_failure_type ON publications(failure_type);
