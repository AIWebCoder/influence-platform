const ActionLimits = require('../core/actionLimits');
const CooldownManager = require('../core/cooldownManager');

class SafetyGuard {
  /**
   * Pre-action validation - checks all safety rules before allowing action
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type (like, follow, comment, etc.)
   * @param {object} target - Target info { type, id, username }
   * @returns {object} { allowed: boolean, reason?: string, waitTime?: number }
   */
  static async preActionValidation(accountId, actionType, target = null) {
    // Check 0: Account Status
    const pool = getPool();
    const statusRes = await pool.query('SELECT status FROM accounts WHERE id = $1', [accountId]);
    const status = statusRes.rows[0]?.status;

    if (status === 'banned' || status === 'suspended') {
      return { allowed: false, reason: 'Account is banned or suspended', blockType: 'permanent' };
    }

    if (status === 'cooldown' || status === 'resting') {
      return { allowed: false, reason: 'Account is in cooldown/resting mode', blockType: 'cooldown' };
    }

    if (status === 'shadowbanned') {
      // Allow but maybe with extreme caution? For now, block to let it recover
      return { allowed: false, reason: 'Account is shadowbanned', blockType: 'cooldown' };
    }

    // Check 1: Daily action limits
    const limitCheck = await ActionLimits.checkDailyLimit(accountId, actionType);
    if (!limitCheck.allowed) {
      return {
        allowed: false,
        reason: limitCheck.reason,
        blockType: 'daily_limit'
      };
    }

    // Check 2: Cooldowns (if target specified)
    if (target && target.id) {
      const targetType = target.type || 'user';
      const cooldownCheck = await CooldownManager.checkCooldown(
        accountId,
        actionType,
        targetType,
        target.id
      );
      
      if (!cooldownCheck.allowed) {
        return {
          allowed: false,
          reason: cooldownCheck.reason,
          waitTime: cooldownCheck.waitTime,
          blockType: 'cooldown'
        };
      }
    }

    // All checks passed
    return { allowed: true };
  }

  /**
   * Post-action processing - record action and set cooldowns
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type
   * @param {object} target - Target info
   * @param {boolean} success - Whether action succeeded
   */
  static async postActionProcessing(accountId, actionType, target = null, success = true) {
    // Record action in database
    await ActionLimits.recordAction(accountId, actionType, success);

    // Set cooldown if target specified and action was successful
    if (success && target && target.id) {
      const targetType = target.type || 'user';
      await CooldownManager.setCooldown(accountId, actionType, targetType, target.id);
    }
  }

  /**
   * Get account safety status
   * @param {string} accountId - Account UUID
   * @returns {object} Safety status with limits and cooldowns
   */
  static async getAccountSafetyStatus(accountId) {
    const limits = await ActionLimits.getAccountLimits(accountId);
    const cooldowns = await CooldownManager.getActiveCooldowns(accountId);

    return {
      limits,
      activeCooldowns: cooldowns,
      canPost: limits.actions.post?.remaining > 0,
      canLike: limits.actions.like?.remaining > 0,
      canFollow: limits.actions.follow?.remaining > 0
    };
  }

  /**
   * Emergency stop - disable account due to detection risk
   * @param {string} accountId - Account UUID
   * @param {string} reason - Reason for emergency stop
   */
  static async emergencyStop(accountId, reason) {
    const { getPool } = require('../core/database');
    const pool = getPool();

    await pool.query(
      `UPDATE accounts SET status = 'resting', metadata = jsonb_set(metadata, '{emergency_stop}', to_jsonb($1)) 
       WHERE id = $2`,
      [{ reason, timestamp: new Date().toISOString() }, accountId]
    );

    console.log(`[SafetyGuard] Emergency stop triggered for account ${accountId}: ${reason}`);
  }

  /**
   * Trigger the 24h cooldown for an account
   * @param {string} accountId 
   */
  static async triggerCooldown(accountId) {
    const { getPool } = require('../core/database');
    const pool = getPool();

    await pool.query(
      `UPDATE accounts SET status = 'cooldown', updated_at = NOW() WHERE id = $1`,
      [accountId]
    );

    // Record an alert
    await pool.query(
      `INSERT INTO alerts (id, account_id, type, message, created_at)
       VALUES (gen_random_uuid(), $1, 'warning', 'Automated 24h cooldown triggered due to suspicious activity pattern.', NOW())`,
      [accountId]
    );

    console.log(`[SafetyGuard] Automated cooldown triggered for account ${accountId}`);
  }

  /**
   * Resume account after emergency stop
   * @param {string} accountId - Account UUID
   */
  static async resumeAccount(accountId) {
    const { getPool } = require('../core/database');
    const pool = getPool();

    await pool.query(
      `UPDATE accounts SET status = 'active', metadata = jsonb_set(metadata, '{emergency_stop}', 'null') 
       WHERE id = $1`,
      [accountId]
    );

    console.log(`[SafetyGuard] Account ${accountId} resumed from emergency stop`);
  }
}

module.exports = SafetyGuard;
