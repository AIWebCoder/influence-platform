/**
 * Idempotent accounts columns expected by accountsRouter / AccountService / token flows.
 * Keeps older DB volumes (from early init.sql) working after code updates.
 */
async function ensureAccountSchema(pool) {
  const alters = [
    'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ig_access_token TEXT',
    'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ig_token_expires_at TIMESTAMPTZ',
    'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ig_user_id TEXT',
    'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS warmup_started_at TIMESTAMPTZ',
    'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS warmup_completed_at TIMESTAMPTZ',
  ];

  for (const sql of alters) {
    await pool.query(sql);
  }
}

module.exports = { ensureAccountSchema };
