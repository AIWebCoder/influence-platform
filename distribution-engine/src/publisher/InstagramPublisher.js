const Publisher = require('./Publisher');

class InstagramPublisher extends Publisher {
  constructor() {
    super('instagram');
  }

  validateAccount(account) {
    return !!(account.username && account.password);
  }

  async publish(contentPacket, account) {
    try {
      // Playwright-based Instagram publishing (existing logic)
      const { publishToInstagram } = require('../managers/PublishingManager');
      const result = await publishToInstagram(contentPacket, account);
      return {
        success: true,
        externalId: result?.postId || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = InstagramPublisher;
