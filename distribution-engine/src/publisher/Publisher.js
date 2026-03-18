/**
 * Abstract Publisher base class.
 * Each platform-specific publisher must implement the `publish` method.
 */
class Publisher {
  constructor(name) {
    if (new.target === Publisher) {
      throw new Error('Cannot instantiate abstract Publisher directly');
    }
    this.name = name;
  }

  /**
   * Publish a content packet to this platform.
   * @param {object} contentPacket - The content to publish
   * @param {object} account - The account credentials/config
   * @returns {Promise<{success: boolean, externalId?: string, error?: string}>}
   */
  async publish(contentPacket, account) {
    throw new Error('publish() must be implemented by subclass');
  }

  /**
   * Validate that an account has the required fields for this platform.
   * @param {object} account
   * @returns {boolean}
   */
  validateAccount(account) {
    throw new Error('validateAccount() must be implemented by subclass');
  }
}

module.exports = Publisher;
