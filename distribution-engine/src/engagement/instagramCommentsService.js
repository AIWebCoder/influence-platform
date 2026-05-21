const axios = require('axios');
const { getValidToken } = require('../services/tokenService');
const ProxyHttpClient = require('../persona/proxyHttpClient');
const { isEngagementDryRun } = require('./engagementMode');

const GRAPH_BASE = 'https://graph.instagram.com/v25.0';
const COMMENT_FIELDS = 'id,text,timestamp,from{id,username},like_count';
const MEDIA_FIELDS = 'id,caption,media_type,timestamp,permalink,comments_count';

function normalizeCaptionText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function captionsMatch(a, b) {
  const left = normalizeCaptionText(a);
  const right = normalizeCaptionText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const probe = Math.min(40, left.length, right.length);
  if (probe < 8) return false;
  const sliceLeft = left.slice(0, probe);
  const sliceRight = right.slice(0, probe);
  return left.includes(right) || right.includes(left) || sliceLeft === sliceRight;
}

function isLikelyIgMediaId(id) {
  return /^\d{11,20}$/.test(String(id || '').trim());
}

function isUnusableStoredMediaId(id) {
  const value = String(id || '').trim();
  if (!value) return true;
  if (/dry[-_]?run|invalid|localhost|example\.com/i.test(value)) return true;
  if (!isLikelyIgMediaId(value)) return true;
  return false;
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

async function resolveHttpClient(accountId) {
  if (!ProxyHttpClient.USE_PERSONA_PROXY_FOR_GRAPH) {
    return axios;
  }
  try {
    return await ProxyHttpClient.getAxiosForAccount(accountId, { timeout: 30_000 });
  } catch (err) {
    if (err.code === 'PERSONA_PROXY_REQUIRED') {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'distribution-engine',
          component: 'instagramCommentsService',
          event: 'persona_proxy_fallback_direct',
          account_id: accountId,
          reason: err.message,
        })
      );
      return axios;
    }
    return axios;
  }
}

function dryRunPosts(accountId) {
  return [
    {
      media_id: 'dry_run_media_1',
      caption: '[DRY RUN] Sample reel caption',
      permalink: 'https://www.instagram.com/p/dry_run_1/',
      published_at: new Date().toISOString(),
      source: 'dry_run',
      account_id: accountId,
      comments_count: 2,
    },
  ];
}

function dryRunComments(mediaId) {
  return [
    {
      id: 'dry_run_comment_1',
      text: 'Love this content!',
      username: 'fan_user_1',
      timestamp: new Date().toISOString(),
      like_count: 3,
      media_id: mediaId,
    },
    {
      id: 'dry_run_comment_2',
      text: 'Where can I learn more?',
      username: 'fan_user_2',
      timestamp: new Date().toISOString(),
      like_count: 0,
      media_id: mediaId,
    },
  ];
}

async function listPublishedPostsFromDb(pool, accountId, limit) {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (COALESCE(pt.external_post_id, p.instagram_post_id))
      COALESCE(pt.external_post_id, p.instagram_post_id) AS media_id,
      COALESCE(pt.external_post_url,
        CASE
          WHEN p.instagram_post_id ~ '^[0-9]+$'
            THEN 'https://www.instagram.com/' || a.username || '/'
          ELSE NULL
        END
      ) AS permalink,
      COALESCE(pt.published_at, p.published_at) AS published_at,
      COALESCE(cp.caption, pi.caption) AS caption,
      pt.id::text AS publication_target_id,
      p.id::text AS publication_id
    FROM publications p
    JOIN accounts a ON a.id = p.account_id
    LEFT JOIN publication_targets pt ON pt.id = p.publication_target_id
    LEFT JOIN publication_intents pi ON pi.id = pt.publication_intent_id
    LEFT JOIN content_packets cp ON cp.id = p.content_packet_id
    WHERE p.account_id = $1::uuid
      AND p.status = 'published'
      AND COALESCE(pt.external_post_id, p.instagram_post_id) IS NOT NULL
      AND btrim(COALESCE(pt.external_post_id, p.instagram_post_id, '')) <> ''
    ORDER BY COALESCE(pt.external_post_id, p.instagram_post_id),
             COALESCE(pt.published_at, p.published_at) DESC NULLS LAST
    LIMIT $2
    `,
    [accountId, limit]
  );

  return result.rows.map((row) => ({
    media_id: String(row.media_id),
    caption: row.caption ? String(row.caption).slice(0, 200) : null,
    permalink: row.permalink || null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    publication_target_id: row.publication_target_id,
    publication_id: row.publication_id,
    source: 'database',
    account_id: accountId,
  }));
}

function enrichDbPostsWithGraph(dbPosts, graphPosts) {
  for (const post of dbPosts) {
    const graphMatch = graphPosts.find((candidate) => {
      if (candidate.media_id === post.media_id) return true;
      return captionsMatch(post.caption, candidate.caption);
    });
    if (!graphMatch) continue;

    if (post.media_id !== graphMatch.media_id) {
      post.original_media_id = post.media_id;
      post.media_id = graphMatch.media_id;
      post.media_id_resolved = true;
    }
    post.comments_count = graphMatch.comments_count ?? post.comments_count ?? null;
    post.permalink = graphMatch.permalink || post.permalink;
    post.published_at = post.published_at || graphMatch.published_at || null;
    if (post.source === 'database') {
      post.source = 'database+graph';
    }
  }
}

async function listMediaFromGraph({ accountId, igUserId, limit }) {
  if (isEngagementDryRun()) {
    return dryRunPosts(accountId);
  }

  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`;
  const response = await httpClient.get(url, {
    params: {
      fields: MEDIA_FIELDS,
      limit: Math.min(50, limit),
      access_token: accessToken,
    },
    timeout: 30_000,
  });

  const data = Array.isArray(response?.data?.data) ? response.data.data : [];
  return data.map((item) => ({
    media_id: String(item.id),
    caption: item.caption ? String(item.caption).slice(0, 200) : null,
    permalink: item.permalink || null,
    published_at: item.timestamp || null,
    media_type: item.media_type || null,
    comments_count: item.comments_count ?? null,
    source: 'instagram_graph',
    account_id: accountId,
  }));
}

async function fetchMediaSummary(accountId, mediaId) {
  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(mediaId)}`;
  const response = await httpClient.get(url, {
    params: {
      fields: 'id,caption,comments_count,permalink',
      access_token: accessToken,
    },
    timeout: 30_000,
  });
  return {
    media_id: String(response.data?.id || mediaId),
    comments_count: response.data?.comments_count ?? null,
    caption: response.data?.caption || null,
    permalink: response.data?.permalink || null,
  };
}

function buildEmptyCommentsHint(commentsCount) {
  const count = Number(commentsCount);
  if (Number.isFinite(count) && count > 0) {
    return (
      'Instagram shows ' +
      count +
      ' comment(s) on this post, but your access token cannot list them. ' +
      'Regenerate the token in Meta (Instagram API) with instagram_business_basic and ' +
      'instagram_business_manage_comments (plus instagram_business_content_publish for posting), ' +
      'then update it under Accounts → Instagram access token.'
    );
  }
  return 'No comments on this post in Instagram (or they are not visible to the API yet).';
}

async function resolveMediaIdForComments(pool, accountId, mediaId, { captionHint } = {}) {
  const original = String(mediaId || '').trim();
  if (isEngagementDryRun()) {
    return { mediaId: original, original_media_id: original, resolved: false };
  }
  if (isLikelyIgMediaId(original) && !isUnusableStoredMediaId(original)) {
    return { mediaId: original, original_media_id: original, resolved: false };
  }

  const acc = await pool.query(
    `SELECT ig_user_id FROM accounts WHERE id = $1::uuid LIMIT 1`,
    [accountId]
  );
  const igUserId = String(acc.rows[0]?.ig_user_id || '').trim();
  if (!igUserId) {
    return {
      mediaId: original,
      original_media_id: original,
      resolved: false,
      hint: 'Account missing ig_user_id — reconnect Instagram.',
    };
  }

  let graphPosts = [];
  try {
    graphPosts = await listMediaFromGraph({ accountId, igUserId, limit: 50 });
  } catch (err) {
    return {
      mediaId: original,
      original_media_id: original,
      resolved: false,
      graph_error: formatGraphError(err),
      hint: 'Could not list Instagram media to resolve post id.',
    };
  }

  if (captionHint) {
    const byCaption = graphPosts.find((item) => captionsMatch(item.caption, captionHint));
    if (byCaption) {
      return {
        mediaId: byCaption.media_id,
        original_media_id: original,
        resolved: original !== byCaption.media_id,
        matched_by: 'caption',
        comments_count: byCaption.comments_count ?? null,
      };
    }
  }

  const byStoredId = graphPosts.find((item) => item.media_id === original);
  if (byStoredId) {
    return {
      mediaId: byStoredId.media_id,
      original_media_id: original,
      resolved: false,
      comments_count: byStoredId.comments_count ?? null,
    };
  }

  return {
    mediaId: original,
    original_media_id: original,
    resolved: false,
    hint:
      'Stored post id is not a valid Instagram media id. Pick the post from the dropdown (caption match) or reconnect the account.',
  };
}

async function fetchCommentsForMedia({ pool, accountId, mediaId, limit = 50, captionHint }) {
  if (isEngagementDryRun()) {
    return {
      comments: dryRunComments(mediaId),
      paging: null,
      dry_run: true,
      resolved_media_id: mediaId,
      original_media_id: mediaId,
    };
  }

  const resolution = pool
    ? await resolveMediaIdForComments(pool, accountId, mediaId, { captionHint })
    : { mediaId: String(mediaId), original_media_id: String(mediaId), resolved: false };
  const effectiveMediaId = resolution.mediaId;

  const httpClient = await resolveHttpClient(accountId);
  const accessToken = await getValidToken(accountId);
  const url = `${GRAPH_BASE}/${encodeURIComponent(effectiveMediaId)}/comments`;
  const comments = [];
  let nextUrl = null;
  let first = true;
  let graphError = resolution.graph_error || null;

  try {
    while (first || nextUrl) {
      first = false;
      const response = nextUrl
        ? await httpClient.get(nextUrl, { timeout: 30_000 })
        : await httpClient.get(url, {
            params: {
              fields: COMMENT_FIELDS,
              limit: Math.min(100, limit),
              access_token: accessToken,
            },
            timeout: 30_000,
          });

      const batch = Array.isArray(response?.data?.data) ? response.data.data : [];
      for (const comment of batch) {
        comments.push({
          id: String(comment.id),
          text: comment.text || '',
          username: comment.from?.username || null,
          from_id: comment.from?.id ? String(comment.from.id) : null,
          timestamp: comment.timestamp || null,
          like_count: comment.like_count ?? 0,
          media_id: effectiveMediaId,
        });
        if (comments.length >= limit) break;
      }
      if (comments.length >= limit) break;
      nextUrl = response?.data?.paging?.next || null;
    }
  } catch (err) {
    graphError = formatGraphError(err);
    const status = err?.response?.status;
    const wrapped = new Error(graphError);
    wrapped.statusCode = status === 401 ? 401 : status === 403 ? 403 : 502;
    wrapped.graph_error = graphError;
    wrapped.resolution = resolution;
    throw wrapped;
  }

  let hint = resolution.hint || null;
  let igCommentsCount = resolution.comments_count ?? null;
  if (comments.length === 0 && (igCommentsCount == null || igCommentsCount === 0)) {
    try {
      const summary = await fetchMediaSummary(accountId, effectiveMediaId);
      igCommentsCount = summary.comments_count ?? igCommentsCount;
    } catch (_err) {
      // ignore — hint will stay generic
    }
  }
  if (comments.length === 0) {
    hint = buildEmptyCommentsHint(igCommentsCount) || hint;
  }

  return {
    comments: comments.slice(0, limit),
    paging: null,
    dry_run: false,
    resolved_media_id: effectiveMediaId,
    original_media_id: resolution.original_media_id,
    media_id_resolved: Boolean(resolution.resolved),
    matched_by: resolution.matched_by || null,
    graph_error: graphError,
    hint,
    comments_count_reported: igCommentsCount ?? null,
  };
}

async function listPostsForAccount(pool, accountId, { limit = 30, includeGraph = true } = {}) {
  const acc = await pool.query(
    `SELECT id, ig_user_id FROM accounts WHERE id = $1::uuid LIMIT 1`,
    [accountId]
  );
  if (acc.rowCount === 0) {
    const err = new Error('Account not found');
    err.statusCode = 404;
    throw err;
  }

  const igUserId = String(acc.rows[0].ig_user_id || '').trim();
  const dbPosts = await listPublishedPostsFromDb(pool, accountId, limit);
  const byId = new Map(dbPosts.map((post) => [post.media_id, post]));

  let graphError = null;
  let graphPosts = [];
  if (includeGraph && igUserId) {
    try {
      graphPosts = await listMediaFromGraph({ accountId, igUserId, limit });
      enrichDbPostsWithGraph(dbPosts, graphPosts);
      for (const post of dbPosts) {
        byId.set(post.media_id, post);
      }
      for (const post of graphPosts) {
        if (!byId.has(post.media_id)) {
          byId.set(post.media_id, post);
        }
      }
    } catch (err) {
      graphError = formatGraphError(err);
      if (dbPosts.length === 0) {
        const wrapped = new Error(graphError);
        wrapped.statusCode = err?.response?.status === 401 ? 401 : 502;
        wrapped.graph_error = graphError;
        throw wrapped;
      }
    }
  }

  const posts = Array.from(byId.values()).sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : 0;
    const tb = b.published_at ? Date.parse(b.published_at) : 0;
    return tb - ta;
  });
  return { posts, graph_error: graphError };
}

module.exports = {
  listPostsForAccount,
  fetchCommentsForMedia,
  listPublishedPostsFromDb,
  listMediaFromGraph,
  resolveMediaIdForComments,
  fetchMediaSummary,
  buildEmptyCommentsHint,
  captionsMatch,
};
