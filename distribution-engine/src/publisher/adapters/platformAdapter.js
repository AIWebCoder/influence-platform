const axios = require('axios');
const { getValidToken } = require('../../services/tokenService');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';
const POLL_INTERVAL_MS = 10_000;
const MAX_RETRIES = 20;
const CONTAINER_TIMEOUT_SENTINEL = 'INSTAGRAM_CONTAINER_TIMEOUT';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCaption(caption, hashtags) {
  const base = String(caption || '').trim();
  const tags = Array.isArray(hashtags)
    ? hashtags.filter((h) => typeof h === 'string' && h.trim()).map((h) => h.trim())
    : [];
  if (!tags.length) return base;
  return [base, tags.join(' ')].filter(Boolean).join('\n\n');
}

async function createContainer({ igUserId, videoUrl, caption, accessToken }) {
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`;
  const params = new URLSearchParams();
  params.set('media_type', 'REELS');
  params.set('video_url', String(videoUrl));
  params.set('caption', caption);
  params.set('access_token', accessToken);

  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const containerId = response?.data?.id;
  if (!containerId) {
    throw new Error(`Instagram createContainer failed: missing container id (${JSON.stringify(response?.data || {})})`);
  }
  return containerId;
}

async function waitForContainer({ containerId, accessToken }) {
  const statusUrl = `${GRAPH_BASE}/${encodeURIComponent(containerId)}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await axios.get(statusUrl, {
      params: { fields: 'status_code', access_token: accessToken },
      timeout: 20_000,
    });
    const statusCode = String(response?.data?.status_code || '').toUpperCase();
    if (statusCode === 'FINISHED') return;
    if (statusCode === 'ERROR') {
      throw new Error(`Instagram container processing failed for ${containerId}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const timeoutErr = new Error(`Instagram container timeout for ${containerId}`);
  timeoutErr.code = CONTAINER_TIMEOUT_SENTINEL;
  throw timeoutErr;
}

async function publishContainer({ igUserId, creationId, accessToken }) {
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish`;
  const params = new URLSearchParams();
  params.set('creation_id', creationId);
  params.set('access_token', accessToken);
  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const postId = response?.data?.id;
  if (!postId) {
    throw new Error(`Instagram publishContainer failed: missing post id (${JSON.stringify(response?.data || {})})`);
  }
  return postId;
}

async function publish({ platform, asset, caption, hashtags, accountId, igUserId }) {
  if (String(platform || '').toLowerCase() !== 'instagram') {
    return { success: false, error: `Unsupported platform: ${platform}` };
  }
  if (!accountId) return { success: false, error: 'Missing accountId' };
  if (!igUserId) return { success: false, error: 'Missing igUserId' };

  const videoUrl = String(asset?.public_url || '').trim();
  if (!videoUrl) return { success: false, error: 'Missing asset.public_url for Instagram publish' };

  let currentStage = 'fetch_token';
  let containerId = null;

  try {
    const accessToken = await getValidToken(accountId);
    currentStage = 'create_container';
    const fullCaption = normalizeCaption(caption, hashtags);
    containerId = await createContainer({
      igUserId,
      videoUrl,
      caption: fullCaption,
      accessToken,
    });
    currentStage = 'wait_container';
    await waitForContainer({ containerId, accessToken });
    currentStage = 'publish_container';
    const postId = await publishContainer({
      igUserId,
      creationId: containerId,
      accessToken,
    });
    return {
      success: true,
      external_post_id: postId,
      external_post_url: `https://www.instagram.com/p/${encodeURIComponent(postId)}/`,
      container_id: containerId,
      stage: 'published',
    };
  } catch (err) {
    const msg = err?.response?.data
      ? `Instagram API error: ${JSON.stringify(err.response.data)}`
      : (err?.message || String(err));
    const unsafeToRetry =
      currentStage === 'wait_container' ||
      currentStage === 'publish_container' ||
      err?.code === CONTAINER_TIMEOUT_SENTINEL;
    return {
      success: false,
      error: msg,
      stage: currentStage,
      container_id: containerId,
      safe_to_retry: !unsafeToRetry,
    };
  }
}

module.exports = { publish };
