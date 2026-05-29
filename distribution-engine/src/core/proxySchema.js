/**
 * Idempotent proxy table columns (V004 + V009 + usage metrics used by ProxyManager).
 * Runs on DE startup so existing DBs created from older init.sql still work.
 */
async function ensureProxySchema(pool) {
  const alters = [
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS username VARCHAR(100)',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS password_encrypted TEXT',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS provider VARCHAR(50)',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS country VARCHAR(10)',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS response_time INTEGER',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS success_rate DECIMAL(5,2) DEFAULT 100.00',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS total_requests INTEGER DEFAULT 0',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS total_response_time BIGINT DEFAULT 0',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ',
    "ALTER TABLE proxies ADD COLUMN IF NOT EXISTS proxy_type VARCHAR(16) DEFAULT 'http'",
    "ALTER TABLE proxies ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(16) DEFAULT 'credentials'",
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS rotation_hint VARCHAR(64)',
    'ALTER TABLE proxies ADD COLUMN IF NOT EXISTS session_id VARCHAR(128)',
  ];

  for (const sql of alters) {
    await pool.query(sql);
  }

  await pool.query("UPDATE proxies SET proxy_type = 'http' WHERE proxy_type IS NULL");
  await pool.query("UPDATE proxies SET auth_mode = 'credentials' WHERE auth_mode IS NULL");

  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_proxies_health ON proxies(is_active, response_time ASC)',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_proxies_usage ON proxies(assigned_account_id)',
  );
}

module.exports = { ensureProxySchema };