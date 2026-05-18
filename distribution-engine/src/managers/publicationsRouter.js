const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { pushDelayed, getRedis } = require('../core/redis');

const PUBLISH_QUEUE_COMMANDS = 'publish:commands';

/**
 * GET /publications
 * Enhanced publications list with filtering, pagination, and error details.
 */
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    const { status, limit = 100, offset = 0 } = req.query;

    let whereClause = '';
    const params = [];
    let paramIndex = 1;

    if (status) {
      whereClause = `WHERE p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));

    const query = `
      SELECT 
        p.id, 
        p.content_packet_id as content_id,
        p.publication_target_id::text as publication_target_id,
        p.status,
        p.instagram_post_id as post_url, 
        p.published_at,
        p.error_message,
        p.retry_count,
        (p.retry_count + 1) as attempt,
        p.failure_type,
        p.last_retry_at,
        p.next_retry_at,
        p.max_retries,
        p.engagement_score,
        p.created_at,
        p.updated_at,
        a.username as account_username,
        a.platform as account_platform,
        COALESCE(cp.caption, pi_src.caption) as content_caption,
        COALESCE(cp.type, pi_src.content_type) as content_type,
        cp.niche as content_niche
      FROM publications p
      JOIN accounts a ON p.account_id = a.id
      LEFT JOIN content_packets cp ON p.content_packet_id = cp.id
      LEFT JOIN publication_targets pt_src ON pt_src.id = p.publication_target_id
      LEFT JOIN publication_intents pi_src ON pi_src.id = pt_src.publication_intent_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await pool.query(query, params);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM publications p 
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, status ? [status] : []);

    res.json({
      publications: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0].total, 10),
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  } catch (error) {
    console.error('Error GET /publications:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /publications/stats
 * Aggregate publication statistics.
 */
router.get('/stats', async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'publishing') as processing,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        COUNT(*) FILTER (WHERE status IN ('failed', 'permanently_failed')) as failed,
        COUNT(*) FILTER (WHERE status = 'retrying') as retrying,
        COALESCE(SUM(retry_count), 0) as total_retries,
        COUNT(*) FILTER (WHERE published_at >= CURRENT_DATE) as published_today,
        COUNT(*) FILTER (WHERE status IN ('failed', 'permanently_failed') AND created_at >= CURRENT_DATE) as failed_today,
        COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '7 days') as published_7d,
        COUNT(*) FILTER (
          WHERE status IN ('failed', 'permanently_failed')
            AND updated_at >= NOW() - INTERVAL '7 days'
        ) as failed_7d
      FROM publications
    `);

    const stats = result.rows[0];

    res.json({
      total: parseInt(stats.total, 10),
      pending: parseInt(stats.pending, 10),
      processing: parseInt(stats.processing, 10),
      published: parseInt(stats.published, 10),
      failed: parseInt(stats.failed, 10),
      retrying: parseInt(stats.retrying, 10),
      total_retries: parseInt(stats.total_retries, 10),
      published_today: parseInt(stats.published_today, 10),
      failed_today: parseInt(stats.failed_today, 10),
      published_7d: parseInt(stats.published_7d, 10),
      failed_7d: parseInt(stats.failed_7d, 10),
    });
  } catch (error) {
    console.error('Error GET /publications/stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /publications/:id/diagnostics
 * Detailed diagnostics for operator troubleshooting.
 */
router.get('/:id/diagnostics', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.status,
        p.error_message,
        p.failure_type,
        p.retry_count,
        p.max_retries,
        (p.retry_count + 1) AS attempt,
        p.last_retry_at,
        p.next_retry_at,
        p.created_at,
        p.updated_at,
        p.published_at,
        p.instagram_post_id AS post_url,
        p.account_id::text,
        a.username AS account_username,
        COALESCE(cp.id::text, pt_src.publication_intent_id::text) AS content_id,
        COALESCE(cp.type, pi_src.content_type) AS content_type,
        cp.niche AS content_niche,
        COALESCE(cp.caption, pi_src.caption) AS content_caption
      FROM publications p
      JOIN accounts a ON a.id = p.account_id
      LEFT JOIN content_packets cp ON cp.id = p.content_packet_id
      LEFT JOIN publication_targets pt_src ON pt_src.id = p.publication_target_id
      LEFT JOIN publication_intents pi_src ON pi_src.id = pt_src.publication_intent_id
      WHERE p.id = $1::uuid
      LIMIT 1
      `,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Publication not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error GET /publications/:id/diagnostics:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /publications/:id/retry
 * Manual operator retry for failed publication.
 */
router.post('/:id/retry', async (req, res) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    const rowResult = await pool.query(
      `
      SELECT
        p.id,
        p.status,
        p.retry_count,
        p.max_retries,
        p.account_id::text AS account_id,
        p.content_packet_id::text AS content_packet_id,
        p.publication_target_id::text AS publication_target_id,
        cp.caption,
        cp.visual_url,
        cp.hashtags,
        cp.niche,
        cp.type,
        cp.scheduled_at
      FROM publications p
      LEFT JOIN content_packets cp ON cp.id = p.content_packet_id
      WHERE p.id = $1::uuid
      LIMIT 1
      `,
      [id]
    );

    if (rowResult.rowCount === 0) {
      return res.status(404).json({ error: 'Publication not found' });
    }

    const pub = rowResult.rows[0];
    if (!['failed', 'permanently_failed', 'retrying'].includes(pub.status)) {
      return res.status(400).json({ error: `Publication is in status '${pub.status}' and cannot be retried.` });
    }
    const maxR = Number(pub.max_retries || 3);
    if (
      !pub.publication_target_id &&
      Number(pub.retry_count || 0) >= maxR
    ) {
      return res.status(400).json({ error: 'Retry limit exhausted for this publication.' });
    }
    if (!pub.account_id) {
      return res.status(400).json({ error: 'Missing account reference for retry.' });
    }

    const retryDelayMs = 30 * 1000;
    const nextRetryAt = new Date(Date.now() + retryDelayMs);

    if (pub.publication_target_id) {
      const ob = await pool.query(
        `
        SELECT payload_json
        FROM publish_outbox
        WHERE target_id = $1::uuid
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        [pub.publication_target_id]
      );
      if (!ob.rows.length || !ob.rows[0].payload_json) {
        return res.status(400).json({
          error:
            'Cannot retry: publish payload not found. Re-dispatch the intent from Generation Studio or restore publish_outbox.',
        });
      }

      const redis = getRedis();
      if (!redis) {
        return res.status(503).json({ error: 'Redis unavailable' });
      }

      const tgtUp = await pool.query(
        `
        UPDATE publication_targets
        SET status = 'pending',
            retry_count = 0,
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND status IN ('failed', 'uncertain')
        RETURNING id
        `,
        [pub.publication_target_id]
      );
      if (tgtUp.rowCount === 0) {
        return res.status(400).json({
          error: 'Target is not in a retriable state; refresh and try again.',
        });
      }

      await redis.lpush(PUBLISH_QUEUE_COMMANDS, ob.rows[0].payload_json);

      await pool.query(
        `
        UPDATE publications
        SET status = 'retrying',
            retry_count = 0,
            error_message = NULL,
            failure_type = NULL,
            last_retry_at = NOW(),
            next_retry_at = $2,
            updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [id, nextRetryAt.toISOString()]
      );

      return res.json({
        publication_id: id,
        status: 'retrying',
        next_retry_at: nextRetryAt.toISOString(),
      });
    }

    if (Number(pub.retry_count || 0) >= maxR) {
      return res.status(400).json({ error: 'Retry limit exhausted for this publication.' });
    }

    if (!pub.content_packet_id) {
      return res.status(400).json({ error: 'Missing content packet reference for retry.' });
    }

    const payload = {
      id: String(pub.content_packet_id),
      caption: pub.caption || '',
      visual_url: pub.visual_url || null,
      hashtags: Array.isArray(pub.hashtags) ? pub.hashtags : [],
      niche: pub.niche || null,
      type: pub.type || 'post',
      scheduled_at: pub.scheduled_at || null,
      target_accounts: [String(pub.account_id)],
    };

    await pushDelayed(JSON.stringify(payload), retryDelayMs);

    await pool.query(
      `
      UPDATE publications
      SET status = 'retrying',
          error_message = NULL,
          failure_type = NULL,
          last_retry_at = NOW(),
          next_retry_at = $2,
          updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [id, nextRetryAt.toISOString()]
    );

    return res.json({
      publication_id: id,
      status: 'retrying',
      next_retry_at: nextRetryAt.toISOString(),
    });
  } catch (error) {
    console.error('Error POST /publications/:id/retry:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
