const { getPool } = require('../core/database');

class OptimizationService {
  /**
   * Identifies the best posting hours for a given niche or account.
   * Clusters engagement by hour (0-23).
   * @param {Object} options - { niche, accountId }
   */
  async getOptimalPostingTimes(options = {}) {
    const pool = getPool();
    const { niche, accountId } = options;
    
    let query = `
      SELECT 
        EXTRACT(HOUR FROM p.published_at) as hour,
        AVG(m.engagement_rate) as avg_er,
        COUNT(*) as sample_size
      FROM publications p
      JOIN post_metrics m ON p.id = m.publication_id
      JOIN content_packets cp ON p.content_packet_id = cp.id
      WHERE p.status = 'published'
    `;
    const params = [];

    if (accountId) {
      query += ` AND p.account_id = $${params.length + 1}`;
      params.push(accountId);
    } else if (niche) {
      query += ` AND cp.niche = $${params.length + 1}`;
      params.push(niche);
    }

    query += `
      GROUP BY hour
      HAVING COUNT(*) >= 3
      ORDER BY avg_er DESC
      LIMIT 3
    `;

    try {
      const result = await pool.query(query, params);
      return result.rows.map(row => ({
        hour: parseInt(row.hour),
        score: parseFloat(row.avg_er).toFixed(2),
        sample_size: parseInt(row.sample_size)
      }));
    } catch (err) {
      console.error('[Optimization] Error calculating posting times:', err);
      return [];
    }
  }

  /**
   * Suggests an optimal posting frequency (posts_per_day) based on engagement momentum.
   * @param {string} accountId 
   */
  async getFrequencyOptimization(accountId) {
    const pool = getPool();
    
    try {
      // 1. Get recent engagement (last 7 days)
      const recentRes = await pool.query(`
        SELECT AVG(engagement_rate) as avg_er
        FROM post_metrics m
        JOIN publications p ON m.publication_id = p.id
        WHERE p.account_id = $1 AND p.published_at > NOW() - INTERVAL '7 days'
      `, [accountId]);

      // 2. Get baseline engagement (previous 21 days before that)
      const baselineRes = await pool.query(`
        SELECT AVG(engagement_rate) as avg_er
        FROM post_metrics m
        JOIN publications p ON m.publication_id = p.id
        WHERE p.account_id = $1 
          AND p.published_at BETWEEN NOW() - INTERVAL '28 days' AND NOW() - INTERVAL '7 days'
      `, [accountId]);

      const recentER = parseFloat(recentRes.rows[0].avg_er || 0);
      const baselineER = parseFloat(baselineRes.rows[0].avg_er || 0);

      const accountRes = await pool.query('SELECT posts_per_day FROM accounts WHERE id = $1', [accountId]);
      if (accountRes.rows.length === 0) return null;
      
      const currentFreq = accountRes.rows[0].posts_per_day || 1;
      let action = 'maintain';
      let suggestion = currentFreq;
      let reason = "Engagement is stable.";

      if (recentER > baselineER * 1.25) {
        action = 'increase';
        suggestion = Math.min(currentFreq + 1, 5); // Max 5 posts/day for safety
        reason = "Engagement momentum is high. Increasing frequency could accelerate growth.";
      } else if (recentER < baselineER * 0.75 && recentER > 0) {
        action = 'decrease';
        suggestion = Math.max(currentFreq - 1, 1);
        reason = "Engagement is dipping. Reducing frequency to focus on quality and avoid spam flags.";
      }

      return {
        current_frequency: currentFreq,
        suggested_frequency: suggestion,
        action,
        reason,
        metrics: {
          recent_er: recentER.toFixed(2),
          baseline_er: baselineER.toFixed(2),
          delta: (baselineER > 0 ? ((recentER - baselineER) / baselineER) * 100 : 0).toFixed(1) + '%'
        }
      };
    } catch (err) {
      console.error('[Optimization] Error calculating frequency:', err);
      return null;
    }
  }
}

module.exports = new OptimizationService();
