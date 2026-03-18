const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');

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
        p.failure_type,
        p.last_retry_at,
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

module.exports = router;
