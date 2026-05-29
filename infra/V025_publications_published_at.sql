ALTER TABLE publications ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_publications_published_at ON publications(published_at DESC);
