const { getPool } = require('../core/database');
const InstagramBot = require('./InstagramBot');
const { pushDelayed } = require('../core/redis');
const SafetyGuard = require('../middleware/safetyGuard');
const Humanizer = require('../utils/humanizer');
const { isPublishDryRun, publishModeLabel, dryRunPostUrl } = require('../core/publishMode');

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 30 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

const PERMANENT_ERRORS = [
  'Account Suspended',
  'Content Policy Violation',
  'Account Disabled',
  'Login Required',
  'Invalid Credentials',
  'Reel publish not implemented',
];

const RETRYABLE_ERRORS = [
  'TimeoutError',
  'Navigation timeout',
  'net::ERR_',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up',
  'Action Blocked',
  'Try Again Later',
  'Temporary Block',
];

function logStructured(level, payload) {
  console.log(JSON.stringify({ level, service: 'distribution-engine', component: 'PublishingWorker', ...payload }));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

class PublishingWorker {
  /**
   * Ensure publications FK target exists for this packet id.
   * Content Factory currently enqueues generation jobs directly without persisting content_packets rows.
   */
  async ensureContentPacketExists(packet) {
    const pool = getPool();
    await pool.query(
      `INSERT INTO content_packets (
         id, type, caption, visual_url, hashtags, target_accounts, scheduled_at, niche, status, metadata, created_at, updated_at
       )
       VALUES (
         $1::uuid,
         $2,
         $3,
         $4,
         COALESCE($5::jsonb, '[]'::jsonb),
         COALESCE($6::jsonb, '[]'::jsonb),
         $7::timestamptz,
         $8,
         'queued',
         COALESCE($9::jsonb, '{}'::jsonb),
         NOW(),
         NOW()
       )
       ON CONFLICT (id)
       DO UPDATE SET
         type = EXCLUDED.type,
         caption = EXCLUDED.caption,
         visual_url = EXCLUDED.visual_url,
         hashtags = EXCLUDED.hashtags,
         target_accounts = EXCLUDED.target_accounts,
         scheduled_at = EXCLUDED.scheduled_at,
         niche = EXCLUDED.niche,
         metadata = COALESCE(content_packets.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        packet.id,
        packet.type || 'reel',
        packet.caption || null,
        packet.visual_url || null,
        JSON.stringify(packet.hashtags || []),
        JSON.stringify(packet.target_accounts || []),
        packet.scheduled_at || null,
        packet.niche || null,
        JSON.stringify(packet.metadata || {}),
      ]
    );
  }

  classifyError(error) {
    const msg = (error.message || '').toLowerCase();

    for (const pattern of PERMANENT_ERRORS) {
      if (msg.includes(pattern.toLowerCase())) return 'permanent';
    }

    for (const pattern of RETRYABLE_ERRORS) {
      if (msg.includes(pattern.toLowerCase())) return 'retryable';
    }

    return 'unknown';
  }

  getRetryDelay(attempt) {
    const delay = Math.pow(2, attempt) * BASE_RETRY_DELAY_MS;
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
  }

  getRequeueProfile(reason, retryCount = 0) {
    if (reason === 'daily_limit_exceeded' || reason === 'safety_daily_limit') {
      return { delayMs: 2 * 60 * 60 * 1000, code: 'REQUEUE_DAILY_LIMIT' };
    }
    if (reason.startsWith('safety_cooldown_') || reason.startsWith('min_interval_wait_')) {
      return { delayMs: 60 * 1000, code: 'REQUEUE_COOLDOWN' };
    }
    const computed = this.getRetryDelay(retryCount);
    return { delayMs: computed, code: 'REQUEUE_RETRY_BACKOFF' };
  }

  /**
   * Idempotency: skip external publish if we already recorded success for this account + packet.
   */
  async findExistingPublished(accountId, packetId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, instagram_post_id, status
       FROM publications
       WHERE account_id = $1 AND content_packet_id = $2 AND status = 'published'
       ORDER BY published_at DESC NULLS LAST
       LIMIT 1`,
      [accountId, packetId]
    );
    return result.rows[0] || null;
  }

  async processPacket(packet) {
    if (!packet || !packet.id) {
      logStructured('error', { code: 'INVALID_PACKET', detail: 'missing packet.id' });
      return;
    }
    if (!Array.isArray(packet.target_accounts) || packet.target_accounts.length === 0) {
      logStructured('error', { code: 'INVALID_PACKET', packetId: packet.id, detail: 'target_accounts empty' });
      return;
    }

    const { id, target_accounts, type } = packet;
    const invalidAccountId = target_accounts.find((accId) => !isUuid(accId));
    if (invalidAccountId) {
      logStructured('error', {
        code: 'INVALID_TARGET_ACCOUNT_ID',
        packetId: id,
        accountId: invalidAccountId,
        detail: 'target_accounts must contain UUID values only',
      });
      return;
    }
    // Keep publications FK valid even when packet originates from generation-jobs.
    await this.ensureContentPacketExists(packet);
    logStructured('info', {
      event: 'process_packet_start',
      packetId: id,
      mode: publishModeLabel(),
      publish_mode: publishModeLabel() === 'DRY_RUN' ? 'DRY_RUN_MODE' : 'REAL_PUBLISH_MODE',
      accounts: target_accounts.length,
    });

    const dryRun = isPublishDryRun();
    for (let i = 0; i < target_accounts.length; i++) {
      const accountId = target_accounts[i];
      try {
        const existing = await this.findExistingPublished(accountId, id);
        if (existing) {
          logStructured('info', {
            event: 'publish_skipped_idempotent',
            accountId,
            packetId: id,
            publicationId: existing.id,
            instagramPostId: existing.instagram_post_id || null,
          });
          continue;
        }

        if (!dryRun) {
          const safetyCheck = await SafetyGuard.preActionValidation(accountId, 'post');
          if (!safetyCheck.allowed) {
            logStructured('warn', { event: 'safety_block', accountId, packetId: id, reason: safetyCheck.reason });
            await this.logPublicationAttempt(accountId, id, type, null, 'failed', 'safety_block', safetyCheck.reason);

            if (safetyCheck.blockType === 'daily_limit') {
            await this.requeueWithDelay(packet, accountId, 'safety_daily_limit');
            } else if (safetyCheck.waitTime) {
            await this.requeueWithDelay(packet, accountId, `safety_cooldown_${safetyCheck.waitTime}s`, safetyCheck.waitTime * 1000);
            }
            continue;
          }

          const canPublish = await this.checkRateLimit(accountId);
          if (!canPublish) {
            logStructured('warn', { event: 'rate_limit', accountId, packetId: id });
            await this.logPublicationAttempt(accountId, id, type, null, 'failed', 'rate_limit', 'Daily rate limit exceeded');
            await this.requeueWithDelay(packet, accountId, 'daily_limit_exceeded');
            continue;
          }

          const intervalCheck = await this.checkMinInterval(accountId);
          if (!intervalCheck.allowed) {
            logStructured('warn', { event: 'min_interval', accountId, packetId: id, waitMinutes: intervalCheck.waitMinutes });
            await this.requeueWithDelay(packet, accountId, `min_interval_wait_${intervalCheck.waitMinutes}m`);
            continue;
          }
        } else {
          logStructured('info', { event: 'dry_run_bypass_guards', accountId, packetId: id });
        }

        const humanDelay = Humanizer.getRandomDelay('post');
        logStructured('info', { event: 'human_delay_ms', ms: humanDelay, accountId, packetId: id });
        await new Promise((resolve) => setTimeout(resolve, humanDelay));

        if (process.env.PUBLISH_SKIP_RACE_RECHECK !== 'true') {
          const raceJitterMs = 200 + Math.floor(Math.random() * 301);
          await new Promise((resolve) => setTimeout(resolve, raceJitterMs));
          const afterRaceCheck = await this.findExistingPublished(accountId, id);
          if (afterRaceCheck) {
            logStructured('info', {
              event: 'publish_skipped_idempotent_recheck',
              accountId,
              packetId: id,
              publicationId: afterRaceCheck.id,
              instagramPostId: afterRaceCheck.instagram_post_id || null,
              raceJitterMs,
            });
            continue;
          }
        }

        let postUrl;
        try {
          postUrl = await this.executeExternalPublish(accountId, packet, type);
        } catch (publishErr) {
          await SafetyGuard.postActionProcessing(accountId, 'post', null, false);
          const failureType = this.classifyError(publishErr);
          const errMsg = publishErr.message || String(publishErr);
          logStructured('error', { event: 'publish_failed', accountId, packetId: id, failureType, message: errMsg });

          const retryCount = await this.getRetryCount(accountId, id);

          if (failureType === 'permanent') {
            await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', failureType, errMsg);
            if (errMsg.includes('Action Blocked') || errMsg.includes('Suspended')) {
              const BanMonitor = require('../health/BanMonitor');
              await BanMonitor.recordAlert(accountId, 'ban', errMsg);
              const backupId = await BanMonitor.getBackupAccount(accountId);
              if (backupId && !target_accounts.includes(backupId)) {
                target_accounts.push(backupId);
              }
            }
          } else if (retryCount >= MAX_RETRIES) {
            await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', 'max_retries_exhausted', errMsg);
          } else {
            const delay = this.getRetryDelay(retryCount);
            await this.logPublicationAttempt(accountId, id, type, null, 'retrying', failureType, errMsg, retryCount + 1);
            await this.requeueWithDelay(packet, accountId, `retry_${retryCount + 1}`, delay);
          }
          continue;
        }

        try {
          await this.logPublication(accountId, id, postUrl);
        } catch (dbErr) {
          if (dbErr && dbErr.code === '23505') {
            await new Promise((resolve) => setTimeout(resolve, 75));
            const winner = await this.findExistingPublished(accountId, id);
            logStructured('info', {
              event: 'publish_skipped_idempotent_db',
              accountId,
              packetId: id,
              publicationId: winner?.id || null,
              instagramPostId: winner?.instagram_post_id || null,
              note: 'unique partial index blocked duplicate published row (concurrent or replay)',
            });
            postUrl = winner?.instagram_post_id || postUrl;
          } else {
            logStructured('critical', {
              code: 'POST_PUBLISH_DB_FAILURE',
              message: 'External publish succeeded but publications row insert failed — check DB schema and manual reconciliation',
              accountId,
              packetId: id,
              postUrl,
              dbError: dbErr.message,
            });
            const e = new Error('POST_PUBLISH_DB_FAILURE');
            e.code = 'POST_PUBLISH_DB_FAILURE';
            e.cause = dbErr;
            throw e;
          }
        }

        const poolCp = getPool();
        try {
          await poolCp.query(
            "UPDATE content_packets SET status = 'published', updated_at = NOW() WHERE id = $1::uuid",
            [id]
          );
        } catch (cpErr) {
          logStructured('critical', {
            code: 'CONTENT_PACKET_STATUS_UPDATE_FAILED',
            message: 'publications row inserted but content_packets update failed',
            packetId: id,
            dbError: cpErr.message,
          });
        }

        await this.updateLastActivity(accountId);
        await SafetyGuard.postActionProcessing(accountId, 'post', null, true);
        logStructured('info', { event: 'publish_success', accountId, packetId: id, postUrl });
      } catch (botError) {
        if (botError && botError.code === 'POST_PUBLISH_DB_FAILURE') {
          logStructured('critical', { event: 'publish_pipeline_stopped_db', accountId, packetId: id });
          throw botError;
        }
        await SafetyGuard.postActionProcessing(accountId, 'post', null, false);
        const errMsg = botError.message || '';
        const failureType = this.classifyError(botError);
        logStructured('error', { event: 'unexpected_worker_error', accountId, packetId: id, failureType, message: errMsg });
        const retryCount = await this.getRetryCount(accountId, id);
        if (failureType === 'permanent') {
          await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', failureType, errMsg);
        } else if (retryCount >= MAX_RETRIES) {
          await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', 'max_retries_exhausted', errMsg);
        } else {
          const delay = this.getRetryDelay(retryCount);
          await this.logPublicationAttempt(accountId, id, type, null, 'retrying', failureType, errMsg, retryCount + 1);
          await this.requeueWithDelay(packet, accountId, `retry_${retryCount + 1}`, delay);
        }
      }
    }
  }

  async executeExternalPublish(accountId, packet, type) {
    if (isPublishDryRun()) {
      const url = dryRunPostUrl(packet.id);
      logStructured('info', {
        event: 'DRY_RUN_MODE',
        publish_mode: 'DRY_RUN_MODE',
        action: 'skip_instagram',
        accountId,
        packetId: packet.id,
        fakeUrl: url,
      });
      return url;
    }

    logStructured('info', {
      event: 'external_publish_begin',
      accountId,
      packetId: packet.id,
      contentType: packet.visual_type === 'video' || type === 'reel' ? 'reel' : 'post',
    });

    if (packet.visual_type === 'video' || type === 'reel') {
      return await this.publishReel(packet, accountId);
    }

    return await InstagramBot.publishContent(accountId, packet);
  }

  async checkRateLimit(accountId) {
    const pool = getPool();
    const WarmupManager = require('../managers/WarmupManager');

    const limit = await WarmupManager.calculateDailyLimit(accountId);

    const result = await pool.query(
      `SELECT count(*) FROM publications 
       WHERE account_id = $1 AND published_at >= CURRENT_DATE`,
      [accountId]
    );

    const count = parseInt(result.rows[0].count, 10);
    return count < limit;
  }

  async checkMinInterval(accountId) {
    const WarmupManager = require('../managers/WarmupManager');
    return await WarmupManager.checkMinInterval(accountId);
  }

  async getRetryCount(accountId, packetId) {
    const pool = getPool();
    try {
      const result = await pool.query(
        `SELECT COALESCE(MAX(retry_count), 0) as retry_count 
         FROM publications 
         WHERE account_id = $1 AND content_packet_id = $2`,
        [accountId, packetId]
      );
      return parseInt(result.rows[0].retry_count, 10);
    } catch (err) {
      logStructured('error', { code: 'retry_count_query_failed', accountId, packetId, message: err.message });
      return 0;
    }
  }

  async requeueWithDelay(packet, accountId, reason, customDelayMs = null) {
    const profile = this.getRequeueProfile(reason);
    const delayMs = customDelayMs || profile.delayMs;
    logStructured('info', { event: 'requeue_delayed', accountId, packetId: packet.id, reason, delayMs, requeue_code: profile.code });
    await pushDelayed(JSON.stringify(packet), delayMs);
  }

  /**
   * Persist successful publish — columns MUST match infra/init.sql publications.
   */
  async logPublication(accountId, packetId, postUrl) {
    const pool = getPool();
    const query = `
      INSERT INTO publications (
        id, account_id, content_packet_id, status, instagram_post_id,
        published_at, retry_count, created_at, updated_at
      )
      VALUES (gen_random_uuid(), $1, $2, 'published', $3, NOW(), 0, NOW(), NOW())
    `;
    await pool.query(query, [accountId, packetId, postUrl]);
  }

  async logPublicationAttempt(accountId, packetId, type, postUrl, status, failureType, errorMessage, retryCount = 0) {
    const pool = getPool();
    try {
      const existing = await pool.query(
        `SELECT id FROM publications WHERE account_id = $1 AND content_packet_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [accountId, packetId]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE publications 
           SET status = $1, error_message = $2, retry_count = $3, failure_type = $4, last_retry_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [status, errorMessage, retryCount, failureType, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO publications (
            id, account_id, content_packet_id, status, instagram_post_id,
            error_message, retry_count, failure_type, last_retry_at, created_at, updated_at
          )
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())`,
          [accountId, packetId, status, postUrl, errorMessage, retryCount, failureType]
        );
      }
    } catch (err) {
      logStructured('error', {
        code: 'log_publication_attempt_db_failed',
        accountId,
        packetId,
        status,
        message: err.message,
      });
    }
  }

  async publishReel(packet, accountId) {
    if (isPublishDryRun()) {
      const url = dryRunPostUrl(`${packet.id}-reel`);
      logStructured('info', {
        event: 'DRY_RUN_MODE',
        publish_mode: 'DRY_RUN_MODE',
        action: 'skip_reel_publish',
        accountId,
        packetId: packet.id,
        fakeUrl: url,
      });
      return url;
    }
    logStructured('warn', { event: 'reel_not_implemented', accountId, packetId: packet.id });
    throw new Error('Reel publish not implemented — set PUBLISH_DRY_RUN=true for demos or implement reel flow');
  }

  async updateLastActivity(accountId) {
    const pool = getPool();
    await pool.query(
      `UPDATE accounts SET last_activity_at = NOW(), daily_post_count = daily_post_count + 1 WHERE id = $1`,
      [accountId]
    );
  }
}

module.exports = new PublishingWorker();
