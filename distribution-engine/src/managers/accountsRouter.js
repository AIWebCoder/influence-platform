const express = require('express');
const router = express.Router();
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
