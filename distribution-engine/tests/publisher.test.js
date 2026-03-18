const PublishingWorker = require('../src/publisher/PublishingWorker');
const InstagramBot = require('../src/publisher/InstagramBot');

// Mock dependencies
jest.mock('../src/core/database', () => ({
  getPool: () => ({
    query: jest.fn().mockResolvedValue({ rows: [{ count: '2' }] }) // Under limit
  })
}));

jest.mock('../src/publisher/InstagramBot', () => ({
  publishContent: jest.fn().mockResolvedValue('https://instagram.com/p/mocked1/')
}));

describe('PublishingWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should publish packet if under rate limit', async () => {
    // Spy on internal methods
    const logSpy = jest.spyOn(PublishingWorker, 'logPublication').mockResolvedValue();

    const mockPacket = {
      id: 'packet-1',
      target_accounts: ['account-A'],
      type: 'post',
      caption: 'Hello World'
    };

    await PublishingWorker.processPacket(mockPacket);

    expect(InstagramBot.publishContent).toHaveBeenCalledWith('account-A', mockPacket);
    expect(logSpy).toHaveBeenCalledWith('account-A', 'packet-1', 'post', 'https://instagram.com/p/mocked1/');
  });

  it('should skip publishing if over rate limit', async () => {
    // Override the DB mock for just this test instance to simulate limit reached
    PublishingWorker.checkRateLimit = jest.fn().mockResolvedValue(false);
    
    const mockPacket = {
      id: 'packet-2',
      target_accounts: ['account-B'],
      type: 'post'
    };

    await PublishingWorker.processPacket(mockPacket);
    
    expect(InstagramBot.publishContent).not.toHaveBeenCalled();
  });
});
