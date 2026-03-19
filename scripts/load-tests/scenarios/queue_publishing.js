import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL_CONTENT_FACTORY || 'http://localhost:8000';
const REDIS_URL = __ENV.REDIS_URL || 'redis://localhost:6379';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const NUM_ACCOUNTS = parseInt(__ENV.NUM_ACCOUNTS) || 50;

export const options = {
  scenarios: {
    queue_publishing: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.min(NUM_ACCOUNTS / 10, 10) },
        { duration: '1m', target: Math.min(NUM_ACCOUNTS / 5, 20) },
        { duration: '2m', target: Math.min(NUM_ACCOUNTS / 2, 50) },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.15'],
  },
};

const errorRate = new Rate('errors');
const queuePushDuration = new Trend('queue_push_duration');
const queueSizeGauge = new Gauge('redis_queue_size');
const publishSuccessRate = new Rate('publish_success');
const publishDuration = new Trend('publish_duration');

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };

  const scenario = Math.floor(Math.random() * 4);
  
  if (scenario === 0) {
    const startTime = Date.now();
    const res = http.post(
      `${BASE_URL}/scheduling/publish`,
      JSON.stringify({
        account_id: `account_${Math.floor(Math.random() * NUM_ACCOUNTS)}`,
        content_id: `content_${Math.floor(Math.random() * 10000)}`,
      }),
      { headers }
    );
    queuePushDuration.add(Date.now() - startTime);
    
    const success = check(res, {
      'publish status is 200': (r) => r.status === 200 || r.status === 202,
    });
    errorRate.add(!success);
    publishSuccessRate.add(success ? 1 : 0);
  } else if (scenario === 1) {
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/scheduling/queue/size`, { headers });
    publishDuration.add(Date.now() - startTime);
    
    if (res.status === 200) {
      const size = res.json('queue_size');
      queueSizeGauge.add(size);
    }
    
    const success = check(res, {
      'queue size check status is 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  } else if (scenario === 2) {
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/scheduling/pending`, { headers });
    publishDuration.add(Date.now() - startTime);
    
    const success = check(res, {
      'pending items status is 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  } else {
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/health`, { headers });
    publishDuration.add(Date.now() - startTime);
    
    const success = check(res, {
      'health check status is 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  }

  sleep(Math.random() * 3 + 1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    [`results/queue_publishing_${Date.now()}.json`]: JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  const output = [`\n${indent}=== Queue & Publishing Load Test Results ===\n`];
  
  if (data.metrics.http_req_duration) {
    const duration = data.metrics.http_req_duration;
    output.push(`${indent}Response Time (avg): ${duration.values.avg.toFixed(2)}ms`);
    output.push(`${indent}Response Time (p95): ${duration.values['p(95)'].toFixed(2)}ms`);
    output.push(`${indent}Response Time (max): ${duration.values.max.toFixed(2)}ms`);
  }
  
  if (data.metrics.http_req_failed) {
    const failed = data.metrics.http_req_failed;
    output.push(`${indent}Error Rate: ${(failed.values.rate * 100).toFixed(2)}%`);
  }
  
  if (data.metrics.publish_success) {
    const success = data.metrics.publish_success;
    output.push(`${indent}Publish Success Rate: ${(success.values.rate * 100).toFixed(2)}%`);
  }
  
  return output.join('\n');
}
