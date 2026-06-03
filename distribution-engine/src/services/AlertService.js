const { getPool } = require('../core/database');
const { resolveAlertAction } = require('./alertActions');

/**
 * Shared alerts table helpers (dedupe by message prefix, sync global/account alerts).
 */
class AlertService {
  async syncGlobalAlert(pool, messagePrefix, message, type = 'warning', active = true) {
    const prefixLike = `${messagePrefix}%`;
    if (!active) {
      await pool.query(
        `UPDATE alerts SET is_read = true
         WHERE is_read = false AND message LIKE $1`,
        [prefixLike],
      );
      return;
    }

    const existing = await pool.query(
      `SELECT id FROM alerts
       WHERE type = $1 AND is_read = false AND message LIKE $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [type, prefixLike],
    );

    const action = resolveAlertAction({ messagePrefix, message, type, accountId: null });

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE alerts SET message = $1, action_url = $2, action_label = $3, created_at = NOW() WHERE id = $4`,
        [message, action.action_url, action.action_label, existing.rows[0].id],
      );
      return;
    }

    await pool.query(
      `INSERT INTO alerts (id, type, message, action_url, action_label, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, false, NOW())`,
      [type, message, action.action_url, action.action_label],
    );
  }

  async syncAccountAlert(pool, accountId, messagePrefix, message, type = 'warning', active = true) {
    const prefixLike = `${messagePrefix}%`;
    if (!active) {
      await pool.query(
        `UPDATE alerts SET is_read = true
         WHERE account_id = $1 AND is_read = false AND message LIKE $2`,
        [accountId, prefixLike],
      );
      return;
    }

    const existing = await pool.query(
      `SELECT id FROM alerts
       WHERE account_id = $1 AND type = $2 AND is_read = false AND message LIKE $3
       LIMIT 1`,
      [accountId, type, prefixLike],
    );

    const action = resolveAlertAction({ messagePrefix, message, type, accountId });

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE alerts SET message = $1, action_url = $2, action_label = $3, created_at = NOW() WHERE id = $4`,
        [message, action.action_url, action.action_label, existing.rows[0].id],
      );
      return;
    }

    await pool.query(
      `INSERT INTO alerts (id, account_id, type, message, action_url, action_label, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false, NOW())`,
      [accountId, type, message, action.action_url, action.action_label],
    );
  }

  /** Critical one-off alerts (ban, action block) — always insert. */
  async recordAlert(accountId, type, message) {
    const pool = getPool();
    const action = resolveAlertAction({ message, type, accountId });
    await pool.query(
      `INSERT INTO alerts (id, account_id, type, message, action_url, action_label, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, false, NOW())`,
      [accountId, type, message, action.action_url, action.action_label],
    );
  }
}

module.exports = new AlertService();
