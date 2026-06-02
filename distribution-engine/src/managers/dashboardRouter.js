const express = require('express');
const router = express.Router();
const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');
const ProxyManager = require('../proxy/ProxyManager');
const { buildAccountScope, getAllowedAccountIds } = require('../core/accessScope');

router.get('/ops-summary', async (req, res) => {
  try {
    const pool = getPool();
    const redis = getRedis();
    const scope = req.accessScope;

    let pubWhere = '';
    let pubParams = [];
    let accountWhere = '';
    let accountParams = [];
    if (scope.isFleet) {
      const { clause, params } = buildAccountScope(scope, 'a', 1);
      accountWhere = `WHERE ${clause}`;
      accountParams = params;
    } else {
      const ids = await getAllowedAccountIds(pool, scope);
      if (ids.length === 0) {
        return res.json({
          generated_at: new Date().toISOString(),
          publication_windows: {
            last_15m: { published: 0, failed: 0, permanently_failed: 0 },
            last_1h: { published: 0, failed: 0, permanently_failed: 0 },
          },
          retry_backlog: { count: 0, oldest_age_min: 0 },
          intervention: { needed_count: 0 },
          queue: {
            content_ready: 0,
            publish_commands_pending: 0,
            publish_delayed: 0,
            publish_failed_dlq: 0,
          },
          accounts: { total: 0, active: 0, warming: 0, low_health: 0 },
          failure_breakdown: [],
          proxy_capacity: null,
        });
      }
      pubWhere = 'WHERE p.account_id = ANY($1::uuid[])';
      pubParams = [ids];
      accountWhere = 'WHERE a.id = ANY($1::uuid[])';
      accountParams = [ids];
    }

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
      proxyCapacity,
    ] = await Promise.all([
      pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE p.published_at >= NOW() - INTERVAL '15 minutes') AS published_15m,
          COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '15 minutes' AND p.status = 'failed') AS failed_15m,
          COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '15 minutes' AND p.status = 'permanently_failed') AS permanently_failed_15m,
          COUNT(*) FILTER (WHERE p.published_at >= NOW() - INTERVAL '1 hour') AS published_1h,
          COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '1 hour' AND p.status = 'failed') AS failed_1h,
          COUNT(*) FILTER (WHERE p.updated_at >= NOW() - INTERVAL '1 hour' AND p.status = 'permanently_failed') AS permanently_failed_1h
        FROM publications p
        ${pubWhere}
        `,
        pubParams,
      ),
      pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE p.status = 'retrying') AS retrying_count,
          COALESCE(
            ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(COALESCE(p.last_retry_at, p.created_at)))) / 60),
            0
          )::int AS oldest_retry_age_min
        FROM publications p
        ${pubWhere ? `${pubWhere} AND p.status = 'retrying'` : "WHERE p.status = 'retrying'"}
        `,
        pubParams,
      ),
      pool.query(
        `
        SELECT
          COUNT(*) FILTER (WHERE p.status IN ('failed', 'permanently_failed')) +
          COUNT(*) FILTER (
            WHERE p.status = 'retrying'
              AND p.next_retry_at IS NOT NULL
              AND p.next_retry_at <= NOW()
          ) AS intervention_needed
        FROM publications p
        ${pubWhere}
        `,
        pubParams,
      ),
      pool.query(
        `
        SELECT COALESCE(p.failure_type, 'unknown') AS failure_type, COUNT(*) AS total
        FROM publications p
        ${pubWhere ? `${pubWhere} AND` : 'WHERE'} p.status IN ('failed', 'permanently_failed', 'retrying')
        GROUP BY COALESCE(p.failure_type, 'unknown')
        ORDER BY COUNT(*) DESC
        LIMIT 5
        `,
        pubParams,
      ),
      pool.query(
        `
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE LOWER(a.status) = 'active') AS active,
          COUNT(*) FILTER (WHERE LOWER(a.status) = 'warming') AS warming,
          COUNT(*) FILTER (WHERE COALESCE(a.health_score, 0) < 50) AS low_health
        FROM accounts a
        ${accountWhere}
        `,
        accountParams,
      ),
      ProxyManager.getPoolCapacity().catch(() => null),
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
      proxy_capacity: proxyCapacity || null,
    });
  } catch (error) {
    console.error('Error GET /dashboard/ops-summary:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
