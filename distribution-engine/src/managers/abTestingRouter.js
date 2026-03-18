const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const WinnerDetectionService = require('../analytics/WinnerDetectionService');

/**
 * GET /ab-tests
 * List all A/B tests with their status
 */
router.get('/', async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT 
        id, name, niche, status, winner, winning_er, started_at, completed_at
      FROM ab_tests
      ORDER BY started_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch A/B tests', details: err.message });
  }
});

/**
 * GET /ab-tests/:id/performance
 * Detailed performance comparison between variants
 */
router.get('/:id/performance', async (req, res) => {
  const pool = getPool();
  try {
    const metrics = await pool.query(`
      SELECT 
        variant,
        COUNT(*) as sample_size,
        SUM(likes) as total_likes,
        SUM(comments) as total_comments,
        AVG(engagement_rate) as avg_er
      FROM caption_performance
      WHERE ab_test_id = $1
      GROUP BY variant
    `, [req.params.id]);

    const testDetails = await pool.query('SELECT * FROM ab_tests WHERE id = $1', [req.params.id]);

    res.json({
      test: testDetails.rows[0],
      variants: metrics.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch test performance', details: err.message });
  }
});

/**
 * POST /ab-tests/:id/evaluate
 * Force manual evaluation of a test to declare a winner
 */
router.post('/:id/evaluate', async (req, res) => {
  try {
    const winner = await WinnerDetectionService.evaluateTest(req.params.id);
    res.json({ 
      success: true, 
      winner: winner || 'pending',
      message: winner ? `Variant ${winner} declared as winner!` : 'Test still running, no clear winner yet.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Evaluation failed', details: err.message });
  }
});

/**
 * POST /ab-tests/create-dummy
 * Helper for UI testing (creates a dummy test entry)
 */
router.post('/seed', async (req, res) => {
  const pool = getPool();
  try {
    const testId = require('uuid').v4();
    await pool.query(
      `INSERT INTO ab_tests (id, name, niche, status, started_at) 
       VALUES ($1, $2, $3, 'running', NOW())`,
      [testId, 'Caption Style Test #' + Math.floor(Math.random()*1000), 'fitness']
    );
    res.json({ id: testId });
  } catch (err) {
    res.status(500).json({ error: 'Seeding failed', details: err.message });
  }
});

module.exports = router;
