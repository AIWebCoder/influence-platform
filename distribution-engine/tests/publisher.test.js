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
  const PACKET_ID = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLISH_DRY_RUN = 'false';
    process.env.PUBLISH_SKIP_RACE_RECHECK = 'true';
    setupDbQuery();
    jest.spyOn(PublishingWorker, 'findExistingPublished').mockResolvedValue(null);
    jest.spyOn(PublishingWorker, 'checkRateLimit').mockResolvedValue(true);
    jest.spyOn(PublishingWorker, 'checkMinInterval').mockResolvedValue({ allowed: true, waitMinutes: 0 });
    jest.spyOn(PublishingWorker, 'ensureContentPacketExists').mockResolvedValue(undefined);
    jest.spyOn(PublishingWorker, 'updateLastActivity').mockResolvedValue(undefined);
    jest.spyOn(Humanizer, 'getRandomDelay').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should publish packet if under rate limit', async () => {
    const logSpy = jest.spyOn(PublishingWorker, 'logPublication').mockResolvedValue();

    const mockPacket = {
      id: PACKET_ID,
      target_accounts: [ACCOUNT_ID],
      type: 'post',
      caption: 'Hello World',
    };

    await PublishingWorker.processPacket(mockPacket);

    expect(InstagramBot.publishContent).toHaveBeenCalledWith(ACCOUNT_ID, mockPacket);
    expect(logSpy).toHaveBeenCalledWith(ACCOUNT_ID, PACKET_ID, 'https://instagram.com/p/mocked1/');
  });

  it('should skip publishing if over rate limit', async () => {
    jest.spyOn(PublishingWorker, 'checkRateLimit').mockResolvedValue(false);

    const mockPacket = {
      id: PACKET_ID,
      target_accounts: [ACCOUNT_ID],
      type: 'post',
    };

    await PublishingWorker.processPacket(mockPacket);

    expect(InstagramBot.publishContent).not.toHaveBeenCalled();
  });

  it('should schedule retry with timestamp on transient failure', async () => {
    jest.spyOn(PublishingWorker, 'executeExternalPublish').mockRejectedValue(new Error('ETIMEDOUT'));
    jest.spyOn(PublishingWorker, 'getRetryCount').mockResolvedValue(1);
    const logAttemptSpy = jest.spyOn(PublishingWorker, 'logPublicationAttempt').mockResolvedValue(undefined);
    const requeueSpy = jest.spyOn(PublishingWorker, 'requeueWithDelay').mockResolvedValue(undefined);

    await PublishingWorker.processPacket({
      id: PACKET_ID,
      target_accounts: [ACCOUNT_ID],
      type: 'post',
    });

    expect(logAttemptSpy).toHaveBeenCalled();
    const call = logAttemptSpy.mock.calls.find((args) => args[4] === 'retrying');
    expect(call).toBeTruthy();
    expect(call[8]).toBeTruthy(); // nextRetryAt
    expect(requeueSpy).toHaveBeenCalled();
  });

  it('should mark permanently_failed when retries exhausted', async () => {
    jest.spyOn(PublishingWorker, 'executeExternalPublish').mockRejectedValue(new Error('ETIMEDOUT'));
    jest.spyOn(PublishingWorker, 'getRetryCount').mockResolvedValue(3);
    const logAttemptSpy = jest.spyOn(PublishingWorker, 'logPublicationAttempt').mockResolvedValue(undefined);

    await PublishingWorker.processPacket({
      id: PACKET_ID,
      target_accounts: [ACCOUNT_ID],
      type: 'post',
    });

    expect(logAttemptSpy).toHaveBeenCalledWith(
      ACCOUNT_ID,
      PACKET_ID,
      'post',
      null,
      'permanently_failed',
      'max_retries_exhausted',
      expect.any(String)
    );
  });

  it('should recover all publish processing queues', async () => {
    const redis = {
      scan: jest
        .fn()
        .mockResolvedValueOnce(['1', ['publish:processing:abc']])
        .mockResolvedValueOnce(['0', ['publish:processing:def']]),
      rpop: jest
        .fn()
        .mockResolvedValueOnce('msg-1')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('msg-2')
        .mockResolvedValueOnce(null),
      lpush: jest.fn().mockResolvedValue(1),
    };
    await PublishingWorker.recoverAllPublishProcessingQueues(redis);
    expect(redis.scan).toHaveBeenCalled();
    expect(redis.lpush).toHaveBeenCalledTimes(2);
    expect(redis.lpush).toHaveBeenNthCalledWith(1, 'publish:commands', 'msg-1');
    expect(redis.lpush).toHaveBeenNthCalledWith(2, 'publish:commands', 'msg-2');
  });
});
