const { getPool } = require('../core/database');

class WinnerDetectionService {
  /**
   * Evaluates an A/B test and determines if a winner can be declared.
   * @param {string} testId - The ID of the A/B test to evaluate
   */
  async evaluateTest(testId) {
    const pool = getPool();
    console.log(`[WinnerDetection] 🔍 Evaluating A/B test: ${testId}`);

    try {
      // 1. Fetch test details and performance
      const testRes = await pool.query('SELECT * FROM ab_tests WHERE id = $1', [testId]);
      if (testRes.rows.length === 0) throw new Error('A/B test not found');
      
      const test = testRes.rows[0];
      if (test.status === 'completed') {
        console.log(`[WinnerDetection] ℹ️ Test ${testId} is already completed.`);
        return test.winner;
      }

      // 2. Aggregate metrics for each variant linked to this test
      // Based on V006, caption_performance is linked to ab_test_id
      const metricsRes = await pool.query(`
        SELECT 
          variant,
          COUNT(*) as sample_size,
          SUM(likes) as total_likes,
          SUM(comments) as total_comments,
          AVG(engagement_rate) as avg_er
        FROM caption_performance
        WHERE ab_test_id = $1
        GROUP BY variant
      `, [testId]);

      const variants = {};
      metricsRes.rows.forEach(row => {
        variants[row.variant] = row;
      });

      const variantA = variants['A'];
      const variantB = variants['B'];

      if (!variantA || !variantB) {
        console.log('[WinnerDetection] ⚠️ Insufficient data: missing variants.');
        return null;
      }

      // 3. Significance Check (Simplified)
      const minSample = test.sample_size_needed || 10;
      if (variantA.sample_size < minSample || variantB.sample_size < minSample) {
        console.log(`[WinnerDetection] ⏳ Still gathering data (${variantA.sample_size}/${minSample}).`);
        return null;
      }

      // 4. Determine Winner
      let winner = null;
      let winningER = 0;

      if (variantA.avg_er > variantB.avg_er) {
        winner = 'A';
        winningER = variantA.avg_er;
      } else if (variantB.avg_er > variantA.avg_er) {
        winner = 'B';
        winningER = variantB.avg_er;
      }

      // 5. Commit winner if delta is significant (>10% improvement)
      const diff = Math.abs(variantA.avg_er - variantB.avg_er);
      const threshold = Math.min(variantA.avg_er, variantB.avg_er) * 0.1;

      if (winner && diff > threshold) {
        await pool.query(
          `UPDATE ab_tests 
           SET winner = $1, status = 'completed', winning_er = $2, last_winner_at = NOW(), completed_at = NOW() 
           WHERE id = $3`,
          [winner, winningER, testId]
        );
        console.log(`[WinnerDetection] 🎉 Winner declared: Variant ${winner} (${winningER}% ER)`);
        return winner;
      }

      console.log('[WinnerDetection] ⚖️ Variants are too close to call. Continuing test.');
      return null;

    } catch (err) {
      console.error(`[WinnerDetection] ❌ Error evaluating test ${testId}:`, err.message);
      throw err;
    }
  }

  /**
   * Auto-evaluate all running tests
   */
  async runAutoEvaluation() {
    const pool = getPool();
    const activeTests = await pool.query("SELECT id FROM ab_tests WHERE status = 'running'");
    for (const test of activeTests.rows) {
      await this.evaluateTest(test.id);
    }
  }
}

module.exports = new WinnerDetectionService();
