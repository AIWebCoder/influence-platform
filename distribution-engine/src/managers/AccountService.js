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

  async createAccount(
    username,
    password,
    status = 'warming',
    proxy = null,
    platform = 'instagram',
    igUserId = null,
    igAccessToken = null
  ) {
    const pool = getPool();
    const id = uuidv4();
    const salt = await bcrypt.genSalt(10);
    const passwordEncrypted = await bcrypt.hash(password, salt);
    const healthScore = 100;
    const plat = (platform || 'instagram').toLowerCase().trim() || 'instagram';
    const igUid = igUserId ? String(igUserId).trim() : null;
    const igTok = igAccessToken ? String(igAccessToken).trim() : null;

    const statusNorm = (status || 'warming').toLowerCase();
    const result = await pool.query(
      `INSERT INTO accounts (
         id, username, password_encrypted, status, health_score, metadata, platform,
         ig_user_id, ig_access_token, warmup_started_at, warmup_completed_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         CASE WHEN $4 = 'warming' THEN NOW() ELSE NULL END,
         CASE WHEN $4 = 'active' THEN NOW() ELSE NULL END
       )
       RETURNING id, username, status, health_score, metadata, platform, ig_user_id,
         (ig_access_token IS NOT NULL AND btrim(ig_access_token) <> '') AS ig_token_configured`,
      [
        id,
        username,
        passwordEncrypted,
        statusNorm,
        healthScore,
        JSON.stringify({ proxy: proxy || null }),
        plat,
        igUid,
        igTok,
      ]
    );
    return result.rows[0];
  }

  async updateInstagramCredentials(id, igUserId, igAccessToken) {
    const pool = getPool();
    const igUid = igUserId != null ? String(igUserId).trim() : null;
    const igTok = igAccessToken != null ? String(igAccessToken).trim() : null;
    const result = await pool.query(
      `UPDATE accounts
       SET ig_user_id = COALESCE($2, ig_user_id),
           ig_access_token = COALESCE($3, ig_access_token),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, username, status, platform, ig_user_id,
         (ig_access_token IS NOT NULL AND btrim(ig_access_token) <> '') AS ig_token_configured`,
      [id, igUid, igTok]
    );
    if (result.rows.length === 0) throw new Error('Account not found');
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
