import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL_CONTENT_FACTORY || 'http://localhost:8000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const NUM_ACCOUNTS = parseInt(__ENV.NUM_ACCOUNTS) || 50;

export const options = {
  scenarios: {
    content_generation: {
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
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.1'],
  },
};

const errorRate = new Rate('errors');
const generateDuration = new Trend('content_generate_duration');
const bulkGenerateDuration = new Trend('bulk_generate_duration');

const niches = ['fitness', 'travel', 'food', 'fashion', 'business', 'lifestyle', 'beauty', 'tech'];
const contentTypes = ['post', 'story', 'reel'];

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };

  const scenario = Math.floor(Math.random() * 3);
  
  if (scenario === 0) {
    const startTime = Date.now();
    const res = http.post(
      `${BASE_URL}/content/generate`,
      JSON.stringify({
        niche: niches[Math.floor(Math.random() * niches.length)],
        type: contentTypes[Math.floor(Math.random() * contentTypes.length)],
        target_accounts: [`account_${Math.floor(Math.random() * NUM_ACCOUNTS)}`],
      }),
      { headers }
    );
    generateDuration.add(Date.now() - startTime);
    
    const success = check(res, {
      'generate status is 200': (r) => r.status === 200,
      'generate returns content': (r) => r.json('caption') !== undefined,
    });
    errorRate.add(!success);
  } else if (scenario === 1) {
    const startTime = Date.now();
    const bulkCount = Math.floor(Math.random() * 5) + 1;
    const accounts = Array.from({ length: bulkCount }, (_, i) => `account_${Math.floor(Math.random() * NUM_ACCOUNTS)}_${i}`);
    
    const res = http.post(
      `${BASE_URL}/content/generate/bulk`,
      JSON.stringify({
        niche: niches[Math.floor(Math.random() * niches.length)],
        type: contentTypes[Math.floor(Math.random() * contentTypes.length)],
        target_accounts: accounts,
      }),
      { headers }
    );
    bulkGenerateDuration.add(Date.now() - startTime);
    
    const success = check(res, {
      'bulk generate status is 200': (r) => r.status === 200,
      'bulk generate returns items': (r) => Array.isArray(r.json('items')),
    });
    errorRate.add(!success);
  } else {
    const res = http.get(`${BASE_URL}/content/queue/size`, { headers });
    
    const success = check(res, {
      'queue size status is 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
  }

  sleep(Math.random() * 2 + 0.5);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    [`results/content_generation_${Date.now()}.json`]: JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  const output = [`\n${indent}=== Content Generation Load Test Results ===\n`];
  
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
  
  if (data.metrics.content_generate_duration) {
    const gen = data.metrics.content_generate_duration;
    output.push(`${indent}Content Generate (avg): ${gen.values.avg.toFixed(2)}ms`);
  }
  
  return output.join('\n');
}
