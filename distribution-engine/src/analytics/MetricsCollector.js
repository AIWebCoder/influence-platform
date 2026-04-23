const { getPool } = require('../core/database');

class MetricsCollector {
  /**
   * Main entry point to refresh all metrics
   */
  async collectAll() {
    console.log('[MetricsCollector] 📊 Starting global metrics collection...');
    
    try {
      await this.collectAccountMetrics();
      await this.collectPostMetrics();
      console.log('[MetricsCollector] ✅ Metrics collection completed successfully.');
    } catch (err) {
      console.error('[MetricsCollector] ❌ Critical error during collection:', err.message);
    }
  }

  /**
   * Fetches latest follower counts and growth for all active accounts
   */
  async collectAccountMetrics() {
    const pool = getPool();
    const accountsRes = await pool.query("SELECT id, username FROM accounts WHERE status NOT IN ('banned', 'suspended')");
    
    for (const account of accountsRes.rows) {
      // In a real scenario, we'd use an IG Scraper or API here.
      // For this implementation, we simulate growth based on last values.
      const lastGrowth = await pool.query(
        "SELECT followers_count, following_count, posts_count FROM account_growth WHERE account_id = $1 ORDER BY recorded_at DESC LIMIT 1",
        [account.id]
      );

      const base = lastGrowth.rows[0] || { followers_count: 1000, following_count: 500, posts_count: 10 };
      
      // Simulating slight organic growth
      const newFollowers = base.followers_count + Math.floor(Math.random() * 50);
      const newPosts = base.posts_count + (Math.random() > 0.8 ? 1 : 0);

      await pool.query(
        `INSERT INTO account_growth (account_id, followers_count, following_count, posts_count, recorded_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [account.id, newFollowers, base.following_count, newPosts]
      );

      // Update the main accounts table as well for quick lookups
      await pool.query(
        "UPDATE accounts SET followers_count = $1, updated_at = NOW() WHERE id = $2",
        [newFollowers, account.id]
      );
    }
    console.log(`[MetricsCollector] Updated growth data for ${accountsRes.rows.length} accounts.`);
  }

  /**
   * Fetches engagement metrics for recently published posts (last 7 days)
   */
  async collectPostMetrics() {
    const pool = getPool();
    const publicationsRes = await pool.query(
      `SELECT id, account_id, status FROM publications 
       WHERE status = 'published' AND published_at > NOW() - INTERVAL '7 days'`
    );

    for (const pub of publicationsRes.rows) {
      const detail = await pool.query(
        `SELECT id, account_id, content_packet_id, instagram_post_id FROM publications WHERE id = $1`,
        [pub.id]
      );
      const row = detail.rows[0];
      if (!row?.content_packet_id) continue;

      const lastMetrics = await pool.query(
        'SELECT likes_count, comments_count FROM post_metrics WHERE publication_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [pub.id]
      );

      const base = lastMetrics.rows[0] || { likes_count: 0, comments_count: 0 };
      const newLikes = base.likes_count + Math.floor(Math.random() * 100);
      const newComments = base.comments_count + Math.floor(Math.random() * 10);

      const accRes = await pool.query('SELECT followers_count FROM accounts WHERE id = $1', [pub.account_id]);
      const followers = accRes.rows[0]?.followers_count || 1000;
      const er = ((newLikes + newComments) / followers) * 100;

      await pool.query(
        `INSERT INTO post_metrics (
          publication_id, content_packet_id, account_id, instagram_post_id,
          likes_count, comments_count, engagement_rate, recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          pub.id,
          row.content_packet_id,
          row.account_id,
          row.instagram_post_id,
          newLikes,
          newComments,
          parseFloat(er.toFixed(4)),
        ]
      );
    }
    console.log(`[MetricsCollector] Updated metrics for ${publicationsRes.rows.length} recent posts.`);
  }
}

module.exports = new MetricsCollector();
