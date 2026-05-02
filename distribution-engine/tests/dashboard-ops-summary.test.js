const express = require('express');
const http = require('http');

jest.mock('../src/core/database', () => ({
  getPool: jest.fn(),
}));

jest.mock('../src/core/redis', () => ({
  getRedis: jest.fn(),
}));

const { getPool } = require('../src/core/database');
const { getRedis } = require('../src/core/redis');
const dashboardRouter = require('../src/managers/dashboardRouter');

function getJson(path) {
  const app = express();
  app.use('/dashboard', dashboardRouter);
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http
        .get(`http://127.0.0.1:${port}${path}`, (res) => {
          let raw = '';
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: JSON.parse(raw) });
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', (err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe('GET /dashboard/ops-summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockReturnValue({
      query: jest.fn().mockImplementation((sql) => {
        const s = String(sql);
        if (s.includes('published_at') && s.includes('15 minutes')) {
          return Promise.resolve({
            rows: [
              {
                published_15m: '2',
                failed_15m: '0',
                permanently_failed_15m: '0',
                published_1h: '5',
                failed_1h: '1',
                permanently_failed_1h: '0',
              },
            ],
          });
        }
        if (s.includes('retrying_count')) {
          return Promise.resolve({ rows: [{ retrying_count: '0', oldest_retry_age_min: '0' }] });
        }
        if (s.includes('intervention_needed')) {
          return Promise.resolve({ rows: [{ intervention_needed: '0' }] });
        }
        if (s.includes('failure_type')) {
          return Promise.resolve({ rows: [] });
        }
        if (s.includes('FROM accounts')) {
          return Promise.resolve({
            rows: [{ total: '3', active: '2', warming: '1', low_health: '0' }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
    });
    getRedis.mockReturnValue({
      llen: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(0),
    });
  });

  it('returns aggregated ops summary JSON', async () => {
    const { status, body } = await getJson('/dashboard/ops-summary');
    expect(status).toBe(200);
    expect(body.publication_windows.last_15m.published).toBe(2);
    expect(body.publication_windows.last_1h.failed).toBe(1);
    expect(body.accounts.active).toBe(2);
    expect(Array.isArray(body.failure_breakdown)).toBe(true);
  });
});
