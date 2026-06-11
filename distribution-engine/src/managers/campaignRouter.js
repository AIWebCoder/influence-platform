const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const {
  assertAccountAccess,
  forbidViewerWrite,
  getAllowedAccountIds,
} = require('../core/accessScope');

const VALID_TYPES = new Set(['content', 'growth', 'engagement']);
const VALID_STATUS = new Set(['active', 'paused', 'completed']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAccountIds(body) {
  const ids = new Set();
  const fromSettings = body?.settings?.account_ids;
  if (Array.isArray(fromSettings)) {
    for (const raw of fromSettings) {
      const id = String(raw || '').trim();
      if (UUID_RE.test(id)) ids.add(id);
    }
  }
  const target = String(body?.target_account_id || '').trim();
  if (UUID_RE.test(target)) ids.add(target);
  return [...ids];
}

async function getCampaignAccountIds(pool, campaignId) {
  const res = await pool.query(
    `SELECT account_id::text AS account_id
     FROM campaign_accounts
     WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  return res.rows.map((r) => r.account_id);
}

async function resolveCampaignAccountIds(pool, campaign) {
  const linked = await getCampaignAccountIds(pool, campaign.id);
  if (linked.length > 0) return linked;

  const fromSettings = campaign.settings?.account_ids;
  if (Array.isArray(fromSettings) && fromSettings.length > 0) {
    return fromSettings.filter((id) => typeof id === 'string' && UUID_RE.test(id));
  }
  if (campaign.target_account_id) return [String(campaign.target_account_id)];
  return [];
}

async function assertCampaignAccess(pool, scope, campaignId) {
  const camp = await pool.query(`SELECT * FROM campaigns WHERE id = $1::uuid LIMIT 1`, [campaignId]);
  if (camp.rowCount === 0) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  const campaign = camp.rows[0];
  if (scope.isFleet) return campaign;

  const accountIds = await resolveCampaignAccountIds(pool, campaign);
  if (accountIds.length === 0) {
    const err = new Error('Access denied for this campaign');
    err.statusCode = 403;
    throw err;
  }

  const allowed = await getAllowedAccountIds(pool, scope);
  const hasAccess = accountIds.some((id) => allowed.includes(id));
  if (!hasAccess) {
    const err = new Error('Access denied for this campaign');
    err.statusCode = 403;
    throw err;
  }
  return campaign;
}

function validateCreateBody(body) {
  const errors = [];
  const name = String(body?.name || '').trim();
  if (!name) errors.push('name is required');

  const type = String(body?.type || '').trim().toLowerCase();
  if (!VALID_TYPES.has(type)) {
    errors.push(`type must be one of: ${[...VALID_TYPES].join(', ')}`);
  }

  const accountIds = parseAccountIds(body);
  if (accountIds.length === 0) {
    errors.push('at least one account_id is required in settings.account_ids or target_account_id');
  }

  return { errors, name, type, accountIds };
}

/**
 * GET /campaigns
 * List campaigns visible to the current access scope.
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
        `SELECT DISTINCT c.*
         FROM campaigns c
         LEFT JOIN campaign_accounts ca ON ca.campaign_id = c.id
         WHERE ca.account_id = ANY($1::uuid[])
            OR c.target_account_id = ANY($1::uuid[])
         ORDER BY c.created_at DESC`,
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
 * Create a campaign and link accounts in campaign_accounts.
 */
router.post('/', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;

  const { errors, name, type, accountIds } = validateCreateBody(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid campaign payload', details: errors });
  }

  const { target_niche, target_account_id, settings } = req.body;
  const pool = getPool();
  const client = await pool.connect();

  try {
    for (const accountId of accountIds) {
      await assertAccountAccess(pool, req.accessScope, accountId);
    }

    const primaryAccountId =
      accountIds.length === 1 ? accountIds[0] : target_account_id || null;

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO campaigns (name, type, target_niche, target_account_id, settings)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, type, target_niche || null, primaryAccountId, settings || {}],
    );
    const campaign = result.rows[0];

    for (const accountId of accountIds) {
      await client.query(
        `INSERT INTO campaign_accounts (campaign_id, account_id)
         VALUES ($1::uuid, $2::uuid)
         ON CONFLICT DO NOTHING`,
        [campaign.id, accountId],
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      ...campaign,
      account_ids: accountIds,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create campaign', details: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /campaigns/:id/history
 * Fetch performance timeseries for a campaign.
 */
router.get('/:id/history', async (req, res) => {
  const pool = getPool();
  try {
    await assertCampaignAccess(pool, req.accessScope, req.params.id);
    const result = await pool.query(
      `SELECT * FROM campaign_history
       WHERE campaign_id = $1::uuid
       ORDER BY snapshot_at ASC`,
      [req.params.id],
    );
    res.json(result.rows);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to fetch campaign history', details: err.message });
  }
});

/**
 * GET /campaigns/:id
 * Single campaign with linked accounts and job id summary.
 */
router.get('/:id', async (req, res) => {
  const pool = getPool();
  try {
    const campaign = await assertCampaignAccess(pool, req.accessScope, req.params.id);
    const accountIds = await resolveCampaignAccountIds(pool, campaign);

    let accounts = [];
    if (accountIds.length > 0) {
      const accRes = await pool.query(
        `SELECT id::text AS id, username, platform
         FROM accounts
         WHERE id = ANY($1::uuid[])`,
        [accountIds],
      );
      accounts = accRes.rows;
    }

    const rawJobIds = campaign.settings?.generation_job_ids;
    const jobIds = Array.isArray(rawJobIds)
      ? rawJobIds.filter((id) => typeof id === 'string' && id.trim())
      : [];

    res.json({
      ...campaign,
      account_ids: accountIds,
      accounts,
      job_ids: jobIds,
    });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to fetch campaign', details: err.message });
  }
});

/**
 * PATCH /campaigns/:id
 * Pause, resume, complete, or merge settings.
 */
router.patch('/:id', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;

  const { status, settings } = req.body;
  const pool = getPool();

  try {
    await assertCampaignAccess(pool, req.accessScope, req.params.id);

    if (settings !== undefined) {
      const result = await pool.query(
        `UPDATE campaigns
         SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2::uuid
         RETURNING *`,
        [JSON.stringify(settings), req.params.id],
      );
      return res.json(result.rows[0]);
    }

    if (status === undefined) {
      return res.status(400).json({ error: 'status or settings is required' });
    }

    const nextStatus = String(status).trim().toLowerCase();
    if (!VALID_STATUS.has(nextStatus)) {
      return res.status(400).json({
        error: 'Invalid status',
        allowed: [...VALID_STATUS],
      });
    }

    const result = await pool.query(
      `UPDATE campaigns SET status = $1, updated_at = NOW() WHERE id = $2::uuid RETURNING *`,
      [nextStatus, req.params.id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to update campaign', details: err.message });
  }
});

/**
 * DELETE /campaigns/:id
 * Remove a campaign and cascade campaign_history rows.
 */
router.delete('/:id', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  const pool = getPool();
  try {
    await assertCampaignAccess(pool, req.accessScope, req.params.id);
    const result = await pool.query(
      `DELETE FROM campaigns WHERE id = $1::uuid RETURNING id`,
      [req.params.id],
    );
    res.json({ deleted: true, id: result.rows[0].id });
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to delete campaign', details: err.message });
  }
});

module.exports = router;
