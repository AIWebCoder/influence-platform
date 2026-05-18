const { Counter, Histogram } = require('prom-client');

const personaProxyRequests = new Counter({
  name: 'persona_proxy_requests_total',
  help: 'Outbound HTTP requests via persona-bound proxy',
  labelNames: ['persona_id', 'platform', 'success'],
});

const personaProxyLatency = new Histogram({
  name: 'persona_proxy_request_duration_ms',
  help: 'Latency of persona proxy HTTP calls',
  labelNames: ['persona_id', 'stage'],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000, 30000],
});

function recordProxyRequest({ personaId, platform, success, durationMs, stage }) {
  const pid = personaId || 'unknown';
  personaProxyRequests.inc({
    persona_id: pid,
    platform: platform || 'unknown',
    success: success ? 'true' : 'false',
  });
  if (durationMs != null) {
    personaProxyLatency.observe({ persona_id: pid, stage: stage || 'request' }, durationMs);
  }
}

module.exports = { recordProxyRequest, personaProxyRequests, personaProxyLatency };
