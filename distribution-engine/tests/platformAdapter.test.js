const { isPhotoPublish, isVideoAsset, resolvePublishKind } = require('../src/publisher/adapters/platformAdapter');

describe('platformAdapter.isVideoAsset', () => {
  it('detects video mime types', () => {
    expect(isVideoAsset({ mime_type: 'video/mp4', public_url: 'https://cdn.example/x' })).toBe(true);
  });

  it('detects video file extensions when mime is generic', () => {
    expect(
      isVideoAsset({
        mime_type: 'application/octet-stream',
        public_url: 'https://cdn.example/clip.mp4',
      }),
    ).toBe(true);
  });

  it('does not treat images as video', () => {
    expect(isVideoAsset({ mime_type: 'image/png', public_url: 'https://cdn.example/x.png' })).toBe(false);
  });
});

describe('platformAdapter.isPhotoPublish', () => {
  it('routes post + video asset to video publish (not photo)', () => {
    expect(isPhotoPublish({ contentType: 'post', asset: { mime_type: 'video/mp4' } })).toBe(false);
  });

  it('routes post + image asset to photo publish', () => {
    expect(isPhotoPublish({ contentType: 'post', asset: { mime_type: 'image/jpeg' } })).toBe(true);
  });

  it('routes image mime to photo publish even when content_type is reel', () => {
    expect(isPhotoPublish({ contentType: 'reel', asset: { mime_type: 'image/jpeg' } })).toBe(true);
  });

  it('routes reel + video to video publish', () => {
    expect(isPhotoPublish({ contentType: 'reel', asset: { mime_type: 'video/mp4' } })).toBe(false);
  });
});

describe('platformAdapter.resolvePublishKind', () => {
  it('uses feed video for post + mp4', () => {
    expect(
      resolvePublishKind({
        contentType: 'post',
        asset: { mime_type: 'video/mp4', public_url: 'https://cdn.example/a.mp4' },
      }),
    ).toBe('feed_video');
  });

  it('uses reel for reel + mp4', () => {
    expect(
      resolvePublishKind({
        contentType: 'reel',
        asset: { mime_type: 'video/mp4', public_url: 'https://cdn.example/a.mp4' },
      }),
    ).toBe('reel');
  });

  it('uses photo for post + image', () => {
    expect(
      resolvePublishKind({
        contentType: 'post',
        asset: { mime_type: 'image/jpeg', public_url: 'https://cdn.example/a.jpg' },
      }),
    ).toBe('photo');
  });
});
