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
      const PublishingWorker = require('./PublishingWorker');
      const accountId = account.id || account.account_id;
      const type = contentPacket.type || 'post';
      const postUrl = await PublishingWorker.executeExternalPublish(accountId, contentPacket, type);
      return {
        success: true,
        externalId: postUrl,
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
