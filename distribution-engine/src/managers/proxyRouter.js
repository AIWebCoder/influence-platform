const express = require('express');
const router = express.Router();
const ProxyManager = require('../proxy/ProxyManager');

/**
 * GET /proxies
 * Returns all proxies with metrics
 */
router.get('/', async (req, res) => {
  try {
    const proxies = await ProxyManager.getHealthStatus();
    res.json(proxies);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch proxies', details: err.message });
  }
});

/**
 * GET /proxies/stats
 * Aggregate proxy pool health
 */
router.get('/stats', async (req, res) => {
  try {
    const proxies = await ProxyManager.getHealthStatus();
    const total = proxies.length;
    const active = proxies.filter(p => p.is_active).length;
    const avgLatency = proxies.filter(p => p.response_time).reduce((acc, p) => acc + p.response_time, 0) / (active || 1);
    
    res.json({
      total,
      active,
      unhealthy: total - active,
      avg_latency_ms: Math.round(avgLatency),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
  }
});

/**
 * POST /proxies/check
 * Trigger health check for all proxies
 */
router.post('/check', async (req, res) => {
  try {
    // Run async, don't wait for all to finish if many
    ProxyManager.runHealthCheckAll();
    res.json({ message: 'Health check triggered for all proxies' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger health check', details: err.message });
  }
});

module.exports = router;
