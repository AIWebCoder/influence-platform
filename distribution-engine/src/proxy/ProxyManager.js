const { getPool } = require('../core/database');
const net = require('net');

class ProxyManager {
  /**
   * Assigns a proxy to an account with enhanced load balancing:
   * 1. Stickiness: check if account already has a healthy assigned proxy
   * 2. Load balancing: find proxies with:
   *    - is_active = true
   *    - Lowest number of assigned accounts (least used)
   *    - Lowest response_time (fastest)
   */
  async assignProxyToAccount(accountId) {
    const pool = getPool();

    // 1. Check if account already has an assigned active proxy
    const existing = await pool.query(
      `SELECT p.id, p.host, p.port, p.is_active
       FROM accounts a
       JOIN proxies p ON a.proxy_id = p.id
       WHERE a.id = $1`,
      [accountId]
    );

    if (existing.rows.length > 0 && existing.rows[0].is_active) {
      const proxy = existing.rows[0];
      return {
        id: accountId,
        proxy_id: proxy.id,
        proxy_url: `${proxy.host}:${proxy.port}`,
        proxy_type: proxy.proxy_type || 'http',
        auth_mode: proxy.auth_mode || 'credentials',
      };
    }

    // 2. Select the best available proxy
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Select best proxy based on usage count and then latency
      const res = await client.query(`
        SELECT p.id, p.host, p.port, p.proxy_type, p.auth_mode, COUNT(a.id) as assigned_count
        FROM proxies p
        LEFT JOIN accounts a ON p.id = a.proxy_id
        WHERE p.is_active = true
        GROUP BY p.id
        ORDER BY assigned_count ASC, COALESCE(p.response_time, 9999) ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      `);
      
      if (res.rows.length === 0) {
        throw new Error('No available active proxies in pool');
      }
      
      const proxy = res.rows[0];
      
      // Update proxy record
      await client.query(
        'UPDATE proxies SET assigned_account_id = $1 WHERE id = $2',
        [accountId, proxy.id]
      );
      
      // Update account record
      await client.query(
        'UPDATE accounts SET proxy_id = $1 WHERE id = $2',
        [proxy.id, accountId]
      );
      
      await client.query('COMMIT');
      
      return {
        id: accountId,
        proxy_id: proxy.id,
        proxy_url: `${proxy.host}:${proxy.port}`,
        proxy_type: proxy.proxy_type || 'http',
        auth_mode: proxy.auth_mode || 'credentials',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[ProxyManager] Error assigning proxy:', err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Records proxy success/failure and updates usage metrics
   * Enhanced with scoring system (Priority 4)
   * @param {string} proxyId 
   * @param {boolean} success 
   * @param {number} responseTime - Response time in ms (optional)
   */
  async recordProxyUsage(proxyId, success, responseTime = null) {
    const pool = getPool();
    try {
      if (success && responseTime) {
        await pool.query(`
          UPDATE proxies 
          SET 
            total_requests = total_requests + 1,
            success_count = success_count + 1,
            total_response_time = COALESCE(total_response_time, 0) + $3,
            response_time = total_response_time / NULLIF(success_count, 0),
            success_rate = (success_count::float / total_requests::float) * 100,
            last_checked_at = NOW(),
            last_success_at = NOW()
          WHERE id = $1
        `, [proxyId, success, responseTime]);
      } else {
        await pool.query(`
          UPDATE proxies 
          SET 
            total_requests = total_requests + 1,
            failure_count = failure_count + 1,
            success_rate = CASE 
              WHEN total_requests > 0 THEN (success_count::float / total_requests::float) * 100 
              ELSE 0 
            END,
            last_checked_at = NOW(),
            is_active = CASE 
              WHEN failure_count >= 5 THEN false 
              ELSE is_active 
            END
          WHERE id = $1
        `, [proxyId]);
      }
    } catch (err) {
      console.error('[ProxyManager] Error recording proxy usage:', err.message);
    }
  }

  /**
   * Get proxy score for ranking (Priority 4.1)
   * Higher score = better proxy
   */
  async getProxyScore(proxyId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 
        is_active,
        success_rate,
        response_time,
        total_requests,
        failure_count,
        last_checked_at,
        EXTRACT(EPOCH FROM (NOW() - last_checked_at)) as seconds_since_check
      FROM proxies WHERE id = $1`,
      [proxyId]
    );
    
    if (result.rows.length === 0) return 0;
    
    const p = result.rows[0];
    let score = 0;
    
    if (!p.is_active) return 0;
    
    score += Math.min(p.success_rate || 0, 50);
    
    if (p.response_time && p.response_time < 1000) {
      score += 30 * (1 - p.response_time / 1000);
    }
    
    if (p.seconds_since_check < 300) {
      score += 20;
    } else if (p.seconds_since_check < 600) {
      score += 10;
    }
    
    if (p.total_requests > 10) {
      score += Math.min(10, p.total_requests / 50);
    }
    
    return Math.round(score);
  }

  /**
   * Auto-disable proxies with low scores (Priority 4.2)
   */
  async autoDisablePoorProxies() {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, host, port, success_rate, response_time, failure_count
       FROM proxies 
       WHERE is_active = true`
    );
    
    let disabled = 0;
    for (const proxy of result.rows) {
      const score = await this.getProxyScore(proxy.id);
      if (score < 30 || proxy.failure_count >= 10) {
        await pool.query(
          'UPDATE proxies SET is_active = false WHERE id = $1',
          [proxy.id]
        );
        console.log(`[ProxyManager] Auto-disabled proxy ${proxy.host}:${proxy.port} (score: ${score})`);
        disabled++;
      }
    }
    
    if (disabled > 0) {
      console.log(`[ProxyManager] Auto-disabled ${disabled} poor performing proxies`);
    }
    
    return disabled;
  }

  /**
   * Measures TCP latency and updates health status
   */
  async checkProxyHealth(proxyId) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT host, port FROM proxies WHERE id = $1',
      [proxyId]
    );

    if (result.rows.length === 0) return false;
    const { host, port } = result.rows[0];

    const startTime = Date.now();
    try {
      await this._testConnection(host, port);
      const latency = Date.now() - startTime;

      await pool.query(
        `UPDATE proxies 
         SET is_active = true, response_time = $2, last_checked_at = NOW(), failure_count = 0 
         WHERE id = $1`,
        [proxyId, latency]
      );
      return { healthy: true, latency };
    } catch (err) {
      console.warn(`[ProxyManager] ❌ Proxy ${host}:${port} health check failed: ${err.message}`);
      await pool.query(
        'UPDATE proxies SET is_active = false, last_checked_at = NOW() WHERE id = $1',
        [proxyId]
      );
      return { healthy: false, latency: null };
    }
  }

  /**
   * Periodic runner for pool-wide health checks
   */
  async runHealthCheckAll() {
    const pool = getPool();
    const result = await pool.query('SELECT id, host, port FROM proxies');
    const total = result.rows.length;

    if (total === 0) return;

    let healthyCount = 0;
    for (const proxy of result.rows) {
      const status = await this.checkProxyHealth(proxy.id);
      if (status.healthy) healthyCount++;
    }

    console.log(`[ProxyManager] Periodic check: ${healthyCount}/${total} proxies healthy.`);

    // Critical shortage alert
    if (total > 0 && (healthyCount / total) < 0.2) {
      await pool.query(
        `INSERT INTO alerts (id, type, message, created_at)
         VALUES (gen_random_uuid(), 'warning', $1, NOW())`,
        [`Critical proxy pool health: only ${healthyCount}/${total} proxies active. Check provider status.`]
      );
    }
  }

  async getHealthStatus() {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, host, port, is_active, response_time, success_rate, total_requests, provider, country, last_checked_at,
              proxy_type, auth_mode
       FROM proxies 
       ORDER BY is_active DESC, response_time ASC NULLS LAST`
    );
    return result.rows;
  }

  _testConnection(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port, timeout: 5000 }, () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', (err) => { socket.destroy(); reject(err); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Connect timeout')); });
    });
  }
}

module.exports = new ProxyManager();
