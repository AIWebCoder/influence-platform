const { randomUUID } = require('crypto');
const { getPool } = require('../core/database');
const SafetyGuard = require('../middleware/safetyGuard');
const Humanizer = require('../utils/humanizer');
const { executeEngagement } = require('./instagramEngagementAdapter');
const { engagementModeLabel } = require('./engagementMode');

const ENGAGEMENT_QUEUE_COMMANDS = 'engagement:commands';
const ENGAGEMENT_QUEUE_FAILED = 'engagement:failed';

function engagementLog(level, payload) {
  console.log(
    JSON.stringify({
      level,
      service: 'distribution-engine',
      component: 'EngagementWorker',
      mode: engagementModeLabel(),
      ...payload,
    })
  );
}

class EngagementWorker {
  startEngagementConsumer() {
    const Redis = require('ioredis');
    this._workerId = randomUUID();
    this._processingKey = `engagement:processing:${this._workerId}`;
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const consumer = new Redis(redisUrl);

    engagementLog('info', {
      event: 'engagement_consumer_start',
      queue: ENGAGEMENT_QUEUE_COMMANDS,
      processing_key: this._processingKey,
    });

    const MAX_CONCURRENT = parseInt(process.env.MAX_ENGAGEMENT_CONCURRENT || '2', 10);
    let currentWorkers = 0;
    const processingKey = this._processingKey;

    const recover = async () => {
      let moved = 0;
      for (;;) {
        const item = await consumer.rpop(processingKey);
        if (item == null) break;
        await consumer.lpush(ENGAGEMENT_QUEUE_COMMANDS, item);
        moved += 1;
      }
      if (moved > 0) {
        engagementLog('info', { event: 'engagement_processing_recovery', count: moved });
      }
    };

    (async () => {
      await recover();
      const poll = async () => {
        if (currentWorkers >= MAX_CONCURRENT) {
          setTimeout(poll, 500);
          return;
        }
        try {
          const rawPayload = await consumer.brpoplpush(
            ENGAGEMENT_QUEUE_COMMANDS,
            processingKey,
            2
          );
          if (rawPayload) {
            currentWorkers++;
            this.processCommand(rawPayload, consumer, processingKey)
              .catch((err) => {
                engagementLog('error', {
                  event: 'engagement_command_outer_error',
                  error: err?.message || String(err),
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
          engagementLog('error', {
            event: 'engagement_consumer_redis_error',
            error: err.message,
          });
          setTimeout(poll, 5000);
        }
      };
      poll();
    })();
  }

  async processCommand(rawPayload, redis, processingKey) {
    const pool = getPool();
    let payload;
    try {
      payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } catch (e) {
      engagementLog('error', { event: 'engagement_invalid_json', error: e.message });
      await redis.lrem(processingKey, 1, rawPayload);
      return;
    }

    const intentId = payload.intent_id;
    const accountId = payload.account_id;
    const limitActionType = payload.limit_action_type || payload.action_type;

    try {
      await pool.query(
        `UPDATE engagement_intents
         SET status = 'processing', updated_at = NOW()
         WHERE id = $1::uuid AND status IN ('queued', 'processing')`,
        [intentId]
      );

      const target = {
        type: payload.target_type === 'user' ? 'user' : 'comment',
        id: payload.target_id,
        username: payload.target_username,
      };

      const validation = await SafetyGuard.preActionValidation(accountId, limitActionType, target);
      if (!validation.allowed) {
        throw new Error(validation.reason || 'Engagement blocked by safety guard');
      }

      await Humanizer.randomDelay(1500, 6000);

      const result = await executeEngagement(payload);

      if (!result.success) {
        const retryable = result.safe_to_retry !== false;
        throw Object.assign(new Error(result.error || 'Engagement failed'), { retryable });
      }

      await SafetyGuard.postActionProcessing(accountId, limitActionType, target, true);

      await pool.query(
        `UPDATE engagement_intents
         SET status = 'completed',
             external_result_id = $2,
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [intentId, result.external_result_id || null]
      );

      engagementLog('info', {
        event: 'engagement_completed',
        intent_id: intentId,
        account_id: accountId,
        action_type: payload.action_type,
        external_result_id: result.external_result_id,
        stage: result.stage,
      });
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 8000);
      const retryable = err.retryable !== false;

      await pool.query(
        `UPDATE engagement_intents
         SET status = 'failed',
             error_message = $2,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [intentId, msg]
      );

      if (!retryable) {
        await redis.lpush(
          ENGAGEMENT_QUEUE_FAILED,
          JSON.stringify({ payload, error: msg, failed_at: new Date().toISOString() })
        );
      } else {
        await redis.lpush(ENGAGEMENT_QUEUE_COMMANDS, rawPayload);
      }

      engagementLog('error', {
        event: 'engagement_failed',
        intent_id: intentId,
        account_id: accountId,
        action_type: payload.action_type,
        error: msg.slice(0, 500),
        requeued: retryable,
      });
    } finally {
      await redis.lrem(processingKey, 1, rawPayload);
    }
  }
}

module.exports = new EngagementWorker();
