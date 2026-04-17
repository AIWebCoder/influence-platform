const { getPool } = require('../src/core/database');
const PublishingWorker = require('../src/publisher/PublishingWorker');
const InstagramBot = require('../src/publisher/InstagramBot');
const Humanizer = require('../src/utils/humanizer');

jest.mock('../src/core/database', () => ({
  getPool: jest.fn(),
}));

jest.mock('../src/middleware/safetyGuard', () => ({
  preActionValidation: jest.fn().mockResolvedValue({ allowed: true }),
  postActionProcessing: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/core/redis', () => ({
  pushDelayed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/publisher/InstagramBot', () => ({
  publishContent: jest.fn().mockResolvedValue('https://instagram.com/p/mocked1/'),
}));

function setupDbQuery() {
  const mockQuery = jest.fn((sql) => {
    const s = String(sql);
    if (s.includes('count(*)') && s.includes('published_at >= CURRENT_DATE')) {
      return Promise.resolve({ rows: [{ count: '0' }] });
    }
    if (s.includes('FROM accounts WHERE id = $1') && s.includes('created_at')) {
      return Promise.resolve({
        rows: [{ created_at: new Date().toISOString(), health_score: 100, status: 'active' }],
      });
    }
    if (s.includes('MAX(retry_count)')) {
      return Promise.resolve({ rows: [{ retry_count: '0' }] });
    }
    return Promise.resolve({ rows: [] });
  });
  getPool.mockReturnValue({ query: mockQuery });
  return mockQuery;
}

describe('PublishingWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLISH_DRY_RUN = 'false';
    process.env.PUBLISH_SKIP_RACE_RECHECK = 'true';
    setupDbQuery();
    jest.spyOn(PublishingWorker, 'findExistingPublished').mockResolvedValue(null);
    jest.spyOn(Humanizer, 'getRandomDelay').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should publish packet if under rate limit', async () => {
    const logSpy = jest.spyOn(PublishingWorker, 'logPublication').mockResolvedValue();

    const mockPacket = {
      id: 'packet-1',
      target_accounts: ['account-A'],
      type: 'post',
      caption: 'Hello World',
    };

    await PublishingWorker.processPacket(mockPacket);

    expect(InstagramBot.publishContent).toHaveBeenCalledWith('account-A', mockPacket);
    expect(logSpy).toHaveBeenCalledWith('account-A', 'packet-1', 'https://instagram.com/p/mocked1/');
  });

  it('should skip publishing if over rate limit', async () => {
    jest.spyOn(PublishingWorker, 'checkRateLimit').mockResolvedValue(false);

    const mockPacket = {
      id: 'packet-2',
      target_accounts: ['account-B'],
      type: 'post',
    };

    await PublishingWorker.processPacket(mockPacket);

    expect(InstagramBot.publishContent).not.toHaveBeenCalled();
  });
});
