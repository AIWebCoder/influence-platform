#!/usr/bin/env node
/**
 * Diagnose Instagram comment fetch for Engagement UI.
 * Usage (from repo root):
 *   node scripts/diagnose-engagement-comments.cjs [account_id] [caption_substring]
 * Or inside distribution-engine container:
 *   node /app/../scripts/diagnose-engagement-comments.cjs
 */
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const deRoot = path.join(repoRoot, 'distribution-engine');

// When run from host, load DE modules
process.chdir(deRoot);
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const { Pool } = require('pg');
const {
  listPostsForAccount,
  fetchCommentsForMedia,
  captionsMatch,
} = require(path.join(deRoot, 'src/engagement/instagramCommentsService'));
const { isEngagementDryRun } = require(path.join(deRoot, 'src/engagement/engagementMode'));

const captionNeedle =
  process.argv[3] || process.env.ENGAGEMENT_DIAG_CAPTION || 'Stop spending hours in the kitchen';

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.POSTGRES_USER || 'ipuser'}:${process.env.POSTGRES_PASSWORD || 'ippassword'}@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'influence_platform'}`,
  });

  let accountId = process.argv[2];
  if (!accountId) {
    const accs = await pool.query(
      `SELECT id, username, ig_user_id,
              length(COALESCE(ig_access_token, '')) AS token_len,
              status
       FROM accounts
       WHERE ig_user_id IS NOT NULL AND btrim(COALESCE(ig_access_token, '')) <> ''
       ORDER BY updated_at DESC
       LIMIT 5`
    );
    console.log('\n=== Accounts with IG token ===');
    console.table(accs.rows);
    accountId = accs.rows[0]?.id;
  }

  if (!accountId) {
    console.error('No account_id and no account with IG token found.');
    process.exit(1);
  }

  console.log('\n=== Environment ===');
  console.log({
    ENGAGEMENT_DRY_RUN: process.env.ENGAGEMENT_DRY_RUN,
    isEngagementDryRun: isEngagementDryRun(),
    PUBLISH_DRY_RUN: process.env.PUBLISH_DRY_RUN,
    USE_PERSONA_PROXY_FOR_GRAPH: process.env.USE_PERSONA_PROXY_FOR_GRAPH,
    account_id: accountId,
    caption_needle: captionNeedle,
  });

  const pubStats = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM publications GROUP BY status`
  );
  console.log('\n=== Publications by status ===');
  console.table(pubStats.rows);

  const intents = await pool.query(
    `SELECT pi.id, pi.status, left(pi.caption, 80) AS caption
     FROM publication_intents pi
     WHERE pi.caption ILIKE $1
     ORDER BY pi.created_at DESC
     LIMIT 5`,
    [`%${captionNeedle.slice(0, 40)}%`]
  );
  console.log('\n=== Matching publication_intents ===');
  console.table(intents.rows);

  console.log('\n=== GET /engagement/posts (listPostsForAccount) ===');
  const { posts, graph_error } = await listPostsForAccount(pool, accountId, {
    limit: 30,
    includeGraph: true,
  });
  if (graph_error) console.log('graph_error:', graph_error);
  console.log(`posts count: ${posts.length}`);
  for (const p of posts.slice(0, 15)) {
    console.log(
      `- ${p.media_id} | comments_count=${p.comments_count ?? '?'} | source=${p.source} | ${(p.caption || '').slice(0, 55)}`
    );
  }

  const match =
    posts.find((p) => captionsMatch(p.caption, captionNeedle)) ||
    posts.find((p) => (p.comments_count ?? 0) > 0) ||
    posts[0];

  if (!match) {
    console.error('\nNo posts returned — cannot test comments.');
    await pool.end();
    process.exit(2);
  }

  console.log('\n=== Selected post for comment fetch ===');
  console.log(match);

  console.log('\n=== GET comments ===');
  try {
    const result = await fetchCommentsForMedia({
      pool,
      accountId,
      mediaId: match.media_id,
      limit: 50,
      captionHint: match.caption || captionNeedle,
    });
    console.log({
      resolved_media_id: result.resolved_media_id,
      original_media_id: result.original_media_id,
      media_id_resolved: result.media_id_resolved,
      comments_count_reported: result.comments_count_reported,
      hint: result.hint,
      graph_error: result.graph_error,
      dry_run: result.dry_run,
      comment_count: result.comments.length,
    });
    for (const c of result.comments.slice(0, 10)) {
      console.log(`  @${c.username}: ${c.text.slice(0, 80)}`);
    }
  } catch (err) {
    console.error('fetchCommentsForMedia failed:', err.message);
    if (err.graph_error) console.error('graph_error:', err.graph_error);
    if (err.resolution) console.error('resolution:', err.resolution);
    process.exit(3);
  }

  await pool.end();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
