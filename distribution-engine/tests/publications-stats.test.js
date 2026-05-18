const express = require('express');
const http = require('http');

jest.mock('../src/core/database', () => ({
  getPool: jest.fn(),
}));

const { getPool } = require('../src/core/database');
const publicationsRouter = require('../src/managers/publicationsRouter');

function getJson(path) {
  const app = express();
  app.use('/publications', publicationsRouter);
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

describe('GET /publications/stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            total: '10',
            pending: '1',
            processing: '0',
            published: '7',
            failed: '1',
            retrying: '1',
            total_retries: '2',
            published_today: '2',
            failed_today: '0',
            published_7d: '5',
            failed_7d: '1',
          },
        ],
      }),
    });
  });

  it('returns aggregate stats including 7-day windows', async () => {
    const { status, body } = await getJson('/publications/stats');
    expect(status).toBe(200);
    expect(body.published_7d).toBe(5);
    expect(body.failed_7d).toBe(1);
    expect(body.published_today).toBe(2);
  });
});
