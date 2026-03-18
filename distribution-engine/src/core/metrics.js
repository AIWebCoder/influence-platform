const client = require('prom-client');

// Create a default registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// === EXISTING METRICS ===

const queueSize = new client.Gauge({
  name: 'distribution_queue_size',
  help: 'Current size of the content:ready Redis queue',
  registers: [register],
});

const publicationsTotal = new client.Counter({
  name: 'distribution_publications_total',
  help: 'Total number of publications',
  labelNames: ['status'],
  registers: [register],
});

const activeAccounts = new client.Gauge({
  name: 'distribution_active_accounts',
  help: 'Number of active accounts',
  registers: [register],
});

const banEventsTotal = new client.Counter({
  name: 'distribution_ban_events_total',
  help: 'Total number of ban/shadowban events',
  labelNames: ['type'],
  registers: [register],
});

// === PHASE 8: OBSERVABILITY METRICS ===

// Task 8.1: Publishing Success Metrics
const publishingAttempts = new client.Counter({
  name: 'distribution_publishing_attempts_total',
  help: 'Total publishing attempts',
  labelNames: ['status'], // success, failed, rate_limited
  registers: [register],
});

const publishingDuration = new client.Histogram({
  name: 'distribution_publishing_duration_seconds',
  help: 'Publishing duration in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// Task 8.2: Account Login Metrics
const accountLoginAttempts = new client.Counter({
  name: 'distribution_account_login_attempts_total',
  help: 'Total account login attempts',
  labelNames: ['status'], // success, failed, locked
  registers: [register],
});

const accountLoginDuration = new client.Histogram({
  name: 'distribution_account_login_duration_seconds',
  help: 'Account login duration in seconds',
  buckets: [1, 5, 10, 30, 60],
  registers: [register],
});

// Task 8.3: Proxy Failure Metrics
const proxyRequests = new client.Counter({
  name: 'distribution_proxy_requests_total',
  help: 'Total proxy requests',
  labelNames: ['status'], // success, failed, timeout
  registers: [register],
});

const proxyResponseTime = new client.Histogram({
  name: 'distribution_proxy_response_time_seconds',
  help: 'Proxy response time in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const activeProxies = new client.Gauge({
  name: 'distribution_active_proxies',
  help: 'Number of active proxies',
  registers: [register],
});

// Task 8.4: Queue Backlog Metrics
const queueBacklogAge = new client.Gauge({
  name: 'distribution_queue_backlog_age_seconds',
  help: 'Age of oldest item in queue in seconds',
  registers: [register],
});

const queueProcessingRate = new client.Gauge({
  name: 'distribution_queue_processing_rate',
  help: 'Items processed per minute',
  registers: [register],
});

// Task 8.6: Action Metrics (from Phase 6)
const actionLimitsExceeded = new client.Counter({
  name: 'distribution_action_limits_exceeded_total',
  help: 'Total times action limits were exceeded',
  labelNames: ['action_type', 'account_id'],
  registers: [register],
});

const cooldownsActive = new client.Gauge({
  name: 'distribution_active_cooldowns',
  help: 'Number of active cooldowns',
  labelNames: ['action_type'],
  registers: [register],
});

module.exports = {
  register,
  queueSize,
  publicationsTotal,
  activeAccounts,
  banEventsTotal,
  // Phase 8 new metrics
  publishingAttempts,
  publishingDuration,
  accountLoginAttempts,
  accountLoginDuration,
  proxyRequests,
  proxyResponseTime,
  activeProxies,
  queueBacklogAge,
  queueProcessingRate,
  actionLimitsExceeded,
  cooldownsActive,
};
