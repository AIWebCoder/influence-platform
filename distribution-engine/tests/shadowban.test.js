const ShadowbanMonitor = require('../src/health/ShadowbanMonitor');
const AccountService = require('../src/managers/AccountService');

jest.mock('../src/managers/AccountService', () => ({
  updateAccountHealth: jest.fn().mockResolvedValue()
}));

jest.mock('../src/core/database', () => ({
  getPool: () => ({ query: jest.fn().mockResolvedValue({ rows: [] }) })
}));

describe('ShadowbanMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should randomly detect shadowban and update account', async () => {
    // Mock Math.random to always be less than 0.05
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    
    const detected = await ShadowbanMonitor.analyzeEngagement('acc1');
    
    expect(detected).toBe(true);
    expect(AccountService.updateAccountHealth).toHaveBeenCalledWith('acc1', -30, 'shadowbanned');
    
    jest.spyOn(Math, 'random').mockRestore();
  });

  it('should not detect shadowban if probability check fails', async () => {
    // Mock Math.random to always be greater than 0.05
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
    
    const detected = await ShadowbanMonitor.analyzeEngagement('acc2');
    
    expect(detected).toBe(false);
    expect(AccountService.updateAccountHealth).not.toHaveBeenCalled();
    
    jest.spyOn(Math, 'random').mockRestore();
  });
});
