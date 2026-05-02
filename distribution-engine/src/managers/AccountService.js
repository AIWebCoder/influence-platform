const { getPool } = require('../core/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

class AccountService {
  async getAccounts(skip = 0, limit = 100) {
    const pool = getPool();
    const result = await pool.query(
      `
      SELECT
        a.id,
        a.username,
        a.status,
        a.health_score,
        a.metadata,
        a.created_at,
        COALESCE(NULLIF(TRIM(a.platform), ''), 'instagram') AS platform,
        COALESCE(
          NULLIF(TRIM(a.metadata->> 'proxy'), ''),
          CASE
            WHEN p.id IS NOT NULL THEN CONCAT('http://', p.host, ':', p.port::text)
            ELSE NULL
          END
        ) AS proxy_url
      FROM accounts a
      LEFT JOIN proxies p ON p.id = a.proxy_id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, skip]
    );
    return result.rows;
  }

  async createAccount(username, password, status = 'warming', proxy = null, platform = 'instagram') {
    const pool = getPool();
    const id = uuidv4();
    const salt = await bcrypt.genSalt(10);
    const passwordEncrypted = await bcrypt.hash(password, salt);
    const healthScore = 100;
    const plat = (platform || 'instagram').toLowerCase().trim() || 'instagram';

    const result = await pool.query(
      `INSERT INTO accounts (id, username, password_encrypted, status, health_score, metadata, platform)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, status, health_score, metadata, platform`,
      [id, username, passwordEncrypted, status, healthScore, JSON.stringify({ proxy: proxy || null }), plat]
    );
    return result.rows[0];
  }

  async deleteAccount(id) {
    const pool = getPool();
    const result = await pool.query('DELETE FROM accounts WHERE id = $1 RETURNING id', [id]);
    return result.rowCount > 0;
  }

  async updateAccountHealth(id, scoreChange, newStatus = null) {
    const pool = getPool();
    const res = await pool.query('SELECT health_score, status FROM accounts WHERE id = $1', [id]);
    if (res.rows.length === 0) throw new Error('Account not found');

    const curr = res.rows[0];
    let newScore = Math.max(0, Math.min(100, curr.health_score + scoreChange));
    const targetStatus = newStatus || curr.status;

    const updateRes = await pool.query(
      'UPDATE accounts SET health_score = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING id, health_score, status',
      [newScore, targetStatus, id]
    );
    return updateRes.rows[0];
  }

  async getAccountHealthDetails(id) {
    const pool = getPool();
    const SafetyGuard = require('../middleware/safetyGuard');
    
    const accountRes = await pool.query(
      'SELECT id, username, status, health_score, safe_mode, metadata, created_at FROM accounts WHERE id = $1',
      [id]
    );
    
    if (accountRes.rows.length === 0) throw new Error('Account not found');
    const account = accountRes.rows[0];

    const safety = await SafetyGuard.getAccountSafetyStatus(id);
    
    const alertsRes = await pool.query(
      'SELECT id, type, message, is_read, created_at FROM alerts WHERE account_id = $1 ORDER BY created_at DESC LIMIT 10',
      [id]
    );

    return {
      account,
      safety,
      alerts: alertsRes.rows
    };
  }
}

module.exports = new AccountService();
