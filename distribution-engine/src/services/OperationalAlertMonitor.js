const { getPool } = require('../core/database');
const { getRedis } = require('../core/redis');
const AlertService = require('./AlertService');

const QUEUE_PRESSURE_PREFIX = 'Queue pressure:';
const PUBLISH_DLQ_PREFIX = 'Publish DLQ:';
const RETRY_BACKLOG_PREFIX = 'Retry backlog:';
const TOKEN_EXPIRED_PREFIX = 'Instagram token expired:';
const TOKEN_EXPIRING_PREFIX = 'Instagram token expiring:';
const MISSING_CREDS_PREFIX = 'Account missing Instagram credentials:';
const MISSING_PROXY_PREFIX = 'Account missing proxy:';
const LOW_HEALTH_PREFIX = 'Low account health:';
const PUBLISH_FAILED_PREFIX = 'Publication failed:';
const SCHEDULE_MISSED_PREFIX = 'Scheduled publish missed:';
const GEN_FAILED_PREFIX = 'Generation job failed:';
const GEN_STUCK_PREFIX = 'Generation job stuck:';

class OperationalAlertMonitor {
  async runAll() {
    const pool = getPool();
    await this.checkQueuePressure(pool);
    await this.checkPublishDlq(pool);
    await this.checkRetryBacklog(pool);
    await this.checkTokenExpiry(pool);
    await this.checkAccountReadiness(pool);
    await this.checkPublicationFailures(pool);
    await this.checkMissedSchedules(pool);
    await this.checkGenerationJobs(pool);
  }

  async checkQueuePressure(pool) {
    let pressure = 0;
    try {
      const redis = getRedis();
      const pending = await redis.llen('publish:commands').catch(() => 0);
      const delayed = await redis.zcard('content:delayed').catch(() => 0);
      pressure = Number(pending || 0) + Number(delayed || 0);
    } catch {
      pressure = 0;
    }

    const active = pressure > 50;
    const message = `${QUEUE_PRESSURE_PREFIX} ${pressure} items pending or delayed in publish pipeline. Review Publications and queue stats.`;
    await AlertService.syncGlobalAlert(pool, QUEUE_PRESSURE_PREFIX, message, 'warning', active);
  }

  async checkPublishDlq(pool) {
    let dlq = 0;
    try {
      dlq = Number(await getRedis().llen('publish:failed').catch(() => 0));
    } catch {
      dlq = 0;
    }
    const active = dlq > 0;
    const message = `${PUBLISH_DLQ_PREFIX} ${dlq} failed publish command(s) in dead-letter queue. Inspect distribution-engine logs.`;
    await AlertService.syncGlobalAlert(pool, PUBLISH_DLQ_PREFIX, message, 'warning', active);
  }

  async checkRetryBacklog(pool) {
    const res = await pool.query(`
      SELECT COUNT(*)::int AS retrying
      FROM publications
      WHERE status = 'retrying'
    `);
    const retrying = Number(res.rows[0]?.retrying || 0);
    const active = retrying > 10;
    const message = `${RETRY_BACKLOG_PREFIX} ${retrying} publication(s) retrying. Check account health and Instagram limits.`;
    await AlertService.syncGlobalAlert(pool, RETRY_BACKLOG_PREFIX, message, 'warning', active);
  }

  async checkTokenExpiry(pool) {
    const expired = await pool.query(`
      SELECT id::text, username
      FROM accounts
      WHERE ig_access_token IS NOT NULL AND btrim(ig_access_token) <> ''
        AND ig_token_expires_at IS NOT NULL
        AND ig_token_expires_at < NOW()
        AND LOWER(COALESCE(status, '')) NOT IN ('banned', 'inactive')
    `);
    for (const row of expired.rows) {
      await AlertService.syncAccountAlert(
        pool,
        row.id,
        TOKEN_EXPIRED_PREFIX,
        `${TOKEN_EXPIRED_PREFIX} @${row.username} — token expired. Reconnect Instagram before publishing.`,
        'warning',
        true,
      );
    }

    const expiring = await pool.query(`
      SELECT id::text, username, ig_token_expires_at
      FROM accounts
      WHERE ig_access_token IS NOT NULL AND btrim(ig_access_token) <> ''
        AND ig_token_expires_at IS NOT NULL
        AND ig_token_expires_at >= NOW()
        AND ig_token_expires_at < NOW() + INTERVAL '7 days'
        AND LOWER(COALESCE(status, '')) NOT IN ('banned', 'inactive')
    `);
    for (const row of expiring.rows) {
      const when = row.ig_token_expires_at ? new Date(row.ig_token_expires_at).toISOString().slice(0, 10) : '?';
      await AlertService.syncAccountAlert(
        pool,
        row.id,
        TOKEN_EXPIRING_PREFIX,
        `${TOKEN_EXPIRING_PREFIX} @${row.username} — token expires ${when}. Renew soon.`,
        'warning',
        true,
      );
    }
  }

  async checkAccountReadiness(pool) {
    const missingCreds = await pool.query(`
      SELECT id::text, username
      FROM accounts
      WHERE LOWER(COALESCE(status, '')) IN ('active', 'warming')
        AND (
          ig_user_id IS NULL OR btrim(ig_user_id) = ''
          OR ig_access_token IS NULL OR btrim(ig_access_token) = ''
        )
    `);
    for (const row of missingCreds.rows) {
      await AlertService.syncAccountAlert(
        pool,
        row.id,
        MISSING_CREDS_PREFIX,
        `${MISSING_CREDS_PREFIX} @${row.username} — set ig_user_id and ig_access_token on the account.`,
        'warning',
        true,
      );
    }

    const missingProxy = await pool.query(`
      SELECT a.id::text, a.username
      FROM accounts a
      WHERE LOWER(COALESCE(a.status, '')) IN ('active', 'warming')
        AND a.proxy_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM proxies p
          WHERE p.assigned_account_id = a.id AND p.is_active = true
        )
    `);
    for (const row of missingProxy.rows) {
      await AlertService.syncAccountAlert(
        pool,
        row.id,
        MISSING_PROXY_PREFIX,
        `${MISSING_PROXY_PREFIX} @${row.username} — assign a proxy (1:1) before publishing.`,
        'warning',
        true,
      );
    }

    const lowHealth = await pool.query(`
      SELECT id::text, username, health_score
      FROM accounts
      WHERE LOWER(COALESCE(status, '')) IN ('active', 'warming', 'cooldown', 'flagged')
        AND COALESCE(health_score, 100) < 50
    `);
    for (const row of lowHealth.rows) {
      await AlertService.syncAccountAlert(
        pool,
        row.id,
        LOW_HEALTH_PREFIX,
        `${LOW_HEALTH_PREFIX} @${row.username} — health score ${row.health_score ?? 0}/100.`,
        'warning',
        true,
      );
    }
  }

  async checkPublicationFailures(pool) {
    const res = await pool.query(`
      SELECT DISTINCT ON (p.account_id)
        p.account_id::text AS account_id,
        a.username,
        p.error_message
      FROM publications p
      JOIN accounts a ON a.id = p.account_id
      WHERE p.status IN ('failed', 'permanently_failed', 'retrying')
        AND p.updated_at > NOW() - INTERVAL '24 hours'
        AND COALESCE(p.error_message, '') <> ''
      ORDER BY p.account_id, p.updated_at DESC
    `);

    for (const row of res.rows) {
      const detail = String(row.error_message || '').slice(0, 180);
      await AlertService.syncAccountAlert(
        pool,
        row.account_id,
        PUBLISH_FAILED_PREFIX,
        `${PUBLISH_FAILED_PREFIX} @${row.username} — ${detail}`,
        'warning',
        true,
      );
    }
  }

  async checkMissedSchedules(pool) {
    const res = await pool.query(`
      SELECT COUNT(*)::int AS missed
      FROM publication_intents
      WHERE mode = 'scheduled'
        AND status IN ('ready', 'draft', 'pending')
        AND scheduled_for IS NOT NULL
        AND scheduled_for < NOW() - INTERVAL '15 minutes'
    `);
    const missed = Number(res.rows[0]?.missed || 0);
    const active = missed > 0;
    const message = `${SCHEDULE_MISSED_PREFIX} ${missed} scheduled intent(s) past due. Check publish scheduler and calendar.`;
    await AlertService.syncGlobalAlert(pool, SCHEDULE_MISSED_PREFIX, message, 'warning', active);
  }

  async checkGenerationJobs(pool) {
    const failed = await pool.query(`
      SELECT id::text, COALESCE(input_payload->>'topic', '') AS topic
      FROM generation_jobs
      WHERE status = 'failed'
        AND updated_at > NOW() - INTERVAL '48 hours'
      ORDER BY updated_at DESC
      LIMIT 20
    `);
    for (const row of failed.rows) {
      const label = (row.topic || '').trim() || row.id.slice(0, 8);
      await AlertService.syncGlobalAlert(
        pool,
        `${GEN_FAILED_PREFIX}${row.id}`,
        `${GEN_FAILED_PREFIX} ${label} — open Generation Studio for details.`,
        'warning',
        true,
      );
    }

    const stuck = await pool.query(`
      SELECT id::text, COALESCE(input_payload->>'topic', '') AS topic, status
      FROM generation_jobs
      WHERE status IN ('running', 'pending', 'cancelling')
        AND updated_at < NOW() - INTERVAL '2 hours'
      ORDER BY updated_at ASC
      LIMIT 10
    `);
    for (const row of stuck.rows) {
      const label = (row.topic || '').trim() || row.id.slice(0, 8);
      await AlertService.syncGlobalAlert(
        pool,
        `${GEN_STUCK_PREFIX}${row.id}`,
        `${GEN_STUCK_PREFIX} ${label} (${row.status}) — no progress for 2+ hours.`,
        'warning',
        true,
      );
    }
  }
}

module.exports = new OperationalAlertMonitor();
