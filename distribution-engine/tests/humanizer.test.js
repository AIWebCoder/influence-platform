const Humanizer = require('../src/publisher/Humanizer');

describe('Humanizer Utility', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('randomDelay should resolve after a delay', async () => {
    const promise = Humanizer.randomDelay(100, 200);
    // Fast forward until all timers have been executed
    jest.runAllTimers();
    await expect(promise).resolves.toBeUndefined();
  });

  it('humanType should type with delays', async () => {
    // Mock page with minimal interface needed
    const mockPage = {
      waitForSelector: jest.fn().mockResolvedValue(),
      focus: jest.fn().mockResolvedValue(),
      keyboard: {
        type: jest.fn().mockResolvedValue()
      }
    };

    const text = "hello";
    const typePromise = Humanizer.humanType(mockPage, '#input', text);
    
    // Fast forward through async delays
    for(let i=0; i < text.length * 2; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(250);
    }

    await typePromise;
    expect(mockPage.waitForSelector).toHaveBeenCalledWith('#input');
    expect(mockPage.focus).toHaveBeenCalledWith('#input');
    expect(mockPage.keyboard.type).toHaveBeenCalledTimes(text.length);
  });
});
