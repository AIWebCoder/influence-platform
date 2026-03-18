const InstagramPublisher = require('./InstagramPublisher');
const TikTokPublisher = require('./TikTokPublisher');
const TwitterPublisher = require('./TwitterPublisher');

const publishers = {
  instagram: new InstagramPublisher(),
  tiktok: new TikTokPublisher(),
  twitter: new TwitterPublisher(),
};

/**
 * Get the appropriate publisher for a given platform.
 * @param {string} platform - 'instagram', 'tiktok', or 'twitter'
 * @returns {Publisher}
 */
function getPublisher(platform) {
  const publisher = publishers[platform];
  if (!publisher) {
    throw new Error(`Unsupported platform: ${platform}. Supported: ${Object.keys(publishers).join(', ')}`);
  }
  return publisher;
}

module.exports = { getPublisher, publishers };
