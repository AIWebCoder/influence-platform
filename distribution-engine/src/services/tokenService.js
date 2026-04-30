const { getPool } = require('../core/database');

const WARNING_WINDOW_DAYS = 7;
const WARNING_WINDOW_MS = WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

async function getValidToken(accountId) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT ig_access_token, ig_token_expires_at
     FROM accounts
     WHERE id = $1::uuid
     LIMIT 1`,
    [accountId]
  );

  if (result.rowCount === 0) {
    throw new Error(`Instagram token lookup failed: account not found (${accountId})`);
  }

  const row = result.rows[0];
  const token = String(row.ig_access_token || '').trim();
  if (!token) {
    throw new Error(`Instagram token missing for account ${accountId}`);
  }

  if (row.ig_token_expires_at) {
    const expiresAt = new Date(row.ig_token_expires_at);
    const msLeft = expiresAt.getTime() - Date.now();
    if (Number.isFinite(msLeft) && msLeft < WARNING_WINDOW_MS) {
      const daysLeft = Math.max(0, Math.floor(msLeft / (24 * 60 * 60 * 1000)));
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'distribution-engine',
          component: 'tokenService',
          event: 'instagram_token_expiring_soon',
          account_id: accountId,
          expires_at: expiresAt.toISOString(),
          days_left: daysLeft,
        })
      );
    }
  }

  return token;
}

module.exports = { getValidToken };
