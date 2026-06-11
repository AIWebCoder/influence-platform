const express = require('express');
const http = require('http');

jest.mock('../src/core/database', () => ({
  getPool: jest.fn(),
}));

const { getPool } = require('../src/core/database');
const campaignRouter = require('../src/managers/campaignRouter');

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const fleetScope = {
  isFleet: true,
  isViewer: false,
  organizationId: '00000000-0000-4000-8000-000000000001',
};

const scopedScope = {
  isFleet: false,
  isViewer: false,
  organizationId: '00000000-0000-4000-8000-000000000001',
  personaIds: [ACCOUNT_A],
};

function requestJson(method, path, body, scope = fleetScope) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.accessScope = scope;
    next();
  });
  app.use('/campaigns', campaignRouter);

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: `/campaigns${path}`,
          method,
          headers: body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function mockPool(handlers) {
  const connectClient = {
    query: jest.fn(async (sql, params) => {
      if (handlers.clientQuery) return handlers.clientQuery(sql, params);
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(async (sql, params) => {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [], rowCount: 0 };
    }),
    connect: jest.fn(async () => connectClient),
  };

  getPool.mockReturnValue(pool);
  return { pool, connectClient };
}

describe('campaignRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /campaigns rejects invalid payload', async () => {
    mockPool({});
    const { status, body } = await requestJson('POST', '/', { name: '', type: 'invalid' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid campaign payload/i);
  });

  it('POST /campaigns validates account access on create', async () => {
    mockPool({
      query: async (sql) => {
        if (sql.includes('SELECT id::text AS id FROM accounts')) {
          return { rows: [{ id: ACCOUNT_A }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const { status, body } = await requestJson('POST', '/', {
      name: 'Test',
      type: 'content',
      settings: { account_ids: [ACCOUNT_B], topic: 'x' },
    }, scopedScope);

    expect(status).toBe(403);
    expect(body.error).toMatch(/Access denied/i);
  });

  it('GET /campaigns scopes list to linked accounts', async () => {
    mockPool({
      query: async (sql) => {
        if (sql.includes('SELECT id::text AS id FROM accounts')) {
          return { rows: [{ id: ACCOUNT_A }], rowCount: 1 };
        }
        if (sql.includes('SELECT DISTINCT c.*')) {
          return {
            rows: [{ id: CAMPAIGN_ID, name: 'Scoped', status: 'active' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const { status, body } = await requestJson('GET', '/', null, scopedScope);
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(CAMPAIGN_ID);
  });

  it('GET /campaigns/:id returns 403 when out of scope', async () => {
    mockPool({
      query: async (sql) => {
        if (sql.includes('SELECT * FROM campaigns WHERE id')) {
          return {
            rows: [{
              id: CAMPAIGN_ID,
              name: 'Hidden',
              settings: { account_ids: [ACCOUNT_B] },
              target_account_id: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM campaign_accounts')) {
          return { rows: [{ account_id: ACCOUNT_B }], rowCount: 1 };
        }
        if (sql.includes('SELECT id::text AS id FROM accounts')) {
          return { rows: [{ id: ACCOUNT_A }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const { status, body } = await requestJson('GET', `/${CAMPAIGN_ID}`, null, scopedScope);
    expect(status).toBe(403);
    expect(body.error).toMatch(/Access denied/i);
  });

  it('PATCH /campaigns/:id rejects invalid status enum', async () => {
    mockPool({
      query: async (sql) => {
        if (sql.includes('SELECT * FROM campaigns WHERE id')) {
          return {
            rows: [{ id: CAMPAIGN_ID, settings: {}, target_account_id: ACCOUNT_A }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM campaign_accounts')) {
          return { rows: [{ account_id: ACCOUNT_A }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });

    const { status, body } = await requestJson(
      'PATCH',
      `/${CAMPAIGN_ID}`,
      { status: 'archived' },
      fleetScope,
    );
    expect(status).toBe(400);
    expect(body.allowed).toEqual(expect.arrayContaining(['active', 'paused', 'completed']));
  });
});
