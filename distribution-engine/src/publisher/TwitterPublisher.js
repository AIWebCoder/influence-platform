const Publisher = require('./Publisher');

class TwitterPublisher extends Publisher {
  constructor() {
    super('twitter');
  }

  validateAccount(account) {
    // Twitter/X API requires API keys, not username/password
    return !!(account.api_key && account.api_secret);
  }

  async publish(contentPacket, account) {
    // TODO: Implement Twitter/X publishing via API v2
    // Placeholder for V2 — requires Twitter API v2 OAuth
    console.log(`[Twitter/X] Publishing: "${contentPacket.caption?.substring(0, 50)}..."`);
    return {
      success: false,
      error: 'Twitter/X publishing not yet implemented — V2 placeholder',
    };
  }
}

module.exports = TwitterPublisher;
