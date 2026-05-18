const express = require('express');
const router = express.Router();
const ProxyManager = require('../proxy/ProxyManager');

router.get('/', async (req, res) => {
  try {
    const proxies = await ProxyManager.getHealthStatus();
    res.json(proxies);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch proxies', details: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [proxies, capacity] = await Promise.all([
      ProxyManager.getHealthStatus(),
      ProxyManager.getPoolCapacity(),
    ]);
    const total = proxies.length;
    const active = proxies.filter((p) => p.is_active).length;
    const avgLatency =
      proxies.filter((p) => p.response_time).reduce((acc, p) => acc + p.response_time, 0) /
      (active || 1);

    res.json({
      total,
      active,
      unhealthy: total - active,
      avg_latency_ms: Math.round(avgLatency),
      capacity,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { host, port, username, password_encrypted, provider, country } = req.body || {};
    const proxy = await ProxyManager.createProxy({
      host,
      port,
      username,
      password_encrypted,
      provider,
      country,
    });
    res.status(201).json(proxy);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create proxy', details: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const proxy = await ProxyManager.updateProxy(req.params.id, req.body || {});
    res.json(proxy);
  } catch (err) {
    const code = err.message === 'Proxy not found' ? 404 : 400;
    res.status(code).json({ error: 'Failed to update proxy', details: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await ProxyManager.deleteProxy(req.params.id);
    res.json(result);
  } catch (err) {
    const code = err.message === 'Proxy not found' ? 404 : 400;
    res.status(code).json({ error: 'Failed to delete proxy', details: err.message });
  }
});

router.post('/check', async (req, res) => {
  try {
    ProxyManager.runHealthCheckAll();
    res.json({ message: 'Health check triggered for all proxies' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger health check', details: err.message });
  }
});

module.exports = router;
