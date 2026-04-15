const { getPool } = require('../core/database');
const InstagramBot = require('./InstagramBot');
const { pushDelayed } = require('../core/redis');
const SafetyGuard = require('../middleware/safetyGuard');
const Humanizer = require('../utils/humanizer');

// Retry configuration
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 30 * 1000; // 30 seconds
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000; // 15 minutes

// Error classification
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

class PublishingWorker {
  /**
   * Classify an error as 'permanent', 'retryable', or 'unknown'.
   * @param {Error} error
   * @returns {string} 'permanent' | 'retryable' | 'unknown'
   */
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

  /**
   * Calculate exponential backoff delay: 2^attempt * BASE, capped at MAX.
   * @param {number} attempt - Current retry attempt (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  getRetryDelay(attempt) {
    const delay = Math.pow(2, attempt) * BASE_RETRY_DELAY_MS;
    // Add jitter: ±20%
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
  }

  async processPacket(packet) {
    const { id, target_accounts, type } = packet;
    console.log(`[PublishingWorker] Processing packet ${id} for accounts ${target_accounts}`);

    for (let i = 0; i < target_accounts.length; i++) {
        const accountId = target_accounts[i];
      try {
        // PHASE 6: Safety Guard pre-check
        const safetyCheck = await SafetyGuard.preActionValidation(accountId, 'post');
        if (!safetyCheck.allowed) {
          console.warn(`[PublishingWorker] 🚫 Safety block for ${accountId}: ${safetyCheck.reason}`);

          // Log the safety block as a publication attempt
          await this.logPublicationAttempt(accountId, id, type, null, 'failed', 'safety_block', safetyCheck.reason);

          if (safetyCheck.blockType === 'daily_limit') {
            await this.requeueWithDelay(packet, accountId, 'safety_daily_limit');
          } else if (safetyCheck.waitTime) {
            await this.requeueWithDelay(packet, accountId, `safety_cooldown_${safetyCheck.waitTime}s`, safetyCheck.waitTime * 1000);
          }
          continue;
        }

        // 1. Check daily rate limits (legacy check - now handled by SafetyGuard)
        const canPublish = await this.checkRateLimit(accountId);
        if (!canPublish) {
          console.warn(`[PublishingWorker] ⏳ Daily rate limit exceeded for account ${accountId}. Re-queuing with 2h delay.`);
          await this.logPublicationAttempt(accountId, id, type, null, 'failed', 'rate_limit', 'Daily rate limit exceeded');
          await this.requeueWithDelay(packet, accountId, 'daily_limit_exceeded');
          continue;
        }

        // 2. Check minimum interval (90 min between posts)
        const intervalCheck = await this.checkMinInterval(accountId);
        if (!intervalCheck.allowed) {
          console.warn(`[PublishingWorker] ⏳ Min interval not met for account ${accountId}. Must wait ${intervalCheck.waitMinutes} more minutes. Re-queuing.`);
          await this.requeueWithDelay(packet, accountId, `min_interval_wait_${intervalCheck.waitMinutes}m`);
          continue;
        }

        // PHASE 6: Add human-like delay before publishing
        const humanDelay = Humanizer.getRandomDelay('post');
        console.log(`[PublishingWorker] 🤖 Adding human-like delay: ${humanDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, humanDelay));

        // 3. Publish via Playwright bot — route by visual_type
        console.log(`[PublishingWorker] Starting bot for ${accountId}...`);
        let postUrl;

        if (packet.visual_type === 'video' || type === 'reel') {
          // Video/Reel content → dedicated reel publishing flow
          postUrl = await this.publishReel(packet, accountId);
        } else {
          // Image content → standard post flow
          postUrl = await InstagramBot.publishContent(accountId, packet);
        }

        // 4. Log success in DB and update last_activity_at
        await this.logPublication(accountId, id, type, postUrl);
        await this.updateLastActivity(accountId);

        // PHASE 6: Post-action processing with SafetyGuard
        await SafetyGuard.postActionProcessing(accountId, 'post', null, true);

        console.log(`[PublishingWorker] ✅ Successfully published for account ${accountId}`);
      } catch (botError) {
        // PHASE 6: Record failed action
        await SafetyGuard.postActionProcessing(accountId, 'post', null, false);

        const errMsg = botError.message || '';
        const failureType = this.classifyError(botError);

        console.error(`[PublishingWorker] ❌ Error for account ${accountId} [${failureType}]:`, errMsg);

        // Get current retry count for this packet + account
        const retryCount = await this.getRetryCount(accountId, id);

        if (failureType === 'permanent') {
          // Permanent failure: do not retry
          console.error(`[PublishingWorker] 🛑 Permanent failure for ${accountId}: ${errMsg}`);
          await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', failureType, errMsg);

          // Handle ban/block scenario
          if (errMsg.includes('Action Blocked') || errMsg.includes('Suspended')) {
            const BanMonitor = require('../health/BanMonitor');
            await BanMonitor.recordAlert(accountId, 'ban', errMsg);

            // Try fallback account
            const backupId = await BanMonitor.getBackupAccount(accountId);
            if (backupId && !target_accounts.includes(backupId)) {
              console.log(`[PublishingWorker] 🔄 Rerouting packet ${id} to backup account ${backupId}`);
              target_accounts.push(backupId);
            } else {
              console.error(`[PublishingWorker] ❌ No backup accounts available for packet ${id}`);
            }
          }
        } else if (retryCount >= MAX_RETRIES) {
          // Max retries exhausted
          console.error(`[PublishingWorker] 🛑 Max retries (${MAX_RETRIES}) exhausted for account ${accountId}, packet ${id}`);
          await this.logPublicationAttempt(accountId, id, type, null, 'permanently_failed', 'max_retries_exhausted', errMsg);
        } else {
          // Retryable: re-queue with exponential backoff
          const delay = this.getRetryDelay(retryCount);
          console.log(`[PublishingWorker] 🔁 Retrying (${retryCount + 1}/${MAX_RETRIES}) in ${Math.round(delay / 1000)}s for account ${accountId}`);
          await this.logPublicationAttempt(accountId, id, type, null, 'retrying', failureType, errMsg, retryCount + 1);
          await this.requeueWithDelay(packet, accountId, `retry_${retryCount + 1}`, delay);
        }
      }
    }
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

  /**
   * Get the current retry count for a specific account + packet combo.
   * @param {string} accountId
   * @param {string} packetId
   * @returns {number}
   */
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
      console.warn(`[PublishingWorker] Error getting retry count:`, err.message);
      return 0;
    }
  }

  /**
   * Re-queues a packet with a delay via the delayed sorted set.
   * @param {object} packet - Content packet
   * @param {string} accountId - Account UUID
   * @param {string} reason - Reason for requeue
   * @param {number} customDelayMs - Custom delay in milliseconds (default: 2 hours)
   */
  async requeueWithDelay(packet, accountId, reason, customDelayMs = null) {
    const delayMs = customDelayMs || (2 * 60 * 60 * 1000); // Default 2 hours
    console.log(`[PublishingWorker] 📋 Re-queue: account=${accountId} reason=${reason} delay=${Math.floor(delayMs/1000)}s`);
    await pushDelayed(JSON.stringify(packet), delayMs);
  }

  /**
   * Log a successful publication.
   */
  async logPublication(accountId, packetId, type, postUrl) {
    const pool = getPool();
    const query = `
      INSERT INTO publications (id, account_id, content_packet_id, platform, type, url, published_at, status, retry_count)
      VALUES (gen_random_uuid(), $1, $2, 'instagram', $3, $4, NOW(), 'published', 0)
    `;
    await pool.query(query, [accountId, packetId, type, postUrl]);
  }

  /**
   * Log a publication attempt (success, failure, retry).
   * @param {string} accountId
   * @param {string} packetId
   * @param {string} type - Content type
   * @param {string|null} postUrl
   * @param {string} status - 'published', 'failed', 'retrying', 'permanently_failed'
   * @param {string|null} failureType - 'permanent', 'retryable', 'unknown', etc.
   * @param {string|null} errorMessage
   * @param {number} retryCount
   */
  async logPublicationAttempt(accountId, packetId, type, postUrl, status, failureType, errorMessage, retryCount = 0) {
    const pool = getPool();
    try {
      // Try to update an existing record first
      const existing = await pool.query(
        `SELECT id FROM publications WHERE account_id = $1 AND content_packet_id = $2 LIMIT 1`,
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
          `INSERT INTO publications (id, account_id, content_packet_id, platform, type, url, status, error_message, retry_count, failure_type, last_retry_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, 'instagram', $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())`,
          [accountId, packetId, type, postUrl, status, errorMessage, retryCount, failureType]
        );
      }
    } catch (err) {
      console.error(`[PublishingWorker] Error logging publication attempt:`, err.message);
    }
  }

  /**
   * Stub for reel/video publishing — to be implemented with full Playwright flow.
   * Resolves cleanly so packets are not lost or errored.
   * @param {object} packet - Content packet
   * @param {string} accountId - Account UUID
   * @returns {string|null} Post URL or null
   */
  async publishReel(packet, accountId) {
    console.log(`[PublishingWorker] 🎬 Reel publishing requested for account ${accountId}, packet ${packet.id}`);
    console.log(`[PublishingWorker] ⚠️ Reel publishing not implemented yet — packet logged, no error raised.`);
    // TODO: Implement Playwright-based reel upload flow via InstagramBot
    return null;
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
