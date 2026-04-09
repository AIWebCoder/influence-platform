const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const AccountService = require('./AccountService');
const { Pool } = require('pg'); // Assuming pg is used for database interaction
const dotenv = require('dotenv'); // Assuming dotenv is used for environment variables

dotenv.config(); // Load environment variables

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper function to get the pool (if needed, otherwise use 'pool' directly)
const getPool = () => pool;

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
    const result = await pool.query('SELECT id, username, status, health_score, metadata, created_at FROM accounts');
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur GET /accounts:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query('SELECT id, username, status, health_score, metadata, created_at FROM accounts WHERE id = $1', [req.params.id]);
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
    const result = await pool.query(
      `SELECT p.id, p.host, p.port, p.username, p.password_encrypted, p.provider, p.country,
              p.proxy_type, p.auth_mode, p.rotation_hint, p.session_id
       FROM accounts a
       LEFT JOIN proxies p ON p.id = a.proxy_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const row = result.rows[0];
    if (!row.id) {
      return res.status(404).json({ error: 'No proxy assigned for this account' });
    }

    const password = decryptProxyPassword(row.password_encrypted);
    return res.json({
      proxy_id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      password,
      provider: row.provider,
      country: row.country,
      proxy_type: row.proxy_type || 'http',
      auth_mode: row.auth_mode || (row.username ? 'credentials' : 'none'),
      rotation_hint: row.rotation_hint || null,
      session_id: row.session_id || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch proxy credentials', details: err.message });
  }
});

router.post('/:id/proxy/rotate', async (req, res) => {
  try {
    const accountId = req.params.id;
    const ProxyManager = require('../proxy/ProxyManager');
    await ProxyManager.assignProxyToAccount(accountId);
    return res.json({ success: true, account_id: accountId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to rotate proxy', details: err.message });
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

router.post('/', async (req, res) => {
  try {
    const { username, password_encrypted, status, metadata } = req.body;
    if (!username || !password_encrypted) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const proxyUrl = metadata?.proxy || null;
    const accountStatus = status || 'warming';
    const account = await AccountService.createAccount(username, password_encrypted, accountStatus, proxyUrl);
    res.status(201).json(account);
  } catch (err) {
    // Handle unique constraint violations etc if needed
    res.status(500).json({ error: 'Failed to create account', details: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const success = await AccountService.deleteAccount(req.params.id);
    if (!success) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account' });
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
