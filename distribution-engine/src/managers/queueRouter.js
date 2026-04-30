const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');

/**
 * GET /queue/stats
 * Returns queue health metrics: pending, processing, failed, retries.
 */
router.get('/stats', async (req, res) => {
  try {
    const pool = getPool();
    const redis = getRedis();

    // Redis queue lengths
    const pendingInQueue = await redis.llen('content:ready').catch(() => 0);
    const delayedInQueue = await redis.zcard('content:delayed').catch(() => 0);
    const publishCommandsPending = await redis.llen('publish:commands').catch(() => 0);
    const publishFailedDlq = await redis.llen('publish:failed').catch(() => 0);
    let publishProcessing = 0;
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'publish:processing:*', 'COUNT', 100);
        cursor = nextCursor;
        if (Array.isArray(keys) && keys.length > 0) {
          const lengths = await Promise.all(keys.map((k) => redis.llen(k).catch(() => 0)));
          publishProcessing += lengths.reduce((acc, x) => acc + Number(x || 0), 0);
        }
      } while (cursor !== '0');
    } catch (_) {
      publishProcessing = 0;
    }

    // DB aggregates from publications table
    const dbResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'publishing') as processing,
        COUNT(*) FILTER (WHERE status IN ('failed', 'permanently_failed')) as failed,
        COUNT(*) FILTER (WHERE status = 'retrying') as retrying,
        COUNT(*) FILTER (WHERE status = 'published') as published,
        COUNT(*) as total,
        COALESCE(SUM(retry_count) FILTER (WHERE retry_count > 0), 0) as total_retries
      FROM publications
    `);

    const stats = dbResult.rows[0];

    res.json({
      queue: {
        pending: pendingInQueue,
        delayed: delayedInQueue,
        publish_commands_pending: publishCommandsPending,
        publish_processing: publishProcessing,
        publish_failed_dlq: publishFailedDlq,
      },
      publications: {
        total: parseInt(stats.total, 10),
        pending: parseInt(stats.pending, 10),
        processing: parseInt(stats.processing, 10),
        published: parseInt(stats.published, 10),
        failed: parseInt(stats.failed, 10),
        retrying: parseInt(stats.retrying, 10),
        total_retries: parseInt(stats.total_retries, 10),
      },
    });
  } catch (error) {
    console.error('Error GET /queue/stats:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
