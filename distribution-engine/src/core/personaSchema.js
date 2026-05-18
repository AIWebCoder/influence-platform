/**
 * Idempotent persona tables (V010). Runs on DE startup for existing databases.
 */
const fs = require('fs');
const path = require('path');

async function ensurePersonaSchema(pool) {
  const migrationPath = path.join(__dirname, '../../sql/V021_personas.sql');
  if (fs.existsSync(migrationPath)) {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    return;
  }

  // Minimal fallback if migration file missing in container
  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(120) NOT NULL,
      proxy_id UUID REFERENCES proxies(id) ON DELETE SET NULL,
      timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
      locale VARCHAR(16) NOT NULL DEFAULT 'fr-FR',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      risk_score INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS persona_id UUID');
}

module.exports = { ensurePersonaSchema };
