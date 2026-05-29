-- A/B test definitions (V006 assumed this table already existed; Alembic never created it.)
CREATE TABLE IF NOT EXISTS ab_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    niche VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    winner VARCHAR(10),
    variant_a_config JSONB DEFAULT '{}'::jsonb,
    variant_b_config JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    last_winner_at TIMESTAMPTZ,
    sample_size_needed INTEGER DEFAULT 10,
    winning_er DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_started ON ab_tests(started_at DESC);
