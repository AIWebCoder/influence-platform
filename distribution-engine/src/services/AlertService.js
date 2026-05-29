const { getPool } = require('../core/database');

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

    if (existing.rows.length > 0) {
      await pool.query(`UPDATE alerts SET message = $1, created_at = NOW() WHERE id = $2`, [
        message,
        existing.rows[0].id,
      ]);
      return;
    }

    await pool.query(
      `INSERT INTO alerts (id, type, message, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, false, NOW())`,
      [type, message],
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

    if (existing.rows.length > 0) {
      await pool.query(`UPDATE alerts SET message = $1, created_at = NOW() WHERE id = $2`, [
        message,
        existing.rows[0].id,
      ]);
      return;
    }

    await pool.query(
      `INSERT INTO alerts (id, account_id, type, message, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())`,
      [accountId, type, message],
    );
  }

  /** Critical one-off alerts (ban, action block) — always insert. */
  async recordAlert(accountId, type, message) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO alerts (id, account_id, type, message, is_read, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())`,
      [accountId, type, message],
    );
  }
}

module.exports = new AlertService();
