const { isPhotoPublish } = require('../src/publisher/adapters/platformAdapter');

describe('platformAdapter.isPhotoPublish', () => {
  it('routes post content_type to photo publish', () => {
    expect(isPhotoPublish({ contentType: 'post', asset: { mime_type: 'video/mp4' } })).toBe(true);
  });

  it('routes image mime to photo publish', () => {
    expect(isPhotoPublish({ contentType: 'reel', asset: { mime_type: 'image/jpeg' } })).toBe(true);
  });

  it('routes reel video to video publish', () => {
    expect(isPhotoPublish({ contentType: 'reel', asset: { mime_type: 'video/mp4' } })).toBe(false);
  });
});
