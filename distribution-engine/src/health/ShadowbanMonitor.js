const { getPool } = require('../core/database');
const AccountService = require('../managers/AccountService');

class ShadowbanMonitor {
  /**
   * Analyzes recent publications to detect anomalous drops in engagement.
   * Compares the average engagement of the latest 5 posts with the historical average.
   * If detected, flags the account status as 'shadowbanned'.
   * @param {string} accountId 
   */
  async analyzeEngagement(accountId) {
    const pool = getPool();
    
    try {
      // 1. Fetch recent engagement metrics for the account
      const recentPosts = await pool.query(`
        SELECT engagement_rate 
        FROM post_metrics 
        WHERE account_id = $1 
        ORDER BY recorded_at DESC 
        LIMIT 5
      `, [accountId]);

      if (recentPosts.rows.length < 3) {
        // Not enough data yet to reliably detect shadowban
        return false;
      }

      const recentAvg = recentPosts.rows.reduce((sum, row) => sum + (row.engagement_rate || 0), 0) / recentPosts.rows.length;

      // 2. Fetch historical average (last 30 days excluding the latest 5)
      const historicalPosts = await pool.query(`
        SELECT AVG(engagement_rate) as hist_avg
        FROM post_metrics
        WHERE account_id = $1 
        AND recorded_at < (
          SELECT MIN(recorded_at) FROM (
            SELECT recorded_at FROM post_metrics 
            WHERE account_id = $1 
            ORDER BY recorded_at DESC 
            LIMIT 5
          ) as recent_bound
        )
      `, [accountId]);

      const histAvg = parseFloat(historicalPosts.rows[0].hist_avg) || 0;

      if (histAvg === 0) return false;

      // 3. Compare: if drop > 70%
      const dropSize = (histAvg - recentAvg) / histAvg;
      
      if (dropSize > 0.7) {
        console.warn(`[ShadowbanMonitor] 🚨 Shadowban detected for account ${accountId}. Drop: ${(dropSize * 100).toFixed(1)}%`);
        
        // Log alert
        await pool.query(`
          INSERT INTO alerts (id, account_id, type, message, created_at)
          VALUES (gen_random_uuid(), $1, 'shadowban', $2, NOW())
        `, [accountId, `Engagement dropped by ${(dropSize * 100).toFixed(1)}% compared to historical average.`]);

        await AccountService.updateAccountHealth(accountId, -40, 'shadowbanned');
        return true;
      }
    } catch (err) {
      console.error(`[ShadowbanMonitor] Error analyzing engagement for ${accountId}:`, err.message);
    }
    
    return false;
  }
}

module.exports = new ShadowbanMonitor();
