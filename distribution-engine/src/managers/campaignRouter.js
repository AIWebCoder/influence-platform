const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');

/**
 * GET /campaigns
 * List all campaigns with their current status.
 */
router.get('/', async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaigns', details: err.message });
  }
});

/**
 * POST /campaigns
 * Create a new automated campaign.
 */
router.post('/', async (req, res) => {
  const { name, type, target_niche, target_account_id, settings } = req.body;
  const pool = getPool();
  try {
    const result = await pool.query(`
      INSERT INTO campaigns (name, type, target_niche, target_account_id, settings)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, type, target_niche, target_account_id, settings || {}]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create campaign', details: err.message });
  }
});

/**
 * GET /campaigns/:id/history
 * Fetch performance timeseries for a campaign.
 */
router.get('/:id/history', async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT * FROM campaign_history 
      WHERE campaign_id = $1 
      ORDER BY snapshot_at ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch campaign history', details: err.message });
  }
});

/**
 * PATCH /campaigns/:id
 * Pause, resume, or finish a campaign.
 */
router.patch('/:id', async (req, res) => {
  const { status, settings } = req.body;
  const pool = getPool();
  try {
    if (settings !== undefined) {
      const result = await pool.query(
        `UPDATE campaigns
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(settings), req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Campaign not found' });
      }
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      `UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update campaign', details: err.message });
  }
});

module.exports = router;
