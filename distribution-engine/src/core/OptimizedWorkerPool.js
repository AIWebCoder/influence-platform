const Redis = require('ioredis');
const os = require('os');

class OptimizedWorkerPool {
  constructor(options = {}) {
    this.queueName = options.queueName || 'content:ready';
    this.maxConcurrent = options.maxConcurrent || 10;
    this.batchSize = options.batchSize || 5;
    this.cpuThreshold = options.cpuThreshold || 80;
    this.pollInterval = options.pollInterval || 1000;
    this.maxRetries = options.maxRetries || 3;
    
    this.currentWorkers = 0;
    this.isRunning = false;
    this.redisClient = null;
    this.consumer = null;
    this.cpuCheckInterval = null;
    this.lastCpuCheck = Date.now();
    this.currentCpuUsage = 0;
    this.isBackpressure = false;
    this.backpressureDelay = 5000;
    
    this.metrics = {
      processed: 0,
      failed: 0,
      retries: 0,
      backpressureEvents: 0,
      totalProcessingTime: 0,
    };
  }

  async initialize(redisUrl) {
    this.redisClient = new Redis(redisUrl);
    await this.redisClient.ping();
    
    this.consumer = new Redis(redisUrl);
    
    console.log(`✅ OptimizedWorkerPool initialized (maxConcurrent: ${this.maxConcurrent}, batchSize: ${this.batchSize}, cpuThreshold: ${this.cpuThreshold}%)`);
    
    this.startCpuMonitoring();
  }

  startCpuMonitoring() {
    this.cpuCheckInterval = setInterval(async () => {
      try {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        
        for (const cpu of cpus) {
          for (const type in cpu.times) {
            totalTick += cpu.times[type];
          }
          totalIdle += cpu.times.idle;
        }
        
        const idle = totalIdle / cpus.length;
        const total = totalTick / cpus.length;
        const usage = 100 - (100 * idle / total);
        
        this.currentCpuUsage = Math.round(usage);
        this.lastCpuCheck = Date.now();
        
        if (this.currentCpuUsage > this.cpuThreshold && !this.isBackpressure) {
          this.isBackpressure = true;
          this.metrics.backpressureEvents++;
          console.log(`⚠️ [WorkerPool] CPU high (${this.currentCpuUsage}%). Enabling backpressure.`);
        } else if (this.currentCpuUsage < this.cpuThreshold - 10 && this.isBackpressure) {
          this.isBackpressure = false;
          console.log(`✅ [WorkerPool] CPU normalized (${this.currentCpuUsage}%). Disabling backpressure.`);
        }
      } catch (err) {
        console.error('[WorkerPool] CPU monitoring error:', err.message);
      }
    }, 5000);
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log(`👂 OptimizedWorkerPool started: ${this.queueName}`);
    
    this.poll();
  }

  async poll() {
    if (!this.isRunning) return;
    
    if (this.isBackpressure) {
      setTimeout(() => this.poll(), this.backpressureDelay);
      return;
    }
    
    if (this.currentWorkers >= this.maxConcurrent) {
      setTimeout(() => this.poll(), this.pollInterval);
      return;
    }

    try {
      const results = await this.consumer.brpop(this.queueName, 2);
      
      if (results) {
        const [, payload] = results;
        const packet = JSON.parse(payload);
        
        this.currentWorkers++;
        console.log(`[WorkerPool] Processing: ${packet.id || 'unknown'} | Active: ${this.currentWorkers}/${this.maxConcurrent} | CPU: ${this.currentCpuUsage}%`);
        
        this.processPacket(packet)
          .then(() => {
            this.metrics.processed++;
          })
          .catch(err => {
            console.error(`[WorkerPool] Error processing packet:`, err.message);
            this.metrics.failed++;
          })
          .finally(() => {
            this.currentWorkers--;
            setImmediate(() => this.poll());
          });
      } else {
        setImmediate(() => this.poll());
      }
    } catch (err) {
      console.error('[WorkerPool] Poll error:', err.message);
      setTimeout(() => this.poll(), 5000);
    }
  }

  async processPacket(packet) {
    const startTime = Date.now();
    
    try {
      const PublishingWorker = require('../publisher/PublishingWorker');
      await PublishingWorker.processPacket(packet);
      
      this.metrics.totalProcessingTime += Date.now() - startTime;
      
      return { success: true };
    } catch (err) {
      console.error(`[WorkerPool] Failed to process packet ${packet.id}:`, err.message);
      throw err;
    }
  }

  async processBatch(packet) {
    const results = await Promise.allSettled(
      packet.map(p => this.processPacket(p))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`[WorkerPool] Batch complete: ${succeeded} succeeded, ${failed} failed`);
    
    return { succeeded, failed };
  }

  getMetrics() {
    const avgProcessingTime = this.metrics.processed > 0 
      ? Math.round(this.metrics.totalProcessingTime / this.metrics.processed) 
      : 0;
    
    return {
      ...this.metrics,
      currentWorkers: this.currentWorkers,
      maxConcurrent: this.maxConcurrent,
      cpuUsage: this.currentCpuUsage,
      isBackpressure: this.isBackpressure,
      avgProcessingTime,
    };
  }

  setMaxConcurrent(value) {
    this.maxConcurrent = Math.max(1, Math.min(value, 50));
    console.log(`[WorkerPool] maxConcurrent updated to: ${this.maxConcurrent}`);
  }

  async stop() {
    this.isRunning = false;
    
    if (this.cpuCheckInterval) {
      clearInterval(this.cpuCheckInterval);
    }
    
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    if (this.consumer) {
      await this.consumer.quit();
    }
    
    console.log('[WorkerPool] Stopped');
  }

  async pushDelayed(payload, delayMs) {
    const score = Date.now() + delayMs;
    await this.redisClient.zadd('content:delayed', score, JSON.stringify(payload));
    console.log(`[WorkerPool] Delayed packet scheduled for ${Math.round(delayMs / 60000)} minutes.`);
  }

  async getQueueSize() {
    return await this.redisClient.llen(this.queueName);
  }

  async getDelayedCount() {
    return await this.redisClient.zcard('content:delayed');
  }
}

module.exports = OptimizedWorkerPool;
