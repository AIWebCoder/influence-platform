const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const MetricsCollector = require('../analytics/MetricsCollector');
const OptimizationService = require('../analytics/OptimizationService');
const { buildAccountScope, assertAccountAccess, forbidViewerWrite } = require('../core/accessScope');

/**
 * GET /analytics/posts
 * Aggregate metrics for all published posts
 */
router.get('/posts', async (req, res) => {
  const pool = getPool();
  try {
    const { clause, params } = buildAccountScope(req.accessScope, 'a', 1);
    const result = await pool.query(
      `
      SELECT 
        p.id, 
        p.instagram_post_id, 
        p.published_at,
        a.username as account_username,
        c.caption,
        m.likes_count AS likes,
        m.comments_count AS comments,
        m.engagement_rate
      FROM publications p
      JOIN accounts a ON p.account_id = a.id
      JOIN content_packets c ON p.content_packet_id = c.id
      LEFT JOIN LATERAL (
        SELECT likes_count, comments_count, engagement_rate 
        FROM post_metrics 
        WHERE publication_id = p.id 
        ORDER BY recorded_at DESC LIMIT 1
      ) m ON true
      WHERE p.status = 'published' AND ${clause}
      ORDER BY p.published_at DESC
      LIMIT 50
      `,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch post analytics', details: err.message });
  }
});

/**
 * GET /analytics/accounts/:id/growth
 * Follower growth timeseries for a specific account
 */
router.get('/accounts/:id/growth', async (req, res) => {
  const pool = getPool();
  try {
    await assertAccountAccess(pool, req.accessScope, req.params.id);
    const result = await pool.query(
      `SELECT followers_count, posts_count, recorded_at 
       FROM account_growth 
       WHERE account_id = $1 
       ORDER BY recorded_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch account growth', details: err.message });
  }
});

/**
 * GET /analytics/top-performing
 * Best posts based on engagement rate
 */
router.get('/top-performing', async (req, res) => {
  const pool = getPool();
  try {
    const { clause, params } = buildAccountScope(req.accessScope, 'a', 1);
    const result = await pool.query(
      `
      SELECT 
        p.id, 
        p.instagram_post_id,
        a.username,
        m.engagement_rate,
        m.likes_count AS likes,
        m.comments_count AS comments
      FROM post_metrics m
      JOIN publications p ON m.publication_id = p.id
      JOIN accounts a ON p.account_id = a.id
      WHERE m.recorded_at > NOW() - INTERVAL '30 days' AND ${clause}
      ORDER BY m.engagement_rate DESC
      LIMIT 10
      `,
      params,
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch top performing posts', details: err.message });
  }
});

/**
 * POST /analytics/collect
 * Manual trigger for metrics collection
 */
router.post('/collect', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  try {
    MetricsCollector.collectAll();
    res.json({ message: 'Metrics collection triggered' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger collection', details: err.message });
  }
});

/**
 * GET /analytics/optimization/posting-times
 */
router.get('/optimization/posting-times', async (req, res) => {
  try {
    const times = await OptimizationService.getOptimalPostingTimes({
      niche: req.query.niche,
      accountId: req.query.accountId
    });
    res.json(times);
  } catch (err) {
    res.status(500).json({ error: 'Optimization failed', details: err.message });
  }
});

/**
 * GET /analytics/optimization/frequency
 */
router.get('/optimization/frequency', async (req, res) => {
  if (!req.query.accountId) {
    return res.status(400).json({ error: 'accountId is required' });
  }
  try {
    await assertAccountAccess(getPool(), req.accessScope, req.query.accountId);
    const frequency = await OptimizationService.getFrequencyOptimization(req.query.accountId);
    res.json(frequency);
  } catch (err) {
    res.status(500).json({ error: 'Optimization failed', details: err.message });
  }
});

module.exports = router;
