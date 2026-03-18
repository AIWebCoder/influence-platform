/**
 * Smart Scheduling Service
 * ML-based optimal posting schedule based on historical engagement
 */

const { getPool } = require('../core/database');

class SmartScheduler {
  /**
   * Get optimal posting times based on historical data
   */
  static async getOptimalTimes(niche = null, contentType = 'post', accountId = null) {
    const pool = getPool();
    
    let query = `
      SELECT 
        EXTRACT(HOUR FROM published_at) as hour,
        COUNT(*) as post_count,
        AVG(engagement_score) as avg_engagement
      FROM publications
      WHERE published_at IS NOT NULL
    `;
    
    const params = [];
    if (niche) {
      query += ` AND niche = $${params.length + 1}`;
      params.push(niche);
    }
    if (accountId) {
      query += ` AND account_id = $${params.length + 1}`;
      params.push(accountId);
    }
    
    query += ` GROUP BY EXTRACT(HOUR FROM published_at) ORDER BY avg_engagement DESC`;
    
    const result = await pool.query(query, params);
    const rows = result.rows;
    
    if (rows.length === 0) {
      return {
        optimalHours: [8, 12, 17, 20],
        timezone: 'UTC',
        confidence: 0.3,
        reason: 'No historical data - using default times'
      };
    }
    
    // Calculate hour scores
    const hourScores = {};
    for (const row of rows) {
      const hour = parseInt(row.hour);
      const engagement = parseFloat(row.avg_engagement) || 0;
      const count = parseInt(row.post_count);
      
      // Weight by engagement, sample size
      const score = engagement * Math.min(count / 10, 1.0);
      hourScores[hour] = score;
    }
    
    // Get top 4 hours
    const sortedHours = Object.entries(hourScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([hour]) => parseInt(hour))
      .sort((a, b) => a - b);
    
    // Calculate confidence
    const totalPosts = rows.reduce((sum, r) => sum + parseInt(r.post_count), 0);
    const confidence = Math.min(totalPosts / 50, 1.0);
    
    return {
      optimalHours: sortedHours,
      timezone: 'UTC',
      confidence: Math.round(confidence * 100) / 100,
      hourScores,
      totalSamples: totalPosts,
      reason: `Based on ${totalPosts} posts`
    };
  }
  
  /**
   * Get best time to post now
   */
  static async getBestTimeForNow(niche = null) {
    const now = new Date();
    const currentHour = now.getHours();
    
    const optimal = await SmartScheduler.getOptimalTimes(niche);
    const optimalHours = optimal.optimalHours;
    
    // Find next optimal slot
    let nextSlot = optimalHours.find(h => h > currentHour);
    if (!nextSlot) nextSlot = optimalHours[0];
    
    // Calculate wait time
    const waitHours = nextSlot > currentHour 
      ? nextSlot - currentHour 
      : (24 - currentHour) + nextSlot;
    
    return {
      currentHour,
      nextOptimalHour: nextSlot,
      waitHours,
      optimalHours,
      confidence: optimal.confidence
    };
  }
}

class EngagementPredictor {
  /**
   * Predict engagement before publishing
   */
  static async predictEngagement(caption, hashtags, contentType, niche, accountHistory = null) {
    const factors = {};
    const recommendations = [];
    
    // Factor 1: Caption length
    const captionLength = caption.length;
    if (captionLength >= 100 && captionLength <= 300) {
      factors.captionLength = 100;
    } else if (captionLength < 100) {
      factors.captionLength = captionLength * 0.8;
      recommendations.push('Caption is too short');
    } else {
      factors.captionLength = Math.max(0, 100 - (captionLength - 300) * 0.1);
    }
    
    // Factor 2: Hashtag count
    const hashtagCount = hashtags.length;
    if (hashtagCount >= 5 && hashtagCount <= 15) {
      factors.hashtagCount = 100;
    } else if (hashtagCount < 5) {
      factors.hashtagCount = hashtagCount * 20;
      recommendations.push(`Add ${5 - hashtagCount} more hashtags`);
    } else {
      factors.hashtagCount = Math.max(0, 100 - (hashtagCount - 15) * 10);
      recommendations.push(`Reduce ${hashtagCount - 15} hashtags`);
    }
    
    // Factor 3: Content type
    const typeScores = { post: 30, story: 21, reel: 36, carousel: 33 };
    factors.contentType = typeScores[contentType] || 30;
    
    // Factor 4: Account history
    factors.accountHistory = accountHistory || 50;
    
    // Calculate weighted prediction
    const weights = {
      captionLength: 0.35,
      hashtagCount: 0.20,
      contentType: 0.20,
      accountHistory: 0.25
    };
    
    const predictedScore = 
      factors.captionLength * weights.captionLength +
      factors.hashtagCount * weights.hashtagCount +
      factors.contentType * weights.contentType +
      factors.accountHistory * weights.accountHistory;
    
    const confidence = accountHistory ? 0.75 : 0.5;
    
    return {
      predictedScore: Math.round(predictedScore * 10) / 10,
      confidence,
      factors,
      recommendations,
      grade: EngagementPredictor.getGrade(predictedScore)
    };
  }
  
  static getGrade(score) {
    if (score >= 80) return 'A';
    if (score >= 65) return 'B';
    if (score >= 50) return 'C';
    if (score >= 35) return 'D';
    return 'F';
  }
}

class FrequencyOptimizer {
  /**
   * Analyze and recommend posting frequency
   */
  static async analyzeAndAdjust(accountId) {
    const pool = getPool();
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) as post_count,
        COALESCE(AVG(engagement_score), 0) as avg_engagement
      FROM publications
      WHERE account_id = $1
      AND published_at > NOW() - INTERVAL '7 days'
    `, [accountId]);
    
    const row = result.rows[0];
    const postCount = parseInt(row.post_count) || 0;
    const avgEngagement = parseFloat(row.avg_engagement) || 0;
    
    if (postCount === 0) {
      return {
        currentFrequency: 'unknown',
        recommendedFrequency: 'minimal',
        maxPostsPerDay: 1,
        reason: 'No recent posts - starting with minimal frequency'
      };
    }
    
    // Determine frequency
    let recommended, maxPosts;
    if (avgEngagement > 100) {
      if (postCount >= 20) { recommended = 'high'; maxPosts = 8; }
      else if (postCount >= 10) { recommended = 'daily'; maxPosts = 5; }
      else { recommended = 'moderate'; maxPosts = 3; }
    } else if (avgEngagement > 50) {
      if (postCount >= 10) { recommended = 'moderate'; maxPosts = 3; }
      else { recommended = 'low'; maxPosts = 2; }
    } else {
      recommended = 'minimal';
      maxPosts = 1;
    }
    
    return {
      currentFrequency: postCount >= 7 ? 'daily' : 'moderate',
      recommendedFrequency: recommended,
      maxPostsPerDay: maxPosts,
      avgEngagement: Math.round(avgEngagement * 10) / 10,
      postsLast7Days: postCount,
      reason: `Average engagement: ${avgEngagement.toFixed(0)} over ${postCount} posts`
    };
  }
}

module.exports = {
  SmartScheduler,
  EngagementPredictor,
  FrequencyOptimizer
};
