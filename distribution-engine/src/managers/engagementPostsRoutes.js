/**
 * Post + comment fetch routes (mounted alongside engagementRouter).
 * Kept in a separate file so deploys that update only index.js still get /engagement/posts.
 */
const express = require('express');
const { getPool } = require('../core/database');
const {
  listPostsForAccount,
  fetchCommentsForMedia,
} = require('../engagement/instagramCommentsService');

const router = express.Router();

router.get('/posts', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'account_id is required' });
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const includeGraph = String(req.query.include_graph || 'true').toLowerCase() !== 'false';
  try {
    const result = await listPostsForAccount(pool, accountId, { limit, includeGraph });
    res.json({
      posts: result.posts,
      count: result.posts.length,
      graph_error: result.graph_error || null,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error('[engagementPostsRoutes] posts failed:', err.message);
    res.status(status).json({
      error: err.message || 'Failed to list posts',
      hint: 'Account needs ig_user_id and ig_access_token.',
    });
  }
});

router.get('/posts/:mediaId/comments', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  const mediaId = String(req.params.mediaId || '').trim();
  const captionHint = String(req.query.caption_hint || '').trim() || undefined;
  if (!accountId || !mediaId) {
    return res.status(400).json({ error: 'account_id and mediaId are required' });
  }
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    const result = await fetchCommentsForMedia({
      pool,
      accountId,
      mediaId,
      limit,
      captionHint,
    });
    res.json({
      media_id: result.resolved_media_id || mediaId,
      original_media_id:
        result.original_media_id && result.original_media_id !== result.resolved_media_id
          ? result.original_media_id
          : undefined,
      media_id_resolved: result.media_id_resolved || false,
      account_id: accountId,
      comments: result.comments,
      count: result.comments.length,
      dry_run: result.dry_run,
      hint: result.hint || null,
      graph_error: result.graph_error || null,
      comments_count_reported: result.comments_count_reported ?? null,
    });
  } catch (err) {
    console.error('[engagementPostsRoutes] comments failed:', err.message);
    const status = err.statusCode || err?.response?.status || 500;
    res.status(status).json({
      error: err.graph_error || err.message || 'Failed to fetch comments',
      hint: err.resolution?.hint || 'Check IG token scopes (instagram_manage_comments).',
      original_media_id: err.resolution?.original_media_id,
    });
  }
});

module.exports = router;
