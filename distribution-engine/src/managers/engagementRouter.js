const express = require('express');
const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');
const { assertAccountAccess, buildAccountScope, forbidViewerWrite } = require('../core/accessScope');
const {
  listPostsForAccount,
  fetchCommentsForMedia,
} = require('../engagement/instagramCommentsService');

const router = express.Router();

const ACTION_TYPES = new Set(['comment_like', 'comment_reply', 'dm_send']);
const TARGET_TYPES = new Set(['comment', 'user', 'thread']);
const ENGAGEMENT_COMMANDS_QUEUE = 'engagement:commands';

function limitActionType(actionType) {
  if (actionType === 'comment_like') return 'comment_like';
  if (actionType === 'comment_reply') return 'comment';
  if (actionType === 'dm_send') return 'dm';
  return actionType;
}

function isMissingEngagementTable(err) {
  const msg = String(err?.message || '');
  return err?.code === '42P01' || msg.includes('engagement_intents') && msg.includes('does not exist');
}

function mapIntentRow(r) {
  return {
    intent_id: String(r.id),
    status: String(r.status),
    action_type: String(r.action_type),
    account_id: String(r.account_id),
    target_id: String(r.target_id),
    message_text: r.message_text,
    error_message: r.error_message,
    external_result_id: r.external_result_id,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

router.get('/ping', (_req, res) => {
  res.json({ ok: true, service: 'distribution-engine', module: 'engagement' });
});

router.get('/posts', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'account_id is required' });
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const includeGraph = String(req.query.include_graph || 'true').toLowerCase() !== 'false';
  try {
    await assertAccountAccess(pool, req.accessScope, accountId);
    const result = await listPostsForAccount(pool, accountId, { limit, includeGraph });
    res.json({
      posts: result.posts,
      count: result.posts.length,
      graph_error: result.graph_error || null,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('[engagementRouter] posts failed:', err.message);
    res.status(status).json({
      error: err.message || 'Failed to list posts',
      hint: 'Account needs ig_user_id and ig_access_token, and at least one published post.',
    });
  }
});

router.get('/posts/:mediaId/comments', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  const mediaId = String(req.params.mediaId || '').trim();
  const captionHint = String(req.query.caption_hint || '').trim() || undefined;
  if (!accountId || !mediaId) {
    return res.status(400).json({ error: 'account_id and mediaId are required' });
  }
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    await assertAccountAccess(pool, req.accessScope, accountId);
    const result = await fetchCommentsForMedia({
      pool,
      accountId,
      mediaId,
      limit,
      captionHint,
    });
    res.json({
      media_id: result.resolved_media_id || mediaId,
      original_media_id:
        result.original_media_id && result.original_media_id !== result.resolved_media_id
          ? result.original_media_id
          : undefined,
      media_id_resolved: result.media_id_resolved || false,
      account_id: accountId,
      comments: result.comments,
      count: result.comments.length,
      dry_run: result.dry_run,
      hint: result.hint || null,
      graph_error: result.graph_error || null,
      comments_count_reported: result.comments_count_reported ?? null,
    });
  } catch (err) {
    console.error('[engagementRouter] comments failed:', err.message);
    const status = err.statusCode || err?.response?.status || 500;
    res.status(status).json({
      error: err.graph_error || err.message || 'Failed to fetch comments',
      hint: err.resolution?.hint || 'Check IG token scopes (instagram_manage_comments).',
    });
  }
});

router.get('/intents', async (req, res) => {
  const pool = getPool();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
  const allowedStatus = new Set(['ready', 'queued', 'processing', 'completed', 'failed']);
  const statuses = String(req.query.status || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => allowedStatus.has(s));

  const clauses = [];
  const params = [];

  if (statuses.length > 0) {
    params.push(statuses);
    clauses.push(`ei.status = ANY($${params.length})`);
  }

  const actionFilter = String(req.query.action_type || '').trim().toLowerCase();
  if (ACTION_TYPES.has(actionFilter)) {
    params.push(actionFilter);
    clauses.push(`ei.action_type = $${params.length}`);
  }

  const { clause: accountScope, params: scopeParams, nextIndex } = buildAccountScope(
    req.accessScope,
    'a',
    1,
  );
  clauses.push(accountScope);
  params.push(...scopeParams);
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit, skip);

  try {
    const result = await pool.query(
      `
      SELECT
        ei.id,
        ei.status,
        ei.action_type,
        ei.account_id,
        ei.target_id,
        ei.message_text,
        ei.error_message,
        ei.external_result_id,
        ei.created_at
      FROM engagement_intents ei
      JOIN accounts a ON a.id = ei.account_id
      ${whereSql}
      ORDER BY ei.created_at DESC NULLS LAST
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );
    res.json(result.rows.map(mapIntentRow));
  } catch (err) {
    if (isMissingEngagementTable(err)) {
      return res.status(503).json({
        error: 'engagement_intents table missing',
        hint: 'Run: docker compose exec content-factory alembic upgrade head',
      });
    }
    console.error('[engagementRouter] list failed:', err.message);
    res.status(500).json({ error: 'Failed to list engagement intents' });
  }
});

router.post('/intents', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  const pool = getPool();
  const body = req.body || {};
  const action = String(body.action_type || '').trim().toLowerCase();
  const targetType = String(body.target_type || 'comment').trim().toLowerCase();
  const mode = String(body.mode || 'execute_now').trim().toLowerCase();
  const idempotencyKey = String(body.idempotency_key || '').trim();
  const accountId = String(body.account_id || '').trim();
  const targetId = String(body.target_id || '').trim();

  if (!ACTION_TYPES.has(action)) {
    return res.status(400).json({ error: 'Invalid action_type' });
  }
  if (!TARGET_TYPES.has(targetType)) {
    return res.status(400).json({ error: 'Invalid target_type' });
  }
  if (!['execute_now', 'scheduled'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'idempotency_key is required' });
  }
  if (!accountId || !targetId) {
    return res.status(400).json({ error: 'account_id and target_id are required' });
  }

  try {
    await assertAccountAccess(pool, req.accessScope, accountId);
    const existing = await pool.query(
      `SELECT id FROM engagement_intents WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );
    if (existing.rows.length > 0) {
      const full = await pool.query(
        `
        SELECT id, status, action_type, account_id, target_id, message_text,
               error_message, external_result_id, created_at
        FROM engagement_intents WHERE id = $1
        `,
        [existing.rows[0].id]
      );
      return res.status(200).json(mapIntentRow(full.rows[0]));
    }

    const acc = await pool.query(`SELECT id FROM accounts WHERE id = $1::uuid LIMIT 1`, [accountId]);
    if (acc.rowCount === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const ins = await pool.query(
      `
      INSERT INTO engagement_intents (
        account_id, platform, action_type, target_type, target_id,
        target_username, parent_target_id, message_text, mode, scheduled_for,
        status, idempotency_key
      )
      VALUES (
        $1::uuid, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        'ready', $11
      )
      RETURNING id, status, action_type, account_id, target_id, message_text,
                error_message, external_result_id, created_at
      `,
      [
        accountId,
        String(body.platform || 'instagram').trim().toLowerCase(),
        action,
        targetType,
        targetId,
        body.target_username || null,
        body.parent_target_id || null,
        body.message_text || null,
        mode,
        body.scheduled_for || null,
        idempotencyKey,
      ]
    );
    res.status(201).json(mapIntentRow(ins.rows[0]));
  } catch (err) {
    if (isMissingEngagementTable(err)) {
      return res.status(503).json({
        error: 'engagement_intents table missing',
        hint: 'Run: docker compose exec content-factory alembic upgrade head',
      });
    }
    console.error('[engagementRouter] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create engagement intent' });
  }
});

router.post('/intents/:intentId/dispatch', async (req, res) => {
  if (forbidViewerWrite(req.accessScope, res)) return;
  const pool = getPool();
  const intentId = String(req.params.intentId || '').trim();
  if (!intentId) {
    return res.status(400).json({ error: 'Invalid intent id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const intentRes = await client.query(
      `
      SELECT
        ei.id,
        ei.status,
        ei.account_id,
        ei.platform,
        ei.action_type,
        ei.target_type,
        ei.target_id,
        ei.target_username,
        ei.parent_target_id,
        ei.message_text,
        ei.mode,
        ei.scheduled_for,
        COALESCE(a.ig_user_id, '') AS ig_user_id,
        COALESCE(a.ig_access_token, '') AS ig_access_token
      FROM engagement_intents ei
      JOIN accounts a ON a.id = ei.account_id
      WHERE ei.id = $1::uuid
      FOR UPDATE OF ei
      `,
      [intentId]
    );

    if (intentRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Engagement intent not found' });
    }

    const row = intentRes.rows[0];
    await assertAccountAccess(pool, req.accessScope, row.account_id);
    if (row.status === 'queued') {
      await client.query('COMMIT');
      return res.json({
        intent_id: String(row.id),
        status: 'queued',
        note: 'already_queued',
      });
    }
    if (row.status !== 'ready') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Engagement intent must be in ready status' });
    }

    if (row.action_type === 'comment_reply' && !String(row.message_text || '').trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'message_text is required for comment_reply' });
    }
    if (row.action_type === 'dm_send' && !String(row.message_text || '').trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'message_text is required for dm_send' });
    }

    const igUserId = String(row.ig_user_id || '').trim();
    const igToken = String(row.ig_access_token || '').trim();
    if (!igUserId || !igToken) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Account missing Instagram fields for engagement (ig_user_id, ig_access_token)',
      });
    }

    const message = {
      intent_id: String(row.id),
      account_id: String(row.account_id),
      platform: String(row.platform || 'instagram').toLowerCase(),
      ig_user_id: igUserId,
      action_type: row.action_type,
      limit_action_type: limitActionType(row.action_type),
      target_type: row.target_type,
      target_id: String(row.target_id),
      target_username: row.target_username || null,
      parent_target_id: row.parent_target_id || null,
      message_text: row.message_text || null,
      created_at: new Date().toISOString(),
    };

    const payloadJson = JSON.stringify(message);

    await client.query(
      `
      INSERT INTO engagement_outbox (intent_id, payload_json, status)
      VALUES ($1::uuid, $2, 'pending')
      ON CONFLICT (intent_id) DO UPDATE
      SET payload_json = EXCLUDED.payload_json,
          status = 'pending',
          updated_at = NOW()
      `,
      [intentId, payloadJson]
    );

    await client.query(
      `
      UPDATE engagement_intents
      SET status = 'queued', error_message = NULL, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'ready'
      `,
      [intentId]
    );

    await client.query('COMMIT');

    const redis = getRedis();
    if (redis) {
      await redis.lpush(ENGAGEMENT_COMMANDS_QUEUE, payloadJson);
      await pool.query(
        `UPDATE engagement_outbox SET status = 'sent', updated_at = NOW() WHERE intent_id = $1::uuid`,
        [intentId]
      );
    }

    res.json({
      intent_id: intentId,
      status: 'queued',
      action_type: row.action_type,
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (isMissingEngagementTable(err)) {
      return res.status(503).json({
        error: 'engagement tables missing',
        hint: 'Run: docker compose exec content-factory alembic upgrade head',
      });
    }
    console.error('[engagementRouter] dispatch failed:', err.message);
    res.status(500).json({ error: err.message || 'Dispatch failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
