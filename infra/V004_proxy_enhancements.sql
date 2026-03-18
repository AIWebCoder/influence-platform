-- ─────────────────────────────────────────
-- PHASE 15: Proxy Management System
-- Migration V004
-- ─────────────────────────────────────────

-- Add performance tracking columns to proxies
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS response_time INTEGER;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS success_rate DECIMAL(5,2) DEFAULT 100.00;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS total_requests INTEGER DEFAULT 0;

-- Indexes for performance-based sorting and filtering
CREATE INDEX IF NOT EXISTS idx_proxies_health ON proxies(is_active, response_time ASC);
CREATE INDEX IF NOT EXISTS idx_proxies_usage ON proxies(assigned_account_id);
