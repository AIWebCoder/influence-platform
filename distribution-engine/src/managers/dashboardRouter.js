const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');

router.get('/ops-summary', async (req, res) => {
  try {
    const pool = getPool();
    const redis = getRedis();

    const [
      publicationWindowsResult,
      retryBacklogResult,
      interventionResult,
      failureBreakdownResult,
      accountsResult,
      contentQueueSize,
      publishCommandsPending,
      publishDelayedCount,
      publishFailedDlq,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '15 minutes') AS published_15m,
          COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '15 minutes' AND status = 'failed') AS failed_15m,
          COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '15 minutes' AND status = 'permanently_failed') AS permanently_failed_15m,
          COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '1 hour') AS published_1h,
          COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '1 hour' AND status = 'failed') AS failed_1h,
          COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '1 hour' AND status = 'permanently_failed') AS permanently_failed_1h
        FROM publications
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'retrying') AS retrying_count,
          COALESCE(
            ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(COALESCE(last_retry_at, created_at)))) / 60),
            0
          )::int AS oldest_retry_age_min
        FROM publications
        WHERE status = 'retrying'
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('failed', 'permanently_failed')) +
          COUNT(*) FILTER (
            WHERE status = 'retrying'
              AND next_retry_at IS NOT NULL
              AND next_retry_at <= NOW()
          ) AS intervention_needed
        FROM publications
      `),
      pool.query(`
        SELECT COALESCE(failure_type, 'unknown') AS failure_type, COUNT(*) AS total
        FROM publications
        WHERE status IN ('failed', 'permanently_failed', 'retrying')
        GROUP BY COALESCE(failure_type, 'unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
          COUNT(*) FILTER (WHERE status = 'WARMING') AS warming,
          COUNT(*) FILTER (WHERE COALESCE(health_score, 0) < 50) AS low_health
        FROM accounts
      `),
      redis.llen('content:ready').catch(() => 0),
      redis.llen('publish:commands').catch(() => 0),
      redis.zcard('content:delayed').catch(() => 0),
      redis.llen('publish:failed').catch(() => 0),
    ]);

    const windows = publicationWindowsResult.rows[0] || {};
    const retryBacklog = retryBacklogResult.rows[0] || {};
    const intervention = interventionResult.rows[0] || {};
    const accounts = accountsResult.rows[0] || {};

    return res.json({
      generated_at: new Date().toISOString(),
      publication_windows: {
        last_15m: {
          published: Number(windows.published_15m || 0),
          failed: Number(windows.failed_15m || 0),
          permanently_failed: Number(windows.permanently_failed_15m || 0),
        },
        last_1h: {
          published: Number(windows.published_1h || 0),
          failed: Number(windows.failed_1h || 0),
          permanently_failed: Number(windows.permanently_failed_1h || 0),
        },
      },
      retry_backlog: {
        count: Number(retryBacklog.retrying_count || 0),
        oldest_age_min: Number(retryBacklog.oldest_retry_age_min || 0),
      },
      intervention: {
        needed_count: Number(intervention.intervention_needed || 0),
      },
      queue: {
        content_ready: Number(contentQueueSize || 0),
        publish_commands_pending: Number(publishCommandsPending || 0),
        publish_delayed: Number(publishDelayedCount || 0),
        publish_failed_dlq: Number(publishFailedDlq || 0),
      },
      accounts: {
        total: Number(accounts.total || 0),
        active: Number(accounts.active || 0),
        warming: Number(accounts.warming || 0),
        low_health: Number(accounts.low_health || 0),
      },
      failure_breakdown: failureBreakdownResult.rows.map((row) => ({
        failure_type: row.failure_type,
        total: Number(row.total || 0),
      })),
    });
  } catch (error) {
    console.error('Error GET /dashboard/ops-summary:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
