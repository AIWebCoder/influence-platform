const axios = require('axios');
const { getValidToken } = require('../../services/tokenService');
const { publishPipelineLog } = require('../../core/publishPipelineLog');
const ProxyHttpClient = require('../../persona/proxyHttpClient');
const PersonaService = require('../../persona/personaService');
const { recordProxyRequest } = require('../../persona/personaMetrics');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';
const CONTAINER_STATUS_FIELDS = 'id,status,status_code';
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

async function resolveHttpClient(accountId) {
  if (!ProxyHttpClient.USE_PERSONA_PROXY_FOR_GRAPH) {
    return axios;
  }
  try {
    return await ProxyHttpClient.getAxiosForAccount(accountId, { timeout: 30_000 });
  } catch (err) {
    if (err.code === 'PERSONA_PROXY_REQUIRED') throw err;
    publishPipelineLog('persona_proxy_fallback_direct', {
      account_id: accountId,
      reason: err.message,
    });
    return axios;
  }
}

/** @deprecated Instagram Graph API no longer accepts media_type=VIDEO — delegates to REELS. */
async function createFeedVideoContainer(args) {
  return createReelContainer(args);
}

async function createReelContainer({ igUserId, videoUrl, caption, accessToken, httpClient }) {
  const client = httpClient || axios;
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`;
  const params = new URLSearchParams();
  params.set('media_type', 'REELS');
  params.set('video_url', String(videoUrl));
  params.set('caption', caption);
  params.set('access_token', accessToken);

  const response = await client.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const containerId = response?.data?.id;
  if (!containerId) {
    throw new Error(`Instagram createReelContainer failed: missing container id (${JSON.stringify(response?.data || {})})`);
  }
  return containerId;
}

async function createImageContainer({ igUserId, imageUrl, caption, accessToken, httpClient }) {
  const client = httpClient || axios;
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`;
  const params = new URLSearchParams();
  params.set('image_url', String(imageUrl));
  params.set('caption', caption);
  params.set('access_token', accessToken);

  const response = await client.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const containerId = response?.data?.id;
  if (!containerId) {
    throw new Error(`Instagram createImageContainer failed: missing container id (${JSON.stringify(response?.data || {})})`);
  }
  return containerId;
}

/** @deprecated use createReelContainer */
async function createContainer(args) {
  return createReelContainer(args);
}

function isVideoAsset(asset) {
  const mime = String(asset?.mime_type || '').trim().toLowerCase();
  if (mime.startsWith('video/')) return true;
  const url = String(asset?.public_url || '').trim().toLowerCase().split('?')[0];
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(url);
}

function isPhotoPublish({ contentType, asset }) {
  if (isVideoAsset(asset)) return false;
  const ct = String(contentType || '').trim().toLowerCase();
  if (ct === 'post') return true;
  const mime = String(asset?.mime_type || '').trim().toLowerCase();
  return mime.startsWith('image/');
}

function resolvePublishKind({ contentType, asset }) {
  if (isPhotoPublish({ contentType, asset })) return 'photo';
  // Graph API error 2207067: media_type VIDEO is obsolete — all video assets publish as REELS.
  if (isVideoAsset(asset)) return 'reel';
  const ct = String(contentType || '').trim().toLowerCase();
  if (ct === 'reel') return 'reel';
  return 'feed_video';
}

async function waitForContainer({ containerId, accessToken, httpClient }) {
  const client = httpClient || axios;
  const statusUrl = `${GRAPH_BASE}/${encodeURIComponent(containerId)}`;
  let lastPayload = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await client.get(statusUrl, {
      params: { fields: CONTAINER_STATUS_FIELDS, access_token: accessToken },
      timeout: 20_000,
    });
    const data = response?.data && typeof response.data === 'object' ? response.data : {};
    lastPayload = Object.keys(data).length ? data : lastPayload;
    const statusCode = String(data.status_code || '').toUpperCase();
    const statusDetail = typeof data.status === 'string' ? data.status.trim() : null;

    if (statusCode === 'FINISHED') {
      return { status_detail: statusDetail, graph_response: data };
    }
    if (statusCode === 'ERROR') {
      publishPipelineLog('instagram_graph_container_status_error', {
        container_id: containerId,
        poll_attempt: attempt,
        max_poll_attempts: MAX_RETRIES,
        status_code: data.status_code ?? null,
        status_detail: statusDetail,
        graph_response: data,
      });
      const suffix = statusDetail ? `: ${statusDetail}` : '';
      throw new Error(`Instagram container processing failed for ${containerId}${suffix}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  const timeoutErr = new Error(`Instagram container timeout for ${containerId}`);
  timeoutErr.code = CONTAINER_TIMEOUT_SENTINEL;
  throw timeoutErr;
}

async function publishContainer({ igUserId, creationId, accessToken, httpClient }) {
  const client = httpClient || axios;
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish`;
  const params = new URLSearchParams();
  params.set('creation_id', creationId);
  params.set('access_token', accessToken);
  const response = await client.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const postId = response?.data?.id;
  if (!postId) {
    throw new Error(`Instagram publishContainer failed: missing post id (${JSON.stringify(response?.data || {})})`);
  }
  return postId;
}

async function publish({ platform, asset, caption, hashtags, accountId, igUserId, contentType }) {
  if (String(platform || '').toLowerCase() !== 'instagram') {
    return { success: false, error: `Unsupported platform: ${platform}` };
  }
  if (!accountId) return { success: false, error: 'Missing accountId' };
  if (!igUserId) return { success: false, error: 'Missing igUserId' };

  const mediaUrl = String(asset?.public_url || '').trim();
  if (!mediaUrl) return { success: false, error: 'Missing asset.public_url for Instagram publish' };

  const publishKind = resolvePublishKind({ contentType, asset });
  let currentStage = 'fetch_token';
  let containerId = null;
  const started = Date.now();
  const persona = await PersonaService.getPersonaForAccount(accountId);

  publishPipelineLog('instagram_adapter_start', {
    account_id: accountId,
    persona_id: persona?.id || null,
    ig_user_id: igUserId,
    persona_proxy_enabled: ProxyHttpClient.USE_PERSONA_PROXY_FOR_GRAPH,
    content_type: contentType || null,
    publish_kind: publishKind,
    media_url_preview: mediaUrl.length > 220 ? `${mediaUrl.slice(0, 220)}…` : mediaUrl,
  });

  try {
    const httpClient = await resolveHttpClient(accountId);
    const accessToken = await getValidToken(accountId);
    currentStage = 'create_container';
    const fullCaption = normalizeCaption(caption, hashtags);
    if (publishKind === 'photo') {
      containerId = await createImageContainer({
        igUserId,
        imageUrl: mediaUrl,
        caption: fullCaption,
        accessToken,
        httpClient,
      });
    } else if (publishKind === 'reel') {
      containerId = await createReelContainer({
        igUserId,
        videoUrl: mediaUrl,
        caption: fullCaption,
        accessToken,
        httpClient,
      });
    } else {
      containerId = await createFeedVideoContainer({
        igUserId,
        videoUrl: mediaUrl,
        caption: fullCaption,
        accessToken,
        httpClient,
      });
    }
    currentStage = 'wait_container';
    const containerReady = await waitForContainer({ containerId, accessToken, httpClient });
    currentStage = 'publish_container';
    const postId = await publishContainer({
      igUserId,
      creationId: containerId,
      accessToken,
      httpClient,
    });
    recordProxyRequest({
      personaId: persona?.id,
      platform: 'instagram',
      success: true,
      durationMs: Date.now() - started,
      stage: 'publish',
    });
    return {
      success: true,
      external_post_id: postId,
      external_post_url: `https://www.instagram.com/p/${encodeURIComponent(postId)}/`,
      container_id: containerId,
      stage: 'published',
      persona_id: persona?.id || null,
    };
  } catch (err) {
    recordProxyRequest({
      personaId: persona?.id,
      platform: 'instagram',
      success: false,
      durationMs: Date.now() - started,
      stage: currentStage,
    });
    const status = err?.response?.status;
    const data = err?.response?.data;
    const msg = data
      ? `Instagram API error: ${JSON.stringify(data)}`
      : (err?.message || String(err));
    publishPipelineLog('instagram_graph_error', {
      stage: currentStage,
      container_id: containerId,
      persona_id: persona?.id || null,
      http_status: status || null,
      message: err?.message || String(err),
      code: err?.code || null,
    });
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

module.exports = { publish, isPhotoPublish, isVideoAsset, resolvePublishKind };
