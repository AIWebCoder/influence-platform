-- ─────────────────────────────────────────
-- PHASE 17: A/B Testing System
-- Migration V006
-- ─────────────────────────────────────────

-- Refine caption_performance to link directly to ab_tests
ALTER TABLE caption_performance ADD COLUMN IF NOT EXISTS ab_test_id UUID REFERENCES ab_tests(id) ON DELETE CASCADE;

-- Add tracking columns to ab_tests
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS last_winner_at TIMESTAMPTZ;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS sample_size_needed INTEGER DEFAULT 10;
ALTER TABLE ab_tests ADD COLUMN IF NOT EXISTS winning_er DECIMAL(5,2);

-- Ensure caption_performance has likes and comments from Phase 16 alignment
DO $$ BEGIN
    ALTER TABLE caption_performance ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
    ALTER TABLE caption_performance ADD COLUMN IF NOT EXISTS comments INTEGER DEFAULT 0;
    ALTER TABLE caption_performance ADD COLUMN IF NOT EXISTS reach INTEGER DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Better indexing for variant lookup within tests
CREATE INDEX IF NOT EXISTS idx_caption_perf_test ON caption_performance(ab_test_id);
