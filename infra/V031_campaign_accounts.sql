-- Campaign ↔ account junction for RBAC and multi-account strategies.
CREATE TABLE IF NOT EXISTS campaign_accounts (
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_accounts_account_id ON campaign_accounts(account_id);

-- Backfill from legacy target_account_id column.
INSERT INTO campaign_accounts (campaign_id, account_id)
SELECT id, target_account_id
FROM campaigns
WHERE target_account_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill from settings.account_ids JSON array.
INSERT INTO campaign_accounts (campaign_id, account_id)
SELECT c.id, (elem)::uuid
FROM campaigns c,
LATERAL jsonb_array_elements_text(COALESCE(c.settings->'account_ids', '[]'::jsonb)) AS elem
WHERE elem ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;
