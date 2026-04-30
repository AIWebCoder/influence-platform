const { getPool } = require('../core/database');

const NINE_AM_HOUR = 9;

async function runTokenExpiryCheck() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id::text, username, ig_token_expires_at
     FROM accounts
     WHERE ig_access_token IS NOT NULL
       AND btrim(ig_access_token) <> ''
       AND ig_token_expires_at IS NOT NULL
       AND ig_token_expires_at < NOW() + INTERVAL '7 days'
     ORDER BY ig_token_expires_at ASC`
  );

  for (const row of result.rows) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'distribution-engine',
        component: 'token-expiry-monitor',
        event: 'instagram_token_expiring_soon',
        account_id: row.id,
        username: row.username,
        expires_at: new Date(row.ig_token_expires_at).toISOString(),
        // TODO: integrate email/Slack alerting for expiring Instagram tokens.
      })
    );
  }
}

function msUntilNext9am(now = new Date()) {
  const next = new Date(now);
  next.setHours(NINE_AM_HOUR, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

function startTokenExpiryCron() {
  const scheduleNext = () => {
    const delay = msUntilNext9am();
    setTimeout(async () => {
      try {
        await runTokenExpiryCheck();
      } catch (err) {
        console.error('[token-expiry-monitor] scheduled check failed:', err.message);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
  console.log('[token-expiry-monitor] scheduled daily check at 09:00 server time');
}

module.exports = { startTokenExpiryCron, runTokenExpiryCheck };
