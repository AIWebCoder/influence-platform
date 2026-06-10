const axios = require('axios');
const { getValidToken } = require('../services/tokenService');
const ProxyHttpClient = require('../persona/proxyHttpClient');
const { isEngagementDryRun } = require('./engagementMode');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';

async function resolveHttpClient(accountId) {
  if (!ProxyHttpClient.USE_PERSONA_PROXY_FOR_GRAPH) {
    return axios;
  }
  try {
    return await ProxyHttpClient.getAxiosForAccount(accountId, { timeout: 30_000 });
  } catch (err) {
    if (err.code === 'PERSONA_PROXY_REQUIRED') return axios;
    return axios;
  }
}

function formatGraphError(err) {
  if (err?.response?.data) {
    try {
      return JSON.stringify(err.response.data);
    } catch {
      return String(err.response.data);
    }
  }
  return err?.message || String(err);
}

function dryRunConversations(accountId) {
  const now = new Date().toISOString();
  return [
    {
      id: 'dry_run_conv_1',
      updated_time: now,
      participant_id: 'dry_run_user_1',
      participant_username: 'fan_user_1',
      preview: 'Hey! Love your latest reel 🔥',
      account_id: accountId,
      source: 'dry_run',
    },
    {
      id: 'dry_run_conv_2',
      updated_time: now,
      participant_id: 'dry_run_user_2',
      participant_username: 'collab_brand',
      preview: 'Would you be open to a partnership?',
      account_id: accountId,
      source: 'dry_run',
    },
  ];
}

function dryRunMessages(conversationId) {
  const now = new Date().toISOString();
  return [
    {
      id: 'dry_run_msg_1',
      text: conversationId === 'dry_run_conv_2' ? 'Would you be open to a partnership?' : 'Hey! Love your latest reel 🔥',
      from_id: 'dry_run_user_1',
      from_username: conversationId === 'dry_run_conv_2' ? 'collab_brand' : 'fan_user_1',
      is_from_account: false,
      created_time: now,
      conversation_id: conversationId,
    },
  ];
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
}

function participantList(conversation) {
  const participants = conversation?.participants?.data || conversation?.participants || [];
  return Array.isArray(participants) ? participants : [];
}

function latestMessageSnippet(conversation) {
  const batch = conversation?.messages?.data || conversation?.messages || [];
  const list = Array.isArray(batch) ? batch : [];
  return list[0] || null;
}

function isSelfParticipant(participant, identity) {
  if (!participant || !identity) return false;
  const pid = String(participant.id || '').trim();
  const puser = normalizeUsername(participant.username);
  const selfIds = new Set(
    [identity.igUserId, identity.graphId, identity.userId].filter(Boolean).map(String),
  );
  if (pid && selfIds.has(pid)) return true;
  if (identity.username && puser && puser === identity.username) return true;
  return false;
}

function mapParticipant(conversation, identity) {
  const list = participantList(conversation);
  const other = list.find((p) => !isSelfParticipant(p, identity));
  const latest = latestMessageSnippet(conversation);
  const messageFrom = latest?.from || null;

  let participantId = other?.id ? String(other.id) : null;
  let participantUsername = other?.username || null;

  // Prefer the sender from the latest message when it is not our account (IGSID for replies).
  if (messageFrom && !isSelfParticipant(messageFrom, identity)) {
    participantId = messageFrom.id ? String(messageFrom.id) : participantId;
    participantUsername = messageFrom.username || participantUsername;
  }

  if (!participantUsername && list.length > 1) {
    const fallback = list.find((p) => !isSelfParticipant(p, identity));
    participantId = fallback?.id ? String(fallback.id) : participantId;
    participantUsername = fallback?.username || participantUsername;
  }

  const preview =
    (latest?.message && String(latest.message).trim()) ||
    (latest?.text && String(latest.text).trim()) ||
    null;

  return {
    participant_id: participantId,
    participant_username: participantUsername,
    preview,
  };
}

async function fetchAccountIdentity(accountId, igUserId, accessToken, httpClient) {
  const identity = {
    igUserId: String(igUserId || '').trim(),
    graphId: null,
    userId: null,
    username: null,
  };
  if (!identity.igUserId) return identity;

  try {
    const response = await httpClient.get(
      `${GRAPH_BASE}/${encodeURIComponent(identity.igUserId)}`,
      {
        params: { fields: 'id,username,user_id', access_token: accessToken },
        timeout: 30_000,
      },
    );
    const data = response?.data || {};
    identity.graphId = data.id ? String(data.id) : null;
    identity.userId = data.user_id ? String(data.user_id) : null;
    identity.username = normalizeUsername(data.username);
  } catch (err) {
    console.warn(
      '[instagramDmService] could not resolve IG profile for account',
      accountId,
      err?.message || err,
    );
  }
  return identity;
}

async function listConversations({ pool, accountId, limit = 30 }) {
  const acc = await pool.query(
    `SELECT ig_user_id FROM accounts WHERE id = $1::uuid LIMIT 1`,
    [accountId],
  );
  if (acc.rowCount === 0) {
    const err = new Error('Account not found');
    err.statusCode = 404;
    throw err;
  }
  const igUserId = String(acc.rows[0].ig_user_id || '').trim();
  if (!igUserId) {
    const err = new Error('Account missing ig_user_id');
    err.statusCode = 400;
    throw err;
  }

  if (isEngagementDryRun()) {
    const conversations = dryRunConversations(accountId);
    return { conversations, dry_run: true, graph_error: null };
  }

  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/conversations`;

  try {
    const identity = await fetchAccountIdentity(accountId, igUserId, accessToken, httpClient);
    const response = await httpClient.get(url, {
      params: {
        platform: 'instagram',
        fields:
          'id,updated_time,participants{id,username},messages.limit(1){message,from{id,username}}',
        limit: Math.min(50, limit),
        access_token: accessToken,
      },
      timeout: 30_000,
    });
    const rows = Array.isArray(response?.data?.data) ? response.data.data : [];
    const conversations = rows.map((row) => {
      const participant = mapParticipant(row, identity);
      return {
        id: String(row.id),
        updated_time: row.updated_time || null,
        participant_id: participant.participant_id,
        participant_username: participant.participant_username,
        preview: participant.preview,
        account_id: accountId,
        source: 'instagram_graph',
      };
    });
    return { conversations, dry_run: false, graph_error: null };
  } catch (err) {
    const graphError = formatGraphError(err);
    const wrapped = new Error(graphError);
    wrapped.statusCode = err?.response?.status === 401 ? 401 : err?.response?.status === 403 ? 403 : 502;
    wrapped.graph_error = graphError;
    wrapped.hint =
      'DM inbox requires instagram_business_manage_messages on your token. Regenerate in Meta and update Accounts.';
    throw wrapped;
  }
}

async function listConversationMessages({ accountId, conversationId, igUserId, limit = 40 }) {
  if (isEngagementDryRun()) {
    return {
      messages: dryRunMessages(conversationId),
      dry_run: true,
      graph_error: null,
    };
  }

  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(conversationId)}`;

  try {
    const identity = await fetchAccountIdentity(accountId, igUserId, accessToken, httpClient);
    const response = await httpClient.get(url, {
      params: {
        fields: `messages{id,created_time,from{id,username},to,message}`,
        access_token: accessToken,
      },
      timeout: 30_000,
    });
    const batch = response?.data?.messages?.data || [];
    const messages = batch
      .map((msg) => ({
        id: String(msg.id),
        text: msg.message || '',
        from_id: msg.from?.id ? String(msg.from.id) : null,
        from_username: msg.from?.username || null,
        is_from_account: isSelfParticipant(msg.from, identity),
        created_time: msg.created_time || null,
        conversation_id: conversationId,
      }))
      .slice(0, limit)
      .reverse();

    return { messages, dry_run: false, graph_error: null };
  } catch (err) {
    const graphError = formatGraphError(err);
    const wrapped = new Error(graphError);
    wrapped.statusCode = err?.response?.status === 401 ? 401 : err?.response?.status === 403 ? 403 : 502;
    wrapped.graph_error = graphError;
    throw wrapped;
  }
}

module.exports = {
  listConversations,
  listConversationMessages,
  // exported for unit tests
  mapParticipant,
  isSelfParticipant,
  normalizeUsername,
  fetchAccountIdentity,
};
