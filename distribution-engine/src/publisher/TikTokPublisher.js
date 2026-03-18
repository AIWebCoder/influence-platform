const Publisher = require('./Publisher');

class TikTokPublisher extends Publisher {
  constructor() {
    super('tiktok');
  }

  validateAccount(account) {
    return !!(account.username && account.password);
  }

  async publish(contentPacket, account) {
    // TODO: Implement TikTok publishing via Playwright or API
    // Placeholder for V2 — requires TikTok upload flow
    console.log(`[TikTok] Publishing for @${account.username}: "${contentPacket.caption?.substring(0, 50)}..."`);
    return {
      success: false,
      error: 'TikTok publishing not yet implemented — V2 placeholder',
    };
  }
}

module.exports = TikTokPublisher;
