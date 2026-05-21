#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { initDB, getPool } = require('../src/core/database');
const {
  listPostsForAccount,
  fetchCommentsForMedia,
  captionsMatch,
} = require('../src/engagement/instagramCommentsService');
const { isEngagementDryRun } = require('../src/engagement/engagementMode');

const captionNeedle =
  process.argv[3] || process.env.ENGAGEMENT_DIAG_CAPTION || 'Stop spending hours in the kitchen';

async function main() {
  await initDB();
  const pool = getPool();

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
    console.error('No account with IG token.');
    process.exit(1);
  }

  console.log('\n=== Environment ===');
  console.log({
    ENGAGEMENT_DRY_RUN: process.env.ENGAGEMENT_DRY_RUN,
    isEngagementDryRun: isEngagementDryRun(),
    PUBLISH_DRY_RUN: process.env.PUBLISH_DRY_RUN,
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

  const { posts, graph_error } = await listPostsForAccount(pool, accountId, {
    limit: 30,
    includeGraph: true,
  });
  if (graph_error) console.log('graph_error:', graph_error);
  console.log(`\n=== Posts (${posts.length}) ===`);
  for (const p of posts.slice(0, 15)) {
    console.log(
      `- ${p.media_id} | comments_count=${p.comments_count ?? '?'} | ${p.source} | ${(p.caption || '').slice(0, 55)}`
    );
  }

  const match =
    posts.find((p) => captionsMatch(p.caption, captionNeedle)) ||
    posts.find((p) => (p.comments_count ?? 0) > 0) ||
    posts[0];

  if (!match) {
    console.error('\nNo posts — Graph token or ig_user_id issue.');
    await pool.end();
    process.exit(2);
  }

  console.log('\n=== Fetch comments for ===', match.media_id);
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
      hint: result.hint,
      graph_error: result.graph_error,
      dry_run: result.dry_run,
      comments: result.comments.length,
    });
    result.comments.forEach((c) => console.log(`  @${c.username}: ${c.text}`));
  } catch (err) {
    console.error('FAILED:', err.message);
    if (err.graph_error) console.error(err.graph_error);
    process.exit(3);
  }

  await pool.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
