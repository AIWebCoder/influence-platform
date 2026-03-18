const { getPool } = require('../core/database');
const OptimizationService = require('../analytics/OptimizationService');

class CampaignManager {
  constructor() {
    this.intervalId = null;
  }

  /**
   * Starts the background campaign orchestrator.
   * Runs every 6 hours.
   */
  start() {
    console.log('[CampaignManager] Starting background orchestrator...');
    // Initial run
    this.runCycle();
    
    // Interval run every 6 hours
    this.intervalId = setInterval(() => {
      this.runCycle();
    }, 6 * 60 * 60 * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runCycle() {
    console.log('[CampaignManager] Running automation cycle at', new Date().toISOString());
    try {
      const activeCampaigns = await this.getActiveCampaigns();
      for (const campaign of activeCampaigns) {
        await this.processCampaign(campaign);
      }
    } catch (err) {
      console.error('[CampaignManager] Cycle failed:', err);
    }
  }

  async getActiveCampaigns() {
    const pool = getPool();
    const res = await pool.query("SELECT * FROM campaigns WHERE status = 'active'");
    return res.rows;
  }

  /**
   * Processes a single campaign's rules and log history.
   */
  async processCampaign(campaign) {
    const pool = getPool();
    console.log(`[CampaignManager] Processing campaign: ${campaign.name} (${campaign.id})`);

    try {
      // 1. Gather current metrics for the target (account or niche)
      const targetQuery = campaign.target_account_id 
        ? { accountId: campaign.target_account_id }
        : { niche: campaign.target_niche };
      
      const metrics = await this.getCurrentCampaignMetrics(campaign, targetQuery);
      
      // 2. Log history snapshot
      await pool.query(`
        INSERT INTO campaign_history (campaign_id, content_count, total_engagement_rate, total_followers_gained)
        VALUES ($1, $2, $3, $4)
      `, [campaign.id, metrics.postCount, metrics.avgER, metrics.followersGained]);

      // 3. Rules Engine Execution
      if (campaign.type === 'growth') {
        await this.runGrowthRules(campaign, metrics, targetQuery);
      }
    } catch (err) {
      console.error(`[CampaignManager] Error processing campaign ${campaign.id}:`, err);
    }
  }

  async getCurrentCampaignMetrics(campaign, target) {
    const pool = getPool();
    const { accountId, niche } = target;
    
    // Simplification: Metrics since last snapshot or last 24h
    let query = `
      SELECT 
        COUNT(*) as post_count,
        AVG(m.engagement_rate) as avg_er
      FROM publications p
      JOIN post_metrics m ON p.id = m.publication_id
      JOIN content_packets cp ON p.content_packet_id = cp.id
      WHERE p.status = 'published' AND p.published_at > $1
    `;
    const params = [campaign.created_at];

    if (accountId) {
      query += ` AND p.account_id = $2`;
      params.push(accountId);
    } else {
      query += ` AND cp.niche = $2`;
      params.push(niche);
    }

    const metricsRes = await pool.query(query, params);
    
    // Follower growth
    let growthQuery = `
      SELECT SUM(followers_count - (
        SELECT followers_count FROM account_growth g2 
        WHERE g2.account_id = g.account_id AND g2.captured_at < g.captured_at 
        ORDER BY g2.captured_at DESC LIMIT 1
      )) as gained
      FROM account_growth g
      WHERE g.captured_at > $1
    `;
    const growthParams = [campaign.created_at];
    if (accountId) {
      growthQuery += ` AND g.account_id = $2`;
      growthParams.push(accountId);
    }

    const growthRes = await pool.query(growthQuery, growthParams);

    return {
      postCount: parseInt(metricsRes.rows[0].post_count || 0),
      avgER: parseFloat(metricsRes.rows[0].avg_er || 0),
      followersGained: parseInt(growthRes.rows[0].gained || 0)
    };
  }

  async runGrowthRules(campaign, metrics, target) {
    const pool = getPool();
    const threshold = campaign.settings.er_threshold || 1.5;
    
    console.log(`[CampaignManager] Evaluating growth rules for ${campaign.name}: ER=${metrics.avgER} (target=${threshold})`);

    // Rule: If ER is high, we can handle more frequency
    if (metrics.avgER > threshold * 1.5) {
      console.log(`[CampaignManager] Rule Trigger: High Engagement. Checking for frequency increase...`);
      const accounts = await this.getTargetAccounts(target);
      for (const acc of accounts) {
        const opt = await OptimizationService.getFrequencyOptimization(acc.id);
        if (opt && opt.action === 'increase') {
          await pool.query('UPDATE accounts SET posts_per_day = $1 WHERE id = $2', [opt.suggested_frequency, acc.id]);
          console.log(`[CampaignManager] Action: Increased frequency for ${acc.id} to ${opt.suggested_frequency}`);
        }
      }
    }
  }

  async getTargetAccounts(target) {
    const pool = getPool();
    if (target.accountId) {
      const res = await pool.query('SELECT id FROM accounts WHERE id = $1', [target.accountId]);
      return res.rows;
    } else {
      const res = await pool.query('SELECT DISTINCT a.id FROM accounts a JOIN content_packets cp ON a.id = cp.account_id WHERE cp.niche = $1', [target.niche]);
      return res.rows;
    }
  }
}

module.exports = new CampaignManager();
