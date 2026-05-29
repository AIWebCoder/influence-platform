const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const AccountService = require('./AccountService');
const { getPool } = require('../core/database');

const PROXY_STRICT_ONE_TO_ONE = process.env.PROXY_STRICT_ONE_TO_ONE !== 'false';

function decryptProxyPassword(passwordEncrypted) {
  if (!passwordEncrypted) return null;
  // Backward-compatible path: treat as plaintext when no ENC envelope is used.
  if (!passwordEncrypted.startsWith('ENC:')) return passwordEncrypted;

  const keyRaw = process.env.PROXY_CREDENTIALS_KEY || '';
  if (!keyRaw) {
    throw new Error('PROXY_CREDENTIALS_KEY is required for encrypted proxy credentials');
  }
  const key = crypto.createHash('sha256').update(keyRaw).digest();
  const payload = passwordEncrypted.slice(4);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted proxy password format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

// Obtenir tous les comptes
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        a.id,
        a.username,
        a.status,
        a.health_score,
        a.metadata,
        a.created_at,
        COALESCE(NULLIF(TRIM(a.platform), ''), 'instagram') AS platform,
        a.persona_id,
        a.ig_user_id,
        (a.ig_access_token IS NOT NULL AND btrim(a.ig_access_token) <> '') AS ig_token_configured,
        (
          COALESCE(NULLIF(TRIM(a.ig_user_id), ''), '') <> ''
          AND a.ig_access_token IS NOT NULL
          AND btrim(a.ig_access_token) <> ''
        ) AS ig_publish_ready,
        COALESCE(
          NULLIF(TRIM(a.metadata->> 'proxy'), ''),
          CASE
            WHEN p.id IS NOT NULL THEN CONCAT('http://', p.host, ':', p.port::text)
            ELSE NULL
          END
        ) AS proxy_url
      FROM accounts a
      LEFT JOIN proxies p ON p.id = a.proxy_id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur GET /accounts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /accounts/bulk — import many Instagram accounts (V1: instagram only, strict 1:1 proxy each).
 * Body: { accounts: [{ username, password_encrypted, status?, ig_user_id?, ig_access_token? }] }
 */
router.post('/bulk', async (req, res) => {
  const items = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
  if (items.length === 0) {
    return res.status(400).json({ error: 'accounts array is required' });
  }
  if (items.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 accounts per bulk request' });
  }

  const ProxyManager = require('../proxy/ProxyManager');
  const capacity = await ProxyManager.getPoolCapacity();
  if (PROXY_STRICT_ONE_TO_ONE && capacity.slots_available < items.length) {
    return res.status(503).json({
      error: 'Insufficient unassigned proxies for strict 1:1 policy',
      slots_available: capacity.slots_available,
      requested: items.length,
    });
  }

  const created = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i] || {};
    const username = String(row.username || '').trim();
    const password = String(row.password_encrypted || row.password || '').trim();
    if (!username || !password) {
      failed.push({ index: i, username: username || null, error: 'username and password are required' });
      continue;
    }
    try {
      const account = await AccountService.createAccount(
        username,
        password,
        (row.status || 'warming').toLowerCase(),
        null,
        'instagram',
        row.ig_user_id,
        row.ig_access_token
      );
      await ProxyManager.assignProxyToAccount(account.id);
      created.push({ id: account.id, username: account.username });
    } catch (err) {
      failed.push({ index: i, username, error: err.message });
    }
  }

  return res.status(created.length > 0 ? 201 : 400).json({
    created_count: created.length,
    failed_count: failed.length,
    created,
    failed,
  });
});

router.get('/:id', async (req, res) => {
  try {
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
        a.persona_id,
        a.ig_user_id,
        (a.ig_access_token IS NOT NULL AND btrim(a.ig_access_token) <> '') AS ig_token_configured,
        (
          COALESCE(NULLIF(TRIM(a.ig_user_id), ''), '') <> ''
          AND a.ig_access_token IS NOT NULL
          AND btrim(a.ig_access_token) <> ''
        ) AS ig_publish_ready,
        COALESCE(
          NULLIF(TRIM(a.metadata->> 'proxy'), ''),
          CASE
            WHEN p.id IS NOT NULL THEN CONCAT('http://', p.host, ':', p.port::text)
            ELSE NULL
          END
        ) AS proxy_url
      FROM accounts a
      LEFT JOIN proxies p ON p.id = a.proxy_id
      WHERE a.id = $1
      `,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erreur GET /accounts/:id:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:id/safety', async (req, res) => {
  try {
    const details = await AccountService.getAccountHealthDetails(req.params.id);
    res.json(details);
  } catch (error) {
    console.error('Erreur GET /accounts/:id/safety:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/proxy-credentials', async (req, res) => {
  try {
    const pool = getPool();
    const exists = await pool.query('SELECT id FROM accounts WHERE id = $1', [req.params.id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const PersonaService = require('../persona/personaService');
    const payload = await PersonaService.getProxyCredentialsPayload(req.params.id);
    return res.json(payload);
  } catch (err) {
    const status = err.statusCode === 404 ? 404 : 500;
    return res.status(status).json({ error: 'Failed to fetch proxy credentials', details: err.message });
  }
});

router.post('/:id/proxy/rotate', async (req, res) => {
  try {
    const accountId = req.params.id;
    const ProxyManager = require('../proxy/ProxyManager');
    const result = await ProxyManager.rotateProxyForAccount(accountId);
    return res.json({ success: true, account_id: accountId, proxy_id: result.proxy_id });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to rotate proxy', details: err.message });
  }
});

/** Assign a dedicated proxy to an existing account (auto-pick or explicit proxy_id). */
router.post('/:id/proxy/assign', async (req, res) => {
  try {
    const accountId = req.params.id;
    const pool = getPool();
    const exists = await pool.query('SELECT id FROM accounts WHERE id = $1', [accountId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const ProxyManager = require('../proxy/ProxyManager');
    const proxyId = req.body?.proxy_id ? String(req.body.proxy_id).trim() : null;
    const result = proxyId
      ? await ProxyManager.assignSpecificProxyToAccount(accountId, proxyId)
      : await ProxyManager.assignProxyToAccount(accountId);

    const withProxy = await pool.query(
      `SELECT a.id, a.username, a.status, a.health_score, a.platform, a.ig_user_id,
              (a.ig_access_token IS NOT NULL AND btrim(a.ig_access_token) <> '') AS ig_token_configured,
              (
                COALESCE(NULLIF(TRIM(a.ig_user_id), ''), '') <> ''
                AND a.ig_access_token IS NOT NULL
                AND btrim(a.ig_access_token) <> ''
              ) AS ig_publish_ready,
              CASE WHEN p.id IS NOT NULL THEN CONCAT(p.host, ':', p.port::text) ELSE NULL END AS proxy_url
       FROM accounts a
       LEFT JOIN proxies p ON p.id = a.proxy_id
       WHERE a.id = $1`,
      [accountId]
    );
    return res.json({
      success: true,
      account_id: accountId,
      proxy_id: result.proxy_id,
      proxy_url: result.proxy_url,
      account: withProxy.rows[0],
    });
  } catch (err) {
    const msg = err.message || 'Failed to assign proxy';
    const status = msg.includes('not found')
      ? 404
      : msg.includes('No unassigned') || msg.includes('already assigned')
        ? 503
        : 400;
    return res.status(status).json({ error: 'Failed to assign proxy', details: msg });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: 'status is required' });
    }
    const allowed = new Set(['warming', 'active', 'inactive', 'shadowbanned', 'banned']);
    const normalized = String(status).toLowerCase().trim();
    if (!allowed.has(normalized)) {
      return res.status(400).json({ error: 'Invalid status', allowed: [...allowed] });
    }
    const pool = getPool();
    const result = await pool.query(
      `UPDATE accounts SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, username, status, health_score, platform`,
      [normalized, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update account', details: err.message });
  }
});

// POST /accounts/:id/execute — action completion callback from emulator-controller
router.post('/:id/execute', async (req, res) => {
  try {
    const pool = getPool();
    const accountId = req.params.id;
    const actor = req.user?.sub || req.user?.email || req.user?.username || 'unknown';
    const {
      action_type,
      success = true,
      target_id = null,
      target_username = null,
      error = null,
      metadata = {},
    } = req.body || {};

    if (!action_type) {
      return res.status(400).json({ error: 'action_type is required' });
    }

    const result = await pool.query(
      `INSERT INTO account_actions (
        account_id, action_type, target_id, target_username, success, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, account_id, action_type, success, created_at`,
      [accountId, action_type, target_id, target_username, !!success, error]
    );

    return res.status(201).json({
      ...result.rows[0],
      executed_by: actor,
      metadata,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to record action execution',
      details: err.message,
    });
  }
});

/** V1 product scope: Instagram Graph publish only. */
const ALLOWED_PLATFORMS = new Set(['instagram']);

router.post('/', async (req, res) => {
  try {
    const {
      username,
      password_encrypted,
      status,
      metadata,
      platform: rawPlatform,
      ig_user_id: igUserId,
      ig_access_token: igAccessToken,
    } = req.body;
    if (!username || !password_encrypted) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const proxyUrl = metadata?.proxy || null;
    const accountStatus = status || 'warming';
    const platformToken = (rawPlatform || 'instagram').toLowerCase().trim() || 'instagram';
    if (!ALLOWED_PLATFORMS.has(platformToken)) {
      return res.status(400).json({
        error: 'Invalid platform',
        detail: `platform must be one of: ${[...ALLOWED_PLATFORMS].join(', ')}`,
      });
    }
    const account = await AccountService.createAccount(
      username,
      password_encrypted,
      accountStatus,
      proxyUrl,
      platformToken,
      igUserId,
      igAccessToken
    );
    const ProxyManager = require('../proxy/ProxyManager');
    try {
      await ProxyManager.assignProxyToAccount(account.id);
    } catch (proxyErr) {
      await AccountService.deleteAccount(account.id);
      return res.status(503).json({
        error: 'Proxy assignment failed',
        detail: proxyErr.message,
        hint: 'Add an unassigned active proxy to the pool (strict 1:1 per account).',
      });
    }
    const PersonaService = require('../persona/personaService');
    const poolAfterProxy = getPool();
    const accRow = await poolAfterProxy.query(
      'SELECT proxy_id FROM accounts WHERE id = $1',
      [account.id],
    );
    const proxyId = accRow.rows[0]?.proxy_id;
    if (proxyId) {
      const persona = await PersonaService.createPersona({
        name: `persona-${String(account.username).slice(0, 40)}`,
        proxy_id: proxyId,
      });
      await PersonaService.assignAccountToPersona(account.id, persona.id);
    }
    const pool = getPool();
    const withProxy = await pool.query(
      `SELECT a.id, a.username, a.status, a.health_score, a.platform, a.ig_user_id,
              (a.ig_access_token IS NOT NULL AND btrim(a.ig_access_token) <> '') AS ig_token_configured,
              CASE WHEN p.id IS NOT NULL THEN CONCAT(p.host, ':', p.port::text) ELSE NULL END AS proxy_url
       FROM accounts a
       LEFT JOIN proxies p ON p.id = a.proxy_id
       WHERE a.id = $1`,
      [account.id]
    );
    res.status(201).json(withProxy.rows[0] || account);
  } catch (err) {
    // Handle unique constraint violations etc if needed
    res.status(500).json({ error: 'Failed to create account', details: err.message });
  }
});

router.patch('/:id/instagram', async (req, res) => {
  try {
    const { ig_user_id: igUserId, ig_access_token: igAccessToken } = req.body || {};
    if (igUserId == null && igAccessToken == null) {
      return res.status(400).json({
        error: 'At least one of ig_user_id or ig_access_token is required',
      });
    }
    const account = await AccountService.updateInstagramCredentials(
      req.params.id,
      igUserId,
      igAccessToken
    );
    account.ig_publish_ready = Boolean(
      String(account.ig_user_id || '').trim() && account.ig_token_configured
    );
    return res.json(account);
  } catch (err) {
    if (err.message === 'Account not found') {
      return res.status(404).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Failed to update Instagram credentials', details: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const success = await AccountService.deleteAccount(req.params.id);
    if (!success) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    const msg = err.message || 'Failed to delete account';
    const status = err.code === '23503' ? 409 : 500;
    res.status(status).json({ error: msg, details: err.detail || null });
  }
});

// GET /accounts/proxies/health — proxy health status
router.get('/proxies/health', async (req, res) => {
  try {
    const ProxyManager = require('../proxy/ProxyManager');
    const statuses = await ProxyManager.getHealthStatus();
    const total = statuses.length;
    const healthy = statuses.filter(p => p.is_active).length;
    res.json({
      total,
      healthy,
      unhealthy: total - healthy,
      health_percentage: total > 0 ? Math.round((healthy / total) * 100) : 0,
      proxies: statuses
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get proxy health', details: err.message });
  }
});

module.exports = router;
