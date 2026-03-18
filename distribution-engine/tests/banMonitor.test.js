const mockQuery = jest.fn();

jest.mock('../src/core/database', () => ({
  getPool: () => ({
    query: mockQuery
  })
}));

const BanMonitor = require('../src/health/BanMonitor');
const AccountService = require('../src/managers/AccountService');

jest.mock('../src/managers/AccountService', () => ({
  updateAccountHealth: jest.fn().mockResolvedValue()
}));

describe('BanMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should sideline account and save alert', async () => {
    mockQuery.mockResolvedValue();

    await BanMonitor.recordAlert('account-1', 'ban', 'Action Blocked');

    expect(AccountService.updateAccountHealth).toHaveBeenCalledWith('account-1', -100, 'banned');
    expect(mockQuery).toHaveBeenCalled();
  });

  it('should find a backup account', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'backup-account-2' }]
    });

    const backupId = await BanMonitor.getBackupAccount('account-1');

    expect(backupId).toBe('backup-account-2');
    expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id FROM accounts WHERE status = 'active' AND id != $1 LIMIT 1"),
        ['account-1']
    );
  });
});
