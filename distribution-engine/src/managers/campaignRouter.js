const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { assertAccountAccess, buildAccountScope, forbidViewerWrite, getAllowedAccountIds } = require('../core/accessScope');

/**
 * GET /campaigns
 * List all campaigns with their current status.
 */
router.get('/', async (req, res) => {
  const pool = getPool();
  try {
    const scope = req.accessScope;
    let result;
    if (scope.isFleet) {
      result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    } else {
      const accountIds = await getAllowedAccountIds(pool, scope);
      if (accountIds.length === 0) {
        return res.json([]);
      }
      result = await pool.query(
        `SELECT * FROM campaigns
         WHERE target_account_id IS NULL OR target_account_id = ANY($1::uuid[])
         ORDER BY created_at DESC`,
        [accountIds],
      );
    }
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
  if (forbidViewerWrite(req.accessScope, res)) return;
  const { name, type, target_niche, target_account_id, settings } = req.body;
  const pool = getPool();
  try {
    if (target_account_id) {
      await assertAccountAccess(pool, req.accessScope, target_account_id);
    }
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
    const camp = await pool.query(
      `SELECT target_account_id FROM campaigns WHERE id = $1 LIMIT 1`,
      [req.params.id],
    );
    if (camp.rowCount === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const targetAccountId = camp.rows[0].target_account_id;
    if (targetAccountId) {
      await assertAccountAccess(pool, req.accessScope, targetAccountId);
    } else if (!req.accessScope.isFleet) {
      return res.status(403).json({ error: 'Access denied for this campaign' });
    }
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
  if (forbidViewerWrite(req.accessScope, res)) return;
  const { status, settings } = req.body;
  const pool = getPool();
  try {
    const existing = await pool.query(
      `SELECT target_account_id FROM campaigns WHERE id = $1 LIMIT 1`,
      [req.params.id],
    );
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    const targetAccountId = existing.rows[0].target_account_id;
    if (targetAccountId) {
      await assertAccountAccess(pool, req.accessScope, targetAccountId);
    } else if (!req.accessScope.isFleet) {
      return res.status(403).json({ error: 'Access denied for this campaign' });
    }

    if (settings !== undefined) {
      const result = await pool.query(
        `UPDATE campaigns
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [JSON.stringify(settings), req.params.id]
      );
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      `UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to update campaign', details: err.message });
  }
});

module.exports = router;
