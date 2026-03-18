const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');

router.get('/', async (req, res) => {
  const checks = {};
  try {
    await getPool().query('SELECT 1');
    checks.postgres = 'ok';
  } catch (e) {
    checks.postgres = `error: ${e.message}`;
  }
  try {
    await getRedis().ping();
    checks.redis = 'ok';
  } catch (e) {
    checks.redis = `error: ${e.message}`;
  }
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.json({ status: allOk ? 'healthy' : 'degraded', service: 'distribution-engine', checks });
});

module.exports = router;
