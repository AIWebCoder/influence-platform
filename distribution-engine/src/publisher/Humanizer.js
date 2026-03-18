class Humanizer {
  /**
   * Pauses execution for a random duration between min and max milliseconds.
   * @param {number} min 
   * @param {number} max 
   */
  static async randomDelay(min = 1000, max = 3000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Simulates human typing by typing character by character with slight random delays.
   * @param {import('playwright').Page} page
   * @param {string} selector
   * @param {string} text
   */
  static async humanType(page, selector, text) {
    await page.waitForSelector(selector);
    await page.focus(selector);
    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 150) + 50 }); // 50-200ms per keystroke
    }
  }

  /**
   * Randomly scrolls the page mimicking human reading or browsing behavior.
   * @param {import('playwright').Page} page
   */
  static async humanScroll(page) {
    const scrolls = Math.floor(Math.random() * 4) + 2; // 2 to 5 scrolls
    for (let i = 0; i < scrolls; i++) {
      const scrollAmount = Math.floor(Math.random() * 400) + 100;
      await page.mouse.wheel(0, scrollAmount);
      await this.randomDelay(500, 1500);
    }
  }
}

module.exports = Humanizer;
