const { getPool } = require('../core/database');
const AccountService = require('../managers/AccountService');

class BanMonitor {
  /**
   * Logs a critical alert when a ban or action block is detected,
   * and sidelines the account to protect it.
   * @param {string} accountId 
   * @param {string} type 'ban' or 'action_block'
   * @param {string} message 
   */
  async recordAlert(accountId, type, message) {
    console.error(`[BanMonitor] 🛑 Critical Alert for ${accountId}: ${type} - ${message}`);
    
    // 1. Update account status based on severity
    let status = 'flagged';
    if (type === 'ban') status = 'banned';
    if (message.includes('Action Blocked')) status = 'cooldown';

    await AccountService.updateAccountHealth(accountId, status === 'banned' ? -100 : -20, status);

    // 2. Insert into alerts table
    const pool = getPool();
    const query = `
      INSERT INTO alerts (id, account_id, type, message, is_read, created_at)
      VALUES (gen_random_uuid(), $1, $2, $3, false, NOW())
    `;
    
    try {
      await pool.query(query, [accountId, type, message]);
    } catch (err) {
      // If table doesn't exist yet in MVP phase, just log it.
      if (err.code === '42P01') { // relation "alerts" does not exist
        console.warn(`[BanMonitor] 'alerts' table missing, skipping DB insertion.`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Finds an alternative active account for the same niche to use as a fallback.
   * Note: Assuming we have a way to match niche. For MVP, we'll just pick any active account
   * if we don't have a strict niche_id on the accounts table.
   * @param {string} failedAccountId 
   */
  async getBackupAccount(failedAccountId) {
    const pool = getPool();
    // In a full implementation, we'd join on niches.
    // For now, fetch any active account that is NOT the failed one.
    const result = await pool.query(
      `SELECT id FROM accounts WHERE status = 'active' AND id != $1 LIMIT 1`,
      [failedAccountId]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
    return null; // No backups available
  }
}

module.exports = new BanMonitor();
