const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { pushDelayed } = require('../core/redis');

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
        cp.caption as content_caption,
        cp.type as content_type,
        cp.niche as content_niche
      FROM publications p
      JOIN accounts a ON p.account_id = a.id
      LEFT JOIN content_packets cp ON p.content_packet_id = cp.id
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
        COUNT(*) FILTER (WHERE status IN ('failed', 'permanently_failed') AND created_at >= CURRENT_DATE) as failed_today
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
        cp.id::text AS content_id,
        cp.type AS content_type,
        cp.niche AS content_niche,
        cp.caption AS content_caption
      FROM publications p
      JOIN accounts a ON a.id = p.account_id
      LEFT JOIN content_packets cp ON cp.id = p.content_packet_id
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
    if (Number(pub.retry_count || 0) >= Number(pub.max_retries || 3)) {
      return res.status(400).json({ error: 'Retry limit exhausted for this publication.' });
    }
    if (!pub.content_packet_id || !pub.account_id) {
      return res.status(400).json({ error: 'Missing content packet or account reference for retry.' });
    }

    const retryDelayMs = 30 * 1000;
    const nextRetryAt = new Date(Date.now() + retryDelayMs);

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
