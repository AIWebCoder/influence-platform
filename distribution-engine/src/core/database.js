const { Pool } = require('pg');

let pool;

async function initDB() {
  pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    max: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : 10,
    idleTimeoutMillis: 30000
  });
  await pool.query('SELECT 1');
  const { ensureProxySchema } = require('./proxySchema');
  await ensureProxySchema(pool);
  console.log('✅ PostgreSQL connecté (Distribution Engine)');
}

function getPool() { return pool; }

module.exports = { initDB, getPool };
