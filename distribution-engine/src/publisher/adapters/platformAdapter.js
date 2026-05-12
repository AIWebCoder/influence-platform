const axios = require('axios');
const { getValidToken } = require('../../services/tokenService');
const { publishPipelineLog } = require('../../core/publishPipelineLog');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';
/** IG container status poll: `status` holds human-readable processing detail (incl. error codes when ERROR). */
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

/**
 * Polls GET /{container_id} until FINISHED, ERROR, or max attempts.
 * @returns {{ status_detail: string | null, graph_response: object }}
 */
async function waitForContainer({ containerId, accessToken }) {
  const statusUrl = `${GRAPH_BASE}/${encodeURIComponent(containerId)}`;
  let lastPayload = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await axios.get(statusUrl, {
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
  publishPipelineLog('instagram_graph_container_status_timeout', {
    container_id: containerId,
    poll_attempts: MAX_RETRIES,
    poll_interval_ms: POLL_INTERVAL_MS,
    last_graph_response: lastPayload,
  });
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

  publishPipelineLog('instagram_adapter_start', {
    account_id: accountId,
    ig_user_id: igUserId,
    mime_type: asset?.mime_type || null,
    video_url_preview: videoUrl.length > 220 ? `${videoUrl.slice(0, 220)}…` : videoUrl,
    caption_len: String(caption || '').length,
    hashtag_count: Array.isArray(hashtags) ? hashtags.length : 0,
    graph_request: {
      endpoint: 'POST /{ig_user_id}/media',
      media_type: 'REELS',
      video_url_set: Boolean(videoUrl),
    },
  });

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
    publishPipelineLog('instagram_graph_create_container_response', {
      ig_user_id: igUserId,
      container_id: containerId,
      response_summary: { id: containerId },
    });
    currentStage = 'wait_container';
    const containerReady = await waitForContainer({ containerId, accessToken });
    publishPipelineLog('instagram_graph_container_status', {
      container_id: containerId,
      status_code: 'FINISHED',
      status_detail: containerReady?.status_detail || null,
    });
    currentStage = 'publish_container';
    const postId = await publishContainer({
      igUserId,
      creationId: containerId,
      accessToken,
    });
    publishPipelineLog('instagram_graph_media_publish_response', {
      ig_user_id: igUserId,
      creation_id: containerId,
      response_summary: { id: postId },
    });
    return {
      success: true,
      external_post_id: postId,
      external_post_url: `https://www.instagram.com/p/${encodeURIComponent(postId)}/`,
      container_id: containerId,
      stage: 'published',
    };
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const msg = data
      ? `Instagram API error: ${JSON.stringify(data)}`
      : (err?.message || String(err));
    publishPipelineLog('instagram_graph_error', {
      stage: currentStage,
      container_id: containerId,
      http_status: status || null,
      error_body: data || null,
      message: err?.message || String(err),
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

module.exports = { publish };
