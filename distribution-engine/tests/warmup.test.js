const mockQuery = jest.fn();

jest.mock('../src/core/database', () => ({
  getPool: () => ({
    query: mockQuery
  })
}));

const WarmupManager = require('../src/managers/WarmupManager');

describe('WarmupManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 0 if account is banned', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ created_at: new Date(), health_score: 100, status: 'banned' }]
    });
    
    const limit = await WarmupManager.calculateDailyLimit('acc1');
    expect(limit).toBe(0);
  });

  it('should calculate limit based on age (new account)', async () => {
    // 2 days old
    const date = new Date();
    date.setDate(date.getDate() - 2);

    mockQuery.mockResolvedValue({
      rows: [{ created_at: date, health_score: 100, status: 'active' }]
    });

    const limit = await WarmupManager.calculateDailyLimit('acc2');
    expect(limit).toBe(1);
  });

  it('should calculate limit based on age (mature account)', async () => {
    // 30 days old
    const date = new Date();
    date.setDate(date.getDate() - 30);

    mockQuery.mockResolvedValue({
      rows: [{ created_at: date, health_score: 100, status: 'active' }]
    });

    const limit = await WarmupManager.calculateDailyLimit('acc3');
    expect(limit).toBe(5);
  });

  it('should reduce limit if health score is low', async () => {
    // 30 days old, but health is 40%
    const date = new Date();
    date.setDate(date.getDate() - 30);

    mockQuery.mockResolvedValue({
      rows: [{ created_at: date, health_score: 40, status: 'active' }]
    });

    const limit = await WarmupManager.calculateDailyLimit('acc4');
    expect(limit).toBe(2); // 5 * 0.4 = 2
  });
});
