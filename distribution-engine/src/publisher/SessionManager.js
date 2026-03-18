const { chromium } = require('playwright-extra');
const { getStealthPlugin } = require('./StealthConfig');
const ProxyManager = require('../proxy/ProxyManager');

// Load the stealth plugin
chromium.use(getStealthPlugin());

class SessionManager {
  constructor() {
    this.activeSessions = new Map(); // AccountID -> BrowserContext
  }

  async initializeSession(accountId) {
    if (this.activeSessions.has(accountId)) {
      return this.activeSessions.get(accountId);
    }

    try {
      const proxyId = await ProxyManager.getProxyForAccount(accountId);
      
      // Configuration for Playwright
      const launchOptions = {
        headless: true, // run invisibly for now
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      };

      const browser = await chromium.launch(launchOptions);
      
      // Create an isolated context per account
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 }, // Mobile viewport
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris', // Typical for French accounts
        // We can pass storageState to persist cookies/sessions
        // storageState: `./sessions/${accountId}.json`
      });

      this.activeSessions.set(accountId, context);
      console.log(`✅ Session initialized for account: ${accountId}`);
      
      return context;
    } catch (error) {
      console.error(`❌ Failed to init session for ${accountId}:`, error);
      throw error;
    }
  }

  async closeSession(accountId) {
    if (this.activeSessions.has(accountId)) {
      const context = this.activeSessions.get(accountId);
      await context.close();
      this.activeSessions.delete(accountId);
      console.log(`🛑 Session closed for account: ${accountId}`);
    }
  }
}

module.exports = new SessionManager();
