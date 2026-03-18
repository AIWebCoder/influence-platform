const { getPool } = require('../core/database');

class ActionLimits {
  // Default limits per action type per day (Instagram's typical limits)
  static DEFAULT_LIMITS = {
    like: 350,
    follow: 200,
    unfollow: 200,
    comment: 60,
    dm: 50,
    post: 3,
    story: 10,
    reel: 3
  };

  // Health-based multipliers (reduce limits when health is low)
  static HEALTH_MULTIPLIERS = {
    90: 1.0,   // Excellent health
    70: 0.8,   // Good health
    50: 0.5,   // Fair health
    30: 0.25,  // Poor health
    0: 0       // Critical - no actions
  };

  /**
   * Check if an action can be performed within daily limits
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type (like, follow, etc.)
   * @returns {object} { allowed: boolean, current: number, limit: number, reason?: string }
   */
  static async checkDailyLimit(accountId, actionType) {
    const pool = getPool();
    
    // Get account health score
    const healthResult = await pool.query(
      'SELECT health_score, status FROM accounts WHERE id = $1',
      [accountId]
    );

    if (healthResult.rows.length === 0) {
      return { allowed: false, current: 0, limit: 0, reason: 'Account not found' };
    }

    const { health_score, status } = healthResult.rows[0];

    // Check account status
    if (status === 'banned' || status === 'shadowbanned' || status === 'resting') {
      return { allowed: false, current: 0, limit: 0, reason: `Account status: ${status}` };
    }

    // Get health-based multiplier
    const multiplier = this.getHealthMultiplier(health_score);
    const baseLimit = this.DEFAULT_LIMITS[actionType] || 50;
    const effectiveLimit = Math.floor(baseLimit * multiplier);

    // Get today's count
    const today = new Date().toISOString().split('T')[0];
    const countResult = await pool.query(
      `SELECT count FROM daily_action_counts 
       WHERE account_id = $1 AND action_type = $2 AND date = $3`,
      [accountId, actionType, today]
    );

    const current = countResult.rows.length > 0 ? countResult.rows[0].count : 0;

    return {
      allowed: current < effectiveLimit,
      current,
      limit: effectiveLimit,
      reason: current >= effectiveLimit ? `Daily limit reached (${current}/${effectiveLimit})` : null
    };
  }

  /**
   * Record an action and update daily count
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type
   * @param {boolean} success - Whether action succeeded
   */
  static async recordAction(accountId, actionType, success = true) {
    const pool = getPool();
    const today = new Date().toISOString().split('T')[0];

    try {
      // Record in account_actions table
      await pool.query(
        `INSERT INTO account_actions (account_id, action_type, success) 
         VALUES ($1, $2, $3)`,
        [accountId, actionType, success]
      );

      // Update or insert daily count
      await pool.query(
        `INSERT INTO daily_action_counts (account_id, action_type, count, date)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (account_id, action_type, date)
         DO UPDATE SET count = daily_action_counts.count + 1`,
        [accountId, actionType, today]
      );

      console.log(`[ActionLimits] Recorded ${actionType} for account ${accountId}`);
    } catch (error) {
      console.error('[ActionLimits] Error recording action:', error.message);
    }
  }

  /**
   * Get health multiplier based on account health score
   * @param {number} healthScore - Account health score (0-100)
   * @returns {number} Multiplier
   */
  static getHealthMultiplier(healthScore) {
    if (healthScore >= 90) return this.HEALTH_MULTIPLIERS[90];
    if (healthScore >= 70) return this.HEALTH_MULTIPLIERS[70];
    if (healthScore >= 50) return this.HEALTH_MULTIPLIERS[50];
    if (healthScore >= 30) return this.HEALTH_MULTIPLIERS[30];
    return this.HEALTH_MULTIPLIERS[0];
  }

  /**
   * Get all action limits for an account
   * @param {string} accountId - Account UUID
   * @returns {object} Object with limits for each action type
   */
  static async getAccountLimits(accountId) {
    const pool = getPool();
    const today = new Date().toISOString().split('T')[0];

    const healthResult = await pool.query(
      'SELECT health_score FROM accounts WHERE id = $1',
      [accountId]
    );

    const healthScore = healthResult.rows[0]?.health_score || 100;
    const multiplier = this.getHealthMultiplier(healthScore);

    const limits = {};
    for (const [action, baseLimit] of Object.entries(this.DEFAULT_LIMITS)) {
      const result = await pool.query(
        `SELECT count FROM daily_action_counts 
         WHERE account_id = $1 AND action_type = $2 AND date = $3`,
        [accountId, action, today]
      );

      const current = result.rows.length > 0 ? result.rows[0].count : 0;
      const effectiveLimit = Math.floor(baseLimit * multiplier);

      limits[action] = {
        current,
        limit: effectiveLimit,
        remaining: Math.max(0, effectiveLimit - current),
        percentage: Math.round((current / effectiveLimit) * 100)
      };
    }

    return {
      healthScore,
      multiplier,
      actions: limits
    };
  }

  /**
   * Reset daily counts (called at midnight)
   */
  static async resetDailyCounts() {
    const pool = getPool();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Keep last 7 days of data for analytics
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    await pool.query(
      `DELETE FROM daily_action_counts WHERE date < $1`,
      [cutoffStr]
    );

    console.log('[ActionLimits] Daily counts cleanup complete');
  }
}

module.exports = ActionLimits;
