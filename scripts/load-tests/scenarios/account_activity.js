import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

const BASE_URL_DISTRIBUTION = __ENV.BASE_URL_DISTRIBUTION || 'http://localhost:3001';
const BASE_URL_CONTENT_FACTORY = __ENV.BASE_URL_CONTENT_FACTORY || 'http://localhost:8000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';
const NUM_ACCOUNTS = parseInt(__ENV.NUM_ACCOUNTS) || 50;

export const options = {
  scenarios: {
    account_activity: {
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
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.2'],
  },
};

const errorRate = new Rate('errors');
const actionLatency = new Trend('action_latency');
const loginSuccessRate = new Rate('login_success');
const proxySuccessRate = new Rate('proxy_success');
const activeAccountsGauge = new Gauge('active_accounts');

const actions = ['login', 'post', 'like', 'follow', 'comment', 'view_story'];
const niches = ['fitness', 'travel', 'food', 'fashion', 'business'];

export default function () {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
  };

  const action = actions[Math.floor(Math.random() * actions.length)];
  const accountId = `account_${Math.floor(Math.random() * NUM_ACCOUNTS)}`;
  const startTime = Date.now();
  let success = false;

  switch (action) {
    case 'login':
      const res = http.post(
        `${BASE_URL_DISTRIBUTION}/accounts/${accountId}/login`,
        JSON.stringify({ proxy: true }),
        { headers }
      );
      success = check(res, {
        'login status is 200': (r) => r.status === 200,
      });
      loginSuccessRate.add(success ? 1 : 0);
      break;

    case 'post':
      const postRes = http.post(
        `${BASE_URL_DISTRIBUTION}/publish`,
        JSON.stringify({
          account_id: accountId,
          content: {
            caption: `Test post ${Date.now()}`,
            hashtags: ['#test', '#loadtest'],
            image_url: 'https://example.com/test.jpg',
          },
        }),
        { headers }
      );
      success = check(postRes, {
        'post status is 200': (r) => r.status === 200 || r.status === 202,
      });
      break;

    case 'like':
      const likeRes = http.post(
        `${BASE_URL_DISTRIBUTION}/actions/like`,
        JSON.stringify({
          account_id: accountId,
          target_url: `https://instagram.com/p/test${Math.floor(Math.random() * 1000)}`,
        }),
        { headers }
      );
      success = check(likeRes, {
        'like status is 200': (r) => r.status === 200,
      });
      break;

    case 'follow':
      const followRes = http.post(
        `${BASE_URL_DISTRIBUTION}/actions/follow`,
        JSON.stringify({
          account_id: accountId,
          target_username: `user_${Math.floor(Math.random() * 1000)}`,
        }),
        { headers }
      );
      success = check(followRes, {
        'follow status is 200': (r) => r.status === 200,
      });
      break;

    case 'comment':
      const commentRes = http.post(
        `${BASE_URL_DISTRIBUTION}/actions/comment`,
        JSON.stringify({
          account_id: accountId,
          target_url: `https://instagram.com/p/test${Math.floor(Math.random() * 1000)}`,
          text: 'Great post!',
        }),
        { headers }
      );
      success = check(commentRes, {
        'comment status is 200': (r) => r.status === 200,
      });
      break;

    case 'view_story':
      const storyRes = http.get(
        `${BASE_URL_DISTRIBUTION}/accounts/${accountId}/stories`,
        { headers }
      );
      success = check(storyRes, {
        'stories status is 200': (r) => r.status === 200,
      });
      break;

    default:
      const defaultRes = http.get(`${BASE_URL_CONTENT_FACTORY}/health`, { headers });
      success = check(defaultRes, {
        'health status is 200': (r) => r.status === 200,
      });
  }

  actionLatency.add(Date.now() - startTime);
  errorRate.add(!success);
  proxySuccessRate.add(success ? 1 : 0);

  sleep(Math.random() * 4 + 2);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    [`results/account_activity_${Date.now()}.json`]: JSON.stringify(data),
  };
}

function textSummary(data, options) {
  const indent = options.indent || '';
  const output = [`\n${indent}=== Account Activity Simulation Results ===\n`];
  
  if (data.metrics.http_req_duration) {
    const duration = data.metrics.http_req_duration;
    output.push(`${indent}Action Latency (avg): ${duration.values.avg.toFixed(2)}ms`);
    output.push(`${indent}Action Latency (p95): ${duration.values['p(95)'].toFixed(2)}ms`);
    output.push(`${indent}Action Latency (max): ${duration.values.max.toFixed(2)}ms`);
  }
  
  if (data.metrics.http_req_failed) {
    const failed = data.metrics.http_req_failed;
    output.push(`${indent}Error Rate: ${(failed.values.rate * 100).toFixed(2)}%`);
  }
  
  if (data.metrics.login_success) {
    const login = data.metrics.login_success;
    output.push(`${indent}Login Success Rate: ${(login.values.rate * 100).toFixed(2)}%`);
  }
  
  if (data.metrics.proxy_success) {
    const proxy = data.metrics.proxy_success;
    output.push(`${indent}Proxy Success Rate: ${(proxy.values.rate * 100).toFixed(2)}%`);
  }
  
  return output.join('\n');
}
