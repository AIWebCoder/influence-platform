const Redis = require('ioredis');

let redisClient;

async function initRedis() {
  redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  await redisClient.ping();
  console.log('✅ Redis connecté (Distribution Engine)');

  // Start the delayed queue poller
  pollDelayedQueue();
}

/**
 * Consumer de queue — écoute les contenus prêts à publier
 */
async function consumeQueue(queueName) {
  const consumer = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  console.log(`👂 Écoute de la queue: ${queueName} (Concurrency: ${process.env.MAX_CONCURRENT_WORKERS || 3})`);
  
  const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_WORKERS || '3', 10);
  let currentWorkers = 0;

  const poll = async () => {
    if (currentWorkers >= MAX_CONCURRENT) {
      setTimeout(poll, 1000);
      return;
    }

    try {
      const result = await consumer.brpop(queueName, 2);
      
      if (result) {
        const [, payload] = result;
        const packet = JSON.parse(payload);
        
        console.log(`📦 Nouveau contenu reçu en file d'attente:`, {
          id: packet.id,
          niche: packet.niche,
          type: packet.type,
          accounts: packet.target_accounts
        });

        currentWorkers++;
        console.log(`[QueueManager] Active Workers: ${currentWorkers}/${MAX_CONCURRENT}`);

        const PublishingWorker = require('../publisher/PublishingWorker');
        PublishingWorker.processPacket(packet)
          .catch(err => console.error('Erreur non attrapée dans PublishingWorker:', err))
          .finally(() => {
             currentWorkers--;
             console.log(`[QueueManager] Worker libéré. Active Workers: ${currentWorkers}/${MAX_CONCURRENT}`);
          });
      }
      setImmediate(poll);
    } catch (err) {
      console.error(`[QueueManager] Consumer error on ${queueName}:`, err.message);
      // Backoff if Redis is unreachable
      console.log('[QueueManager] Reconnecting in 5 seconds...');
      setTimeout(poll, 5000);
    }
  };

  poll();
}

/**
 * Push a packet to a delayed queue using a Redis sorted set.
 * The packet will be moved to the main queue after `delayMs` milliseconds.
 * @param {string} payload - JSON string of the packet
 * @param {number} delayMs - Delay in milliseconds before the packet becomes available
 */
async function pushDelayed(payload, delayMs) {
  const score = Date.now() + delayMs;
  await redisClient.zadd('content:delayed', score, payload);
  console.log(`[Redis] Packet pushed to delayed queue. Will be ready in ${Math.round(delayMs / 60000)} minutes.`);
}

/**
 * Polls the delayed sorted set every 10 seconds.
 * Moves items whose score (timestamp) has passed to the main content:ready queue.
 */
function pollDelayedQueue() {
  const POLL_INTERVAL = 10000; // 10 seconds

  setInterval(async () => {
    try {
      const now = Date.now();
      // Get items with score <= now (their delay has expired)
      const items = await redisClient.zrangebyscore('content:delayed', 0, now);

      for (const item of items) {
        // Move to the main queue
        await redisClient.lpush('content:ready', item);
        await redisClient.zrem('content:delayed', item);
        console.log(`[Redis] Moved delayed packet to content:ready queue.`);
      }
    } catch (err) {
      console.error('[Redis] Error polling delayed queue:', err.message);
    }
  }, POLL_INTERVAL);
}

function getRedis() {
  return redisClient;
}

module.exports = { initRedis, consumeQueue, getRedis, pushDelayed };
