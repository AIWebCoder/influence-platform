const axios = require('axios');
const { getValidToken } = require('../services/tokenService');
const ProxyHttpClient = require('../persona/proxyHttpClient');
const { isEngagementDryRun, isCommentLikeSimulate, dryRunEngagementResult } = require('./engagementMode');
const { likeCommentViaDevice, isDeviceLikeEnabled } = require('./deviceEngagementClient');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';

async function resolveHttpClient(accountId) {
  if (!ProxyHttpClient.USE_PERSONA_PROXY_FOR_GRAPH) {
    return axios;
  }
  try {
    return await ProxyHttpClient.getAxiosForAccount(accountId, { timeout: 30_000 });
  } catch (err) {
    if (err.code === 'PERSONA_PROXY_REQUIRED') {
      return axios;
    }
    return axios;
  }
}

/**
 * Reply to a comment on owned media via Instagram Graph API.
 * @see https://developers.facebook.com/docs/instagram-api/reference/ig-comment/replies
 */
async function replyToComment({ accountId, commentId, message }) {
  if (isEngagementDryRun()) {
    return {
      success: true,
      external_result_id: dryRunEngagementResult('comment_reply', commentId),
      stage: 'dry_run',
    };
  }
  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(commentId)}/replies`;
  const params = new URLSearchParams();
  params.set('message', String(message || '').trim());
  params.set('access_token', accessToken);
  const response = await httpClient.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000,
  });
  const replyId = response?.data?.id;
  if (!replyId) {
    return {
      success: false,
      error: `Instagram reply failed: ${JSON.stringify(response?.data || {})}`,
      stage: 'comment_reply',
    };
  }
  return { success: true, external_result_id: String(replyId), stage: 'comment_reply' };
}

/**
 * Send a DM via Instagram Messaging API (recipient = Instagram-scoped user id).
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
 */
async function sendDirectMessage({ accountId, igUserId, recipientId, message }) {
  if (isEngagementDryRun()) {
    return {
      success: true,
      external_result_id: dryRunEngagementResult('dm_send', recipientId),
      stage: 'dry_run',
    };
  }
  if (!igUserId) {
    return { success: false, error: 'Missing ig_user_id for dm_send', stage: 'dm_send' };
  }
  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/messages`;
  const body = {
    recipient: { id: String(recipientId) },
    message: { text: String(message || '').trim() },
  };
  const response = await httpClient.post(url, body, {
    params: { access_token: accessToken },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  });
  const messageId = response?.data?.message_id || response?.data?.id;
  if (!messageId) {
    return {
      success: false,
      error: `Instagram DM failed: ${JSON.stringify(response?.data || {})}`,
      stage: 'dm_send',
    };
  }
  return { success: true, external_result_id: String(messageId), stage: 'dm_send' };
}

/**
 * Like on a comment — not exposed in Instagram Graph API for third-party apps.
 * Records a simulated success in dry-run; in real mode returns a clear limitation error
 * unless ENGAGEMENT_ALLOW_COMMENT_LIKE_STUB=true (logs only, for internal testing).
 */
async function likeComment({
  accountId,
  commentId,
  parentTargetId = null,
  targetUsername = null,
  commentTextHint = null,
}) {
  if (isEngagementDryRun()) {
    return {
      success: true,
      external_result_id: dryRunEngagementResult('comment_like', commentId),
      stage: 'dry_run',
      note: 'comment_like simulated (Graph API does not support liking comments)',
    };
  }

  if (isDeviceLikeEnabled()) {
    const deviceResult = await likeCommentViaDevice({
      accountId,
      commentId,
      parentTargetId,
      targetUsername,
      commentTextHint,
    });
    if (deviceResult.success) {
      return deviceResult;
    }
    return deviceResult;
  }

  if (isCommentLikeSimulate()) {
    console.log(
      JSON.stringify({
        level: 'warn',
        service: 'distribution-engine',
        component: 'instagramEngagementAdapter',
        event: 'comment_like_simulated',
        account_id: accountId,
        comment_id: commentId,
      })
    );
    return {
      success: true,
      external_result_id: `local_like_${String(commentId).slice(0, 32)}`,
      stage: 'comment_like_simulated',
      note:
        'Recorded in platform history only — Instagram Graph API cannot like comments (no emulator used).',
    };
  }
  return {
    success: false,
    error:
      'comment_like is not supported via Instagram Graph API. Set ENGAGEMENT_COMMENT_LIKE_SIMULATE=true for local tracking, ENGAGEMENT_COMMENT_LIKE_VIA_DEVICE=true with an emulator for real likes, or ENGAGEMENT_DRY_RUN=true for full simulation.',
    stage: 'comment_like_unsupported',
    safe_to_retry: false,
  };
}

async function executeEngagement(payload) {
  const { action_type: actionType, account_id: accountId, ig_user_id: igUserId } = payload;
  const targetId = String(payload.target_id || '').trim();
  const messageText = payload.message_text;

  if (!accountId || !actionType || !targetId) {
    return { success: false, error: 'Missing account_id, action_type, or target_id' };
  }

  try {
    if (actionType === 'comment_reply') {
      return await replyToComment({
        accountId,
        commentId: targetId,
        message: messageText,
      });
    }
    if (actionType === 'dm_send') {
      return await sendDirectMessage({
        accountId,
        igUserId,
        recipientId: targetId,
        message: messageText,
      });
    }
    if (actionType === 'comment_like') {
      return await likeComment({
        accountId,
        commentId: targetId,
        parentTargetId: payload.parent_target_id || null,
        targetUsername: payload.target_username || null,
        commentTextHint: payload.message_text || null,
      });
    }
    return { success: false, error: `Unsupported action_type: ${actionType}` };
  } catch (err) {
    const data = err?.response?.data;
    const msg = data
      ? `Instagram engagement API error: ${JSON.stringify(data)}`
      : (err?.message || String(err));
    return {
      success: false,
      error: msg,
      http_status: err?.response?.status || null,
      safe_to_retry: !(err?.response?.status && err.response.status < 500),
    };
  }
}

module.exports = {
  executeEngagement,
  replyToComment,
  sendDirectMessage,
  likeComment,
};
