const { getPool } = require('../core/database');

class WarmupManager {
  /**
   * Calculates the maximum number of posts allowed per day based on account status, age, and health.
   * Warming accounts: max 3/day. Active accounts: max 8/day.
   * @param {string} accountId 
   */
  async calculateDailyLimit(accountId) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT created_at, health_score, status FROM accounts WHERE id = $1',
      [accountId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Account ${accountId} not found`);
    }

    const { created_at, health_score, status } = result.rows[0];

    // If account is shadowbanned or banned, posting limit is forced to 0
    if (status === 'shadowbanned' || status === 'banned' || status === 'resting') {
      return 0;
    }

    // Status-based hard caps
    const STATUS_CAPS = {
      warming: 3,
      active: 8,
      inactive: 0,
    };

    const statusCap = STATUS_CAPS[status] ?? 5;

    const createdDate = new Date(created_at);
    const today = new Date();
    const ageInDays = Math.floor((today - createdDate) / (1000 * 60 * 60 * 24));

    let baseLimit = 1;

    // Warmup progression (Day 1-14)
    if (ageInDays <= 3) baseLimit = 1;
    else if (ageInDays <= 7) baseLimit = 2;
    else if (ageInDays <= 14) baseLimit = 3;
    else baseLimit = 5; // Matured account limit

    // Take the minimum of age-based and status-based limit
    baseLimit = Math.min(baseLimit, statusCap);

    // Health score adjustment: Scale limit proportionally if health is bad
    const healthMultiplier = Math.max(0.1, health_score / 100);
    const finalLimit = Math.floor(baseLimit * healthMultiplier);

    // Ensure at least 1 post if they aren't completely banned
    return finalLimit > 0 ? finalLimit : 1;
  }

  /**
   * Health-based publishing decision (Task 6.4)
   * Determines if account can publish based on health score thresholds
   * @param {string} accountId 
   * @returns {object} { allowed: boolean, reason?: string, action?: string }
   */
  static async checkHealthForPublishing(accountId) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT health_score, status, daily_post_count FROM accounts WHERE id = $1',
      [accountId]
    );

    if (result.rows.length === 0) {
      return { allowed: false, reason: 'Account not found' };
    }

    const { health_score, status, daily_post_count } = result.rows[0];

    // Check status first
    if (status === 'banned') {
      return { 
        allowed: false, 
        reason: 'Account is banned',
        action: 'disable_account'
      };
    }

    if (status === 'shadowbanned') {
      return { 
        allowed: false, 
        reason: 'Account is shadowbanned',
        action: 'reduce_activity'
      };
    }

    if (status === 'resting') {
      return { 
        allowed: false, 
        reason: 'Account is in resting mode',
        action: 'wait_for_recovery'
      };
    }

    // Health score thresholds
    if (health_score < 20) {
      return { 
        allowed: false, 
        reason: `Critical health score: ${health_score}`,
        action: 'emergency_stop'
      };
    }

    if (health_score < 40) {
      return { 
        allowed: true, 
        reduced: true,
        reason: `Low health score: ${health_score} - limiting activity`,
        maxPosts: Math.ceil(daily_post_count * 0.25)
      };
    }

    if (health_score < 60) {
      return { 
        allowed: true, 
        reduced: true,
        reason: `Fair health score: ${health_score} - moderate activity`,
        maxPosts: Math.ceil(daily_post_count * 0.5)
      };
    }

    // Health is good
    return { 
      allowed: true,
      reason: `Health score OK: ${health_score}`
    };
  }

  /**
   * Checks minimum interval between posts (90 minutes).
   * @param {string} accountId
   * @returns {object} { allowed: boolean, waitMinutes: number }
   */
  async checkMinInterval(accountId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT last_activity_at FROM accounts WHERE id = $1`,
      [accountId]
    );

    if (result.rows.length === 0) {
      return { allowed: true, waitMinutes: 0 };
    }

    const { last_activity_at } = result.rows[0];
    if (!last_activity_at) {
      return { allowed: true, waitMinutes: 0 };
    }

    const lastActivity = new Date(last_activity_at);
    const now = new Date();
    const diffMinutes = (now - lastActivity) / (1000 * 60);
    const MIN_INTERVAL = 90; // minutes

    if (diffMinutes < MIN_INTERVAL) {
      return { allowed: false, waitMinutes: Math.ceil(MIN_INTERVAL - diffMinutes) };
    }

    return { allowed: true, waitMinutes: 0 };
  }
}

module.exports = new WarmupManager();
