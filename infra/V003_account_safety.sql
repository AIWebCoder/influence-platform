-- ─────────────────────────────────────────
-- PHASE 14: Account Safety System
-- Migration V003
-- ─────────────────────────────────────────

-- Expand account statuses to include 'cooldown' and 'flagged'
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_status_check 
  CHECK (status IN ('active', 'inactive', 'warming', 'banned', 'suspended', 'shadowbanned', 'cooldown', 'flagged', 'resting'));

-- Add a safe_mode boolean to accounts to allow manual override/protection
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS safe_mode BOOLEAN DEFAULT true;

-- Ensure alerts has the right indexes for health dashboard
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
