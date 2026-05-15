const { getPool } = require('../core/database');
const InstagramBot = require('./InstagramBot');
const { pushDelayed } = require('../core/redis');
const SafetyGuard = require('../middleware/safetyGuard');
const Humanizer = require('../utils/humanizer');
const { isPublishDryRun, publishModeLabel, dryRunPostUrl } = require('../core/publishMode');
const { publishPipelineLog } = require('../core/publishPipelineLog');

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 30 * 1000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

const PERMANENT_ERRORS = [
  'Account Suspended',
  'Content Policy Violation',
  'Account Disabled',
  'Login Required',
  'Invalid Credentials',
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

const PUBLISH_QUEUE_COMMANDS = 'publish:commands';
const PUBLISH_QUEUE_FAILED = 'publish:failed';
const PUBLISH_ADAPTER_TIMEOUT_MS = parseInt(process.env.PUBLISH_ADAPTER_TIMEOUT_MS || '300000', 10);
const PUBLISH_STALE_PROCESSING_TIMEOUT_SECONDS = parseInt(
  process.env.PUBLISH_STALE_PROCESSING_TIMEOUT_SECONDS || '900',
  10
);

function publishAdapterTimeoutPromise(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('PUBLISH_EXECUTION_TIMEOUT')), ms);
  });
}

class PublishingWorker {
  /**
   * Mirror a terminal publication_targets row into publications (single UI source of truth).
   * Call only when target status is published, failed, or uncertain — not during retries.
   */
  async syncPublicationRowForIntentTarget(pool, targetId) {
    const { rows } = await pool.query(
      `SELECT pt.id, pt.account_id, pt.status, pt.external_post_id, pt.published_at, pt.last_error,
              pt.retry_count, pt.max_retries
       FROM publication_targets pt
       WHERE pt.id = $1::uuid`,
      [targetId]
    );
    if (!rows.length) return;
    const t = rows[0];
    const st = String(t.status || '');
    if (!['published', 'failed', 'uncertain'].includes(st)) return;

    let status;
    let failureType = null;
    let errorMessage = null;
    let instagramPostId = null;
    let publishedAt = null;

    if (st === 'published') {
      status = 'published';
      instagramPostId = t.external_post_id ? String(t.external_post_id).slice(0, 200) : null;
      publishedAt = t.published_at || new Date();
    } else if (st === 'uncertain') {
      status = 'failed';
      failureType = 'uncertain';
      errorMessage = String(t.last_error || 'uncertain_publish_state').slice(0, 8000);
    } else {
      const maxR = parseInt(t.max_retries, 10);
      const rc = parseInt(t.retry_count, 10);
      const exhausted = Number.isFinite(rc) && Number.isFinite(maxR) && rc >= maxR;
      status = exhausted ? 'permanently_failed' : 'failed';
      failureType = exhausted ? 'max_retries_exhausted' : 'adapter_error';
      errorMessage = String(t.last_error || 'publish_failed').slice(0, 8000);
    }

    const existing = await pool.query(
      `SELECT id FROM publications WHERE publication_target_id = $1::uuid LIMIT 1`,
      [targetId]
    );

    if (existing.rows.length) {
      await pool.query(
        `UPDATE publications SET
           status = $2,
           instagram_post_id = CASE WHEN $2 = 'published' THEN COALESCE($3, instagram_post_id) ELSE instagram_post_id END,
           published_at = CASE WHEN $2 = 'published' THEN COALESCE($4::timestamptz, published_at, NOW()) ELSE published_at END,
           error_message = $5,
           retry_count = $6,
           max_retries = COALESCE($7, max_retries),
           failure_type = $8,
           next_retry_at = NULL,
           updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          existing.rows[0].id,
          status,
          instagramPostId,
          publishedAt,
          errorMessage,
          t.retry_count,
          t.max_retries,
          failureType,
        ]
      );
    } else {
      await pool.query(
        `INSERT INTO publications (
           id, account_id, content_packet_id, publication_target_id, status, instagram_post_id,
           published_at, error_message, retry_count, max_retries, failure_type, next_retry_at, last_retry_at,
           created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, NULL, $2::uuid, $3, $4,
           CASE WHEN $3 = 'published' THEN COALESCE($5::timestamptz, NOW()) ELSE NULL END,
           $6, $7, COALESCE($8, 3), $9, NULL, NULL,
           NOW(), NOW()
         )`,
        [
          t.account_id,
          targetId,
          status,
          instagramPostId,
          publishedAt,
          errorMessage,
          t.retry_count,
          t.max_retries,
          failureType,
        ]
      );
    }
  }

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
            const nextRetryAt = new Date(Date.now() + delay).toISOString();
            await this.logPublicationAttempt(accountId, id, type, null, 'retrying', failureType, errMsg, retryCount + 1, nextRetryAt);
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
          const nextRetryAt = new Date(Date.now() + delay).toISOString();
          await this.logPublicationAttempt(accountId, id, type, null, 'retrying', failureType, errMsg, retryCount + 1, nextRetryAt);
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
        published_at, retry_count, max_retries, next_retry_at, created_at, updated_at
      )
      VALUES (gen_random_uuid(), $1, $2, 'published', $3, NOW(), 0, $4, NULL, NOW(), NOW())
    `;
    await pool.query(query, [accountId, packetId, postUrl, MAX_RETRIES]);
  }

  async logPublicationAttempt(
    accountId,
    packetId,
    type,
    postUrl,
    status,
    failureType,
    errorMessage,
    retryCount = 0,
    nextRetryAt = null
  ) {
    const pool = getPool();
    try {
      const existing = await pool.query(
        `SELECT id FROM publications WHERE account_id = $1 AND content_packet_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [accountId, packetId]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE publications 
           SET status = $1, error_message = $2, retry_count = $3, failure_type = $4, max_retries = $5, last_retry_at = NOW(), next_retry_at = $6, updated_at = NOW()
           WHERE id = $7`,
          [status, errorMessage, retryCount, failureType, MAX_RETRIES, nextRetryAt, existing.rows[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO publications (
            id, account_id, content_packet_id, status, instagram_post_id,
            error_message, retry_count, max_retries, failure_type, last_retry_at, next_retry_at, created_at, updated_at
          )
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW(), NOW())`,
          [accountId, packetId, status, postUrl, errorMessage, retryCount, MAX_RETRIES, failureType, nextRetryAt]
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
    // Fallback: use the existing Playwright publish path so reel-type packets
    // no longer fail permanently on the legacy queue pipeline.
    logStructured('warn', {
      event: 'reel_publish_fallback_to_instagram_bot',
      accountId,
      packetId: packet.id,
    });
    return await InstagramBot.publishContent(accountId, packet);
  }

  publishLog(level, payload) {
    const worker_id = this._publishWorkerId || null;
    console.log(
      JSON.stringify({
        level,
        service: 'distribution-engine',
        component: 'PublishingWorker',
        worker_id,
        ...payload,
      })
    );
  }

  async recoverPublishProcessingQueue(redis, processingKey) {
    let moved = 0;
    for (;;) {
      const item = await redis.rpop(processingKey);
      if (item == null) break;
      await redis.lpush(PUBLISH_QUEUE_COMMANDS, item);
      moved += 1;
    }
    if (moved > 0) {
      this.publishLog('info', {
        event: 'publish_processing_recovery_requeued',
        count: moved,
        status: 'recovery',
      });
    }
  }

  async recoverAllPublishProcessingQueues(redis) {
    let cursor = '0';
    const keys = [];
    do {
      const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'publish:processing:*', 'COUNT', 100);
      cursor = nextCursor;
      if (Array.isArray(batch) && batch.length > 0) keys.push(...batch);
    } while (cursor !== '0');

    let totalMoved = 0;
    for (const key of keys) {
      let moved = 0;
      for (;;) {
        const item = await redis.rpop(key);
        if (item == null) break;
        await redis.lpush(PUBLISH_QUEUE_COMMANDS, item);
        moved += 1;
      }
      if (moved > 0) {
        totalMoved += moved;
        this.publishLog('info', {
          event: 'publish_processing_recovery_key_requeued',
          processing_key: key,
          count: moved,
          status: 'recovery',
        });
      }
    }

    if (totalMoved > 0) {
      this.publishLog('info', {
        event: 'publish_processing_recovery_all_requeued',
        count: totalMoved,
        keys_scanned: keys.length,
        status: 'recovery',
      });
    }
  }

  /**
   * Recovery on startup: move stale DB targets out of `publishing`.
   * - pending when retries are still available
   * - failed when retries exhausted
   */
  async recoverStalePublishingTargets() {
    const pool = getPool();
    const staleSeconds = Number.isFinite(PUBLISH_STALE_PROCESSING_TIMEOUT_SECONDS)
      ? Math.max(60, PUBLISH_STALE_PROCESSING_TIMEOUT_SECONDS)
      : 900;

    const retryable = await pool.query(
      `UPDATE publication_targets
       SET status = 'pending',
           updated_at = NOW(),
           last_error = COALESCE(last_error, 'Recovered from stale publishing state after worker restart')
       WHERE status = 'publishing'
         AND retry_count < max_retries
         AND updated_at < NOW() - ($1::text || ' seconds')::interval
       RETURNING id`,
      [String(staleSeconds)]
    );

    const exhausted = await pool.query(
      `UPDATE publication_targets
       SET status = 'failed',
           updated_at = NOW(),
           last_error = COALESCE(last_error, 'Marked failed after stale publishing state and exhausted retries')
       WHERE status = 'publishing'
         AND retry_count >= max_retries
         AND updated_at < NOW() - ($1::text || ' seconds')::interval
       RETURNING id`,
      [String(staleSeconds)]
    );

    this.publishLog('info', {
      event: 'publish_stale_recovery_completed',
      stale_timeout_seconds: staleSeconds,
      requeued_pending: retryable.rowCount,
      marked_failed: exhausted.rowCount,
      status: 'recovery',
    });
  }

  async lremPublishProcessing(redis, processingKey, rawPayload) {
    await redis.lrem(processingKey, 1, rawPayload);
  }

  async pushPublishDlq(redis, originalMessage, error) {
    const envelope = {
      original_message: originalMessage,
      error: String(error || '').slice(0, 8000),
      failed_at: new Date().toISOString(),
    };
    await redis.lpush(PUBLISH_QUEUE_FAILED, JSON.stringify(envelope));
    this.publishLog('error', {
      event: 'publish_command_dlq',
      intent_id: originalMessage && originalMessage.intent_id,
      target_id: originalMessage && originalMessage.target_id,
      retry_count: null,
      status: 'failed',
      error: envelope.error,
    });
  }

  async tryAggregateIntent(pool, intentId, meta) {
    try {
      await this.aggregatePublicationIntentStatus(pool, intentId);
    } catch (e) {
      this.publishLog('error', {
        event: 'publish_intent_aggregate_failed',
        intent_id: intentId,
        error: e.message,
        ...meta,
      });
    }
  }

  /**
   * After publish failure while target is `publishing`: retry (DB pending + requeue) or failed + DLQ.
   * Retry: LPUSH commands then LREM processing (no message loss on crash). Permanent: DLQ then LREM.
   */
  async handlePublishFailure(pool, redis, rawPayload, payload, errMsg, processingKey, allowRetry = true) {
    const targetId = payload.target_id;
    const intentId = payload.intent_id;

    try {
      if (allowRetry) {
        const retryRes = await pool.query(
          `UPDATE publication_targets
           SET
             retry_count = retry_count + 1,
             status = 'pending',
             last_error = $2,
             updated_at = NOW()
           WHERE id = $1::uuid
             AND status = 'publishing'
             AND retry_count < max_retries
           RETURNING retry_count, max_retries, status`,
          [targetId, String(errMsg).slice(0, 8000)]
        );

        if (retryRes.rowCount > 0) {
          const row = retryRes.rows[0];
          await redis.lpush(PUBLISH_QUEUE_COMMANDS, rawPayload);
          await this.lremPublishProcessing(redis, processingKey, rawPayload);
          this.publishLog('warn', {
            event: 'publish_command_retry_scheduled',
            intent_id: intentId,
            target_id: targetId,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            status: row.status,
            error: String(errMsg).slice(0, 500),
          });
          return;
        }
      }

      await pool.query(
        `UPDATE publication_targets
         SET status = $3,
             publish_stage = COALESCE($4, publish_stage),
             provider_container_id = COALESCE($5, provider_container_id),
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1::uuid AND status = 'publishing'`,
        [
          targetId,
          String(errMsg).slice(0, 8000),
          allowRetry ? 'failed' : 'uncertain',
          payload.publish_stage || null,
          payload.provider_container_id || null,
        ]
      );

      await this.syncPublicationRowForIntentTarget(pool, targetId);

      await this.pushPublishDlq(redis, payload, allowRetry ? errMsg : `UNCERTAIN_PUBLISH_STATE: ${errMsg}`);
      await this.lremPublishProcessing(redis, processingKey, rawPayload);

      this.publishLog('error', {
        event: allowRetry ? 'publish_command_permanent_failure' : 'publish_command_marked_uncertain',
        intent_id: intentId,
        target_id: targetId,
        status: allowRetry ? 'failed' : 'uncertain',
        allow_retry: allowRetry,
        error: String(errMsg).slice(0, 500),
      });

      await this.tryAggregateIntent(pool, intentId, { target_id: targetId });
    } catch (e) {
      this.publishLog('critical', {
        event: 'publish_handle_failure_broken',
        intent_id: intentId,
        target_id: targetId,
        status: 'error',
        error: e.message,
      });
      try {
        await redis.lpush(PUBLISH_QUEUE_COMMANDS, rawPayload);
      } catch (_) {}
      try {
        await this.lremPublishProcessing(redis, processingKey, rawPayload);
      } catch (_) {}
    }
  }

  /**
   * BRPOPLPUSH publish:commands → publish:processing:{workerId} (per-process queue; no cross-worker steal).
   */
  startPublishConsumer() {
    const Redis = require('ioredis');
    const { randomUUID } = require('crypto');
    this._publishWorkerId = randomUUID();
    this._publishProcessingKey = `publish:processing:${this._publishWorkerId}`;

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const consumer = new Redis(redisUrl);

    console.log(
      `👂 publish:commands → ${this._publishProcessingKey} (worker ${this._publishWorkerId})`
    );

    const MAX_CONCURRENT = parseInt(
      process.env.MAX_PUBLISH_CONCURRENT || process.env.MAX_CONCURRENT_WORKERS || '3',
      10
    );
    let currentWorkers = 0;
    const processingKey = this._publishProcessingKey;

    (async () => {
      try {
        await this.recoverAllPublishProcessingQueues(consumer);
        await this.recoverPublishProcessingQueue(consumer, processingKey);
        await this.recoverStalePublishingTargets();
      } catch (recErr) {
        this.publishLog('error', {
          event: 'publish_processing_recovery_failed',
          message: recErr.message,
          status: 'error',
        });
      }

      const poll = async () => {
        if (currentWorkers >= MAX_CONCURRENT) {
          setTimeout(poll, 500);
          return;
        }

        try {
          const rawPayload = await consumer.brpoplpush(
            PUBLISH_QUEUE_COMMANDS,
            processingKey,
            2
          );

          if (rawPayload) {
            currentWorkers++;
            this.processPublishCommand(rawPayload, consumer, processingKey)
              .catch((err) => {
                const msg = err && err.message ? err.message : String(err);
                this.publishLog('error', {
                  event: 'publish_command_outer_error',
                  intent_id: null,
                  target_id: null,
                  retry_count: null,
                  status: 'error',
                  error: msg,
                });
              })
              .finally(() => {
                currentWorkers--;
                setImmediate(poll);
              });
            return;
          }

          setImmediate(poll);
        } catch (err) {
          this.publishLog('error', {
            event: 'publish_command_consumer_redis_error',
            message: err.message,
            status: 'error',
          });
          setTimeout(poll, 5000);
        }
      };

      poll();
    })();
  }

  async aggregatePublicationIntentStatus(pool, intentId) {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'published')::int AS published_cnt,
         COUNT(*) FILTER (WHERE status IN ('failed', 'uncertain'))::int AS failed_cnt,
         COUNT(*) FILTER (WHERE status IN ('pending', 'publishing'))::int AS open_cnt
       FROM publication_targets
       WHERE publication_intent_id = $1::uuid`,
      [intentId]
    );

    const row = r.rows[0];
    const total = row.total;
    if (total === 0) return;
    if (row.open_cnt > 0) return;

    let intentStatus;
    if (row.published_cnt === total) intentStatus = 'published';
    else if (row.failed_cnt === total) intentStatus = 'failed';
    else if (row.published_cnt > 0 && row.failed_cnt > 0) intentStatus = 'partial_failed';
    else return;

    await pool.query(
      `UPDATE publication_intents
       SET status = $1,
           error_message = CASE WHEN $1 = 'published' THEN NULL ELSE error_message END,
           updated_at = NOW()
       WHERE id = $2::uuid`,
      [intentStatus, intentId]
    );
  }

  async processPublishCommand(rawPayload, redis, processingKey) {
    const pool = getPool();
    let payload = null;
    let intentId;
    let targetId;

    const safeLrem = async () => {
      try {
        await this.lremPublishProcessing(redis, processingKey, rawPayload);
      } catch (e) {
        this.publishLog('error', {
          event: 'publish_processing_lrem_failed',
          message: e.message,
          status: 'error',
        });
      }
    };

    const safeRequeueCommands = async () => {
      try {
        await redis.lpush(PUBLISH_QUEUE_COMMANDS, rawPayload);
        await this.lremPublishProcessing(redis, processingKey, rawPayload);
      } catch (e) {
        this.publishLog('error', {
          event: 'publish_command_requeue_failed',
          message: e.message,
          status: 'error',
        });
      }
    };

    try {
      try {
        payload = JSON.parse(rawPayload);
      } catch (parseErr) {
        this.publishLog('error', {
          event: 'publish_command_invalid_json',
          intent_id: null,
          target_id: null,
          retry_count: null,
          status: 'error',
          message: parseErr.message,
        });
        await this.pushPublishDlq(
          redis,
          { raw_payload: String(rawPayload).slice(0, 8000) },
          parseErr.message
        );
        await safeLrem();
        return;
      }

      intentId = payload.intent_id;
      targetId = payload.target_id;

      publishPipelineLog('worker_command_parsed', {
        intent_id: intentId,
        target_id: targetId,
        generation_job_id: payload.generation_job_id || null,
        body: payload,
      });

      if (!isUuid(targetId) || !isUuid(intentId)) {
        this.publishLog('warn', {
          event: 'publish_command_invalid_ids',
          intent_id: intentId,
          target_id: targetId,
          status: null,
          retry_count: null,
        });
        await this.pushPublishDlq(redis, payload, 'invalid_ids');
        await safeLrem();
        return;
      }

      const statusRes = await pool.query(
        `SELECT status, retry_count, max_retries, external_post_id
         FROM publication_targets WHERE id = $1::uuid`,
        [targetId]
      );

      if (!statusRes.rows.length) {
        this.publishLog('warn', {
          event: 'publish_command_target_not_found',
          intent_id: intentId,
          target_id: targetId,
          status: null,
          retry_count: null,
        });
        await this.pushPublishDlq(redis, payload, 'target_not_found');
        await safeLrem();
        return;
      }

      const row0 = statusRes.rows[0];
      const current = row0.status;
      const rc = parseInt(row0.retry_count, 10);
      const extId = row0.external_post_id;

      if (current === 'published') {
        this.publishLog('info', {
          event: 'publish_command_skipped_idempotent',
          intent_id: intentId,
          target_id: targetId,
          status: current,
          retry_count: rc,
        });
        await this.syncPublicationRowForIntentTarget(pool, targetId);
        await safeLrem();
        return;
      }
      if (current === 'publishing' && extId) {
        await pool.query(
          `UPDATE publication_targets
           SET status = 'published',
               published_at = COALESCE(published_at, NOW()),
               updated_at = NOW()
           WHERE id = $1::uuid AND status = 'publishing'`,
          [targetId]
        );
        await this.syncPublicationRowForIntentTarget(pool, targetId);
        await safeLrem();
        await this.tryAggregateIntent(pool, intentId, { target_id: targetId, status: 'published' });
        this.publishLog('info', {
          event: 'publish_command_skipped_adapter_external_id',
          intent_id: intentId,
          target_id: targetId,
          status: 'published',
          retry_count: rc,
        });
        return;
      }
      if (current === 'publishing') {
        this.publishLog('info', {
          event: 'publish_command_skipped_idempotent',
          intent_id: intentId,
          target_id: targetId,
          status: current,
          retry_count: rc,
        });
        await safeLrem();
        return;
      }
      if (current !== 'pending') {
        if (current === 'uncertain') {
          this.publishLog('warn', {
            event: 'publish_command_skipped_uncertain',
            intent_id: intentId,
            target_id: targetId,
            status: current,
            retry_count: rc,
          });
          await safeLrem();
          return;
        }
        this.publishLog('info', {
          event: 'publish_command_skipped_status',
          intent_id: intentId,
          target_id: targetId,
          status: current,
          retry_count: rc,
        });
        await this.pushPublishDlq(redis, payload, `skip_non_pending:${current}`);
        await safeLrem();
        return;
      }

      this.publishLog('info', {
        event: 'publish_command_message_received',
        intent_id: intentId,
        target_id: targetId,
        status: current,
        retry_count: rc,
      });

      const claim = await pool.query(
        `UPDATE publication_targets
         SET status = 'publishing', updated_at = NOW()
         WHERE id = $1::uuid AND status = 'pending'
         RETURNING id, retry_count, max_retries`,
        [targetId]
      );

      if (claim.rowCount === 0) {
        this.publishLog('info', {
          event: 'publish_command_claim_skipped',
          intent_id: intentId,
          target_id: targetId,
          status: current,
          retry_count: rc,
        });
        await safeRequeueCommands();
        return;
      }

      const claimed = claim.rows[0];

      const postClaim = await pool.query(
        `SELECT external_post_id FROM publication_targets WHERE id = $1::uuid`,
        [targetId]
      );
      if (postClaim.rows[0] && postClaim.rows[0].external_post_id) {
        await pool.query(
          `UPDATE publication_targets
           SET status = 'published',
               published_at = COALESCE(published_at, NOW()),
               updated_at = NOW()
           WHERE id = $1::uuid AND status = 'publishing'`,
          [targetId]
        );
        await this.syncPublicationRowForIntentTarget(pool, targetId);
        await safeLrem();
        await this.tryAggregateIntent(pool, intentId, { target_id: targetId, status: 'published' });
        this.publishLog('info', {
          event: 'publish_command_skipped_adapter_external_id',
          intent_id: intentId,
          target_id: targetId,
          status: 'published',
          retry_count: claimed.retry_count,
        });
        return;
      }

      this.publishLog('info', {
        event: 'publish_command_processing_start',
        intent_id: intentId,
        target_id: targetId,
        status: 'publishing',
        retry_count: claimed.retry_count,
        max_retries: claimed.max_retries,
        platform: payload.platform,
        content_type: payload.content_type,
      });

      const platformAdapter = require('./adapters/platformAdapter');
      let result;
      try {
        result = await Promise.race([
          platformAdapter.publish({
            platform: payload.platform,
            asset: payload.asset,
            caption: payload.caption,
            hashtags: payload.hashtags,
            accountId: payload.account_id,
            igUserId: payload.ig_user_id,
          }),
          publishAdapterTimeoutPromise(PUBLISH_ADAPTER_TIMEOUT_MS),
        ]);
      } catch (pubErr) {
        const em = pubErr && pubErr.message ? pubErr.message : String(pubErr);
        publishPipelineLog('worker_adapter_exception', {
          intent_id: intentId,
          target_id: targetId,
          error: em,
        });
        const allowRetry = em !== 'PUBLISH_EXECUTION_TIMEOUT';
        await this.handlePublishFailure(pool, redis, rawPayload, payload, em, processingKey, allowRetry);
        return;
      }

      if (!result || !result.success) {
        const errMsg = (result && result.error) || 'publish_adapter_failed';
        const failureContext = [];
        if (result?.stage) failureContext.push(`stage=${result.stage}`);
        if (result?.container_id) failureContext.push(`container_id=${result.container_id}`);
        if (result?.safe_to_retry === false) failureContext.push('safe_to_retry=false');
        const fullErrMsg = failureContext.length ? `${errMsg} (${failureContext.join(', ')})` : errMsg;
        publishPipelineLog('worker_adapter_returned_failure', {
          intent_id: intentId,
          target_id: targetId,
          adapter_result: result || null,
          full_error: fullErrMsg,
        });
        payload.publish_stage = result?.stage || null;
        payload.provider_container_id = result?.container_id || null;
        const allowRetry = Boolean(result?.safe_to_retry !== false);
        await this.handlePublishFailure(pool, redis, rawPayload, payload, fullErrMsg, processingKey, allowRetry);
        return;
      }

      const upPub = await pool.query(
        `UPDATE publication_targets
         SET status = 'published',
             external_post_id = $2,
             external_post_url = $3,
             provider_container_id = COALESCE($4, provider_container_id),
             publish_stage = COALESCE($5, publish_stage),
             published_at = NOW(),
             updated_at = NOW()
         WHERE id = $1::uuid AND status = 'publishing'`,
        [targetId, result.external_post_id, result.external_post_url, result.container_id || null, result.stage || null]
      );

      if (upPub.rowCount === 0) {
        await safeLrem();
        return;
      }

      publishPipelineLog('worker_publish_db_updated', {
        intent_id: intentId,
        target_id: targetId,
        external_post_id: result.external_post_id,
        external_post_url: result.external_post_url,
        container_id: result.container_id || null,
      });

      await this.syncPublicationRowForIntentTarget(pool, targetId);
      await this.lremPublishProcessing(redis, processingKey, rawPayload);

      this.publishLog('info', {
        event: 'publish_command_success',
        intent_id: intentId,
        target_id: targetId,
        status: 'published',
        retry_count: claimed.retry_count,
        external_post_id: result.external_post_id,
      });

      await this.tryAggregateIntent(pool, intentId, { target_id: targetId, status: 'published' });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      this.publishLog('error', {
        event: 'publish_command_exception',
        intent_id: intentId,
        target_id: targetId,
        status: 'error',
        error: msg,
      });

      if (payload && isUuid(targetId) && isUuid(intentId)) {
        try {
          const st = await pool.query(
            `SELECT status FROM publication_targets WHERE id = $1::uuid`,
            [targetId]
          );
          if (st.rows.length && st.rows[0].status === 'publishing') {
            await this.handlePublishFailure(pool, redis, rawPayload, payload, msg, processingKey);
            return;
          }
        } catch (innerErr) {
          this.publishLog('error', {
            event: 'publish_command_exception_recovery_failed',
            message: innerErr.message,
            status: 'error',
          });
        }
      }

      try {
        await redis.lpush(PUBLISH_QUEUE_COMMANDS, rawPayload);
        await this.lremPublishProcessing(redis, processingKey, rawPayload);
      } catch (reErr) {
        this.publishLog('error', {
          event: 'publish_command_requeue_after_exception_failed',
          message: reErr.message,
          status: 'error',
        });
      }
    }
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
