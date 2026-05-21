const { getPool } = require('../core/database');

class CooldownManager {
  // Default cooldowns in milliseconds
  static DEFAULT_COOLDOWNS = {
    // User-based actions
    follow: 2 * 60 * 60 * 1000,      // 2 hours between following same user
    unfollow: 1 * 60 * 60 * 1000,    // 1 hour between unfollows
    like: 5 * 60 * 1000,              // 5 min between likes on same user
    comment: 30 * 60 * 1000,           // 30 min between comments on same user
    comment_like: 10 * 60 * 1000,      // 10 min between likes on same comment
    dm: 60 * 60 * 1000,               // 1 hour between DMs
    
    // Content-based actions
    like_post: 10 * 60 * 1000,       // 10 min between likes on same post
    comment_post: 60 * 60 * 1000,     // 1 hour between comments on same post
    
    // Hashtag-based actions
    follow_hashtag: 60 * 60 * 1000,   // 1 hour between following same hashtag
    
    // Location-based actions
    follow_location: 60 * 60 * 1000  // 1 hour between following same location
  };

  // Health-based cooldown multipliers (increase cooldowns when health is low)
  static HEALTH_COOLDOWN_MULTIPLIERS = {
    90: 1.0,   // Excellent health
    70: 1.5,   // Good health
    50: 2.0,   // Fair health
    30: 3.0,   // Poor health
    0: 5.0     // Critical - very long cooldowns
  };

  /**
   * Check if action is on cooldown
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type
   * @param {string} targetType - Target type (user, post, hashtag, location)
   * @param {string} targetId - Target ID
   * @returns {object} { allowed: boolean, waitTime?: number, reason?: string }
   */
  static async checkCooldown(accountId, actionType, targetType, targetId) {
    const pool = getPool();

    // Get account health score
    const healthResult = await pool.query(
      'SELECT health_score FROM accounts WHERE id = $1',
      [accountId]
    );

    const healthScore = healthResult.rows[0]?.health_score || 100;
    const multiplier = this.getHealthCooldownMultiplier(healthScore);
    
    const baseCooldown = this.DEFAULT_COOLDOWNS[actionType] || 0;
    const effectiveCooldown = baseCooldown * multiplier;

    // Check existing cooldown
    const result = await pool.query(
      `SELECT cooldown_until FROM action_cooldowns 
       WHERE account_id = $1 AND action_type = $2 AND target_type = $3 AND target_id = $4
       AND cooldown_until > NOW()`,
      [accountId, actionType, targetType, targetId]
    );

    if (result.rows.length > 0) {
      const cooldownUntil = new Date(result.rows[0].cooldown_until);
      const waitTime = cooldownUntil - new Date();
      return {
        allowed: false,
        waitTime: Math.ceil(waitTime / 1000), // seconds
        reason: `Cooldown active. Wait ${Math.ceil(waitTime / 60000)} minutes.`
      };
    }

    return {
      allowed: true,
      cooldownMs: effectiveCooldown
    };
  }

  /**
   * Set a cooldown after an action
   * @param {string} accountId - Account UUID
   * @param {string} actionType - Action type
   * @param {string} targetType - Target type
   * @param {string} targetId - Target ID
   * @param {number} customCooldownMs - Optional custom cooldown (default uses config)
   */
  static async setCooldown(accountId, actionType, targetType, targetId, customCooldownMs = null) {
    const pool = getPool();

    // Get health-based multiplier
    const healthResult = await pool.query(
      'SELECT health_score FROM accounts WHERE id = $1',
      [accountId]
    );

    const healthScore = healthResult.rows[0]?.health_score || 100;
    const multiplier = this.getHealthCooldownMultiplier(healthScore);
    
    const baseCooldown = this.DEFAULT_COOLDOWNS[actionType] || 0;
    const cooldownMs = customCooldownMs || (baseCooldown * multiplier);
    
    const cooldownUntil = new Date(Date.now() + cooldownMs);

    try {
      // Delete old cooldowns for this action/target
      await pool.query(
        `DELETE FROM action_cooldowns 
         WHERE account_id = $1 AND action_type = $2 AND target_type = $3 AND target_id = $4`,
        [accountId, actionType, targetType, targetId]
      );

      // Insert new cooldown
      await pool.query(
        `INSERT INTO action_cooldowns (account_id, action_type, target_type, target_id, cooldown_until)
         VALUES ($1, $2, $3, $4, $5)`,
        [accountId, actionType, targetType, targetId, cooldownUntil]
      );

      console.log(`[CooldownManager] Set ${actionType} cooldown for ${targetType}:${targetId} until ${cooldownUntil.toISOString()}`);
    } catch (error) {
      console.error('[CooldownManager] Error setting cooldown:', error.message);
    }
  }

  /**
   * Get health-based cooldown multiplier
   * @param {number} healthScore - Account health score (0-100)
   * @returns {number} Multiplier
   */
  static getHealthCooldownMultiplier(healthScore) {
    if (healthScore >= 90) return this.HEALTH_COOLDOWN_MULTIPLIERS[90];
    if (healthScore >= 70) return this.HEALTH_COOLDOWN_MULTIPLIERS[70];
    if (healthScore >= 50) return this.HEALTH_COOLDOWN_MULTIPLIERS[50];
    if (healthScore >= 30) return this.HEALTH_COOLDOWN_MULTIPLIERS[30];
    return this.HEALTH_COOLDOWN_MULTIPLIERS[0];
  }

  /**
   * Clean up expired cooldowns
   */
  static async cleanupExpiredCooldowns() {
    const pool = getPool();
    
    const result = await pool.query(
      `DELETE FROM action_cooldowns WHERE cooldown_until < NOW()`
    );

    if (result.rowCount > 0) {
      console.log(`[CooldownManager] Cleaned up ${result.rowCount} expired cooldowns`);
    }
  }

  /**
   * Get all active cooldowns for an account
   * @param {string} accountId - Account UUID
   * @returns {Array} Array of active cooldowns
   */
  static async getActiveCooldowns(accountId) {
    const pool = getPool();
    
    const result = await pool.query(
      `SELECT action_type, target_type, target_id, cooldown_until 
       FROM action_cooldowns 
       WHERE account_id = $1 AND cooldown_until > NOW()
       ORDER BY cooldown_until`,
      [accountId]
    );

    return result.rows.map(row => ({
      action: row.action_type,
      targetType: row.target_type,
      targetId: row.target_id,
      until: row.cooldown_until
    }));
  }
}

module.exports = CooldownManager;
