/**
 * DM inbox routes (mounted alongside engagementRouter).
 * Separate file so nodemon / deploy picks up conversation endpoints reliably.
 */
const express = require('express');
const { getPool } = require('../core/database');
const { assertAccountAccess } = require('../core/accessScope');
const {
  listConversations,
  listConversationMessages,
} = require('../engagement/instagramDmService');

const router = express.Router();

router.get('/conversations', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  if (!accountId) {
    return res.status(400).json({ error: 'account_id is required' });
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
  try {
    await assertAccountAccess(pool, req.accessScope, accountId);
    const result = await listConversations({ pool, accountId, limit });
    res.json({
      conversations: result.conversations,
      count: result.conversations.length,
      dry_run: result.dry_run,
      graph_error: result.graph_error || null,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.graph_error || err.message || 'Failed to list DM conversations',
      hint: err.hint || 'Check instagram_business_manage_messages token scope.',
    });
  }
});

router.get('/conversations/:conversationId/messages', async (req, res) => {
  const pool = getPool();
  const accountId = String(req.query.account_id || '').trim();
  const conversationId = String(req.params.conversationId || '').trim();
  if (!accountId || !conversationId) {
    return res.status(400).json({ error: 'account_id and conversationId are required' });
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 40));
  try {
    await assertAccountAccess(pool, req.accessScope, accountId);
    const acc = await pool.query(
      `SELECT ig_user_id FROM accounts WHERE id = $1::uuid LIMIT 1`,
      [accountId],
    );
    if (acc.rowCount === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const igUserId = String(acc.rows[0].ig_user_id || '').trim();
    const result = await listConversationMessages({
      accountId,
      conversationId,
      igUserId,
      limit,
    });
    res.json({
      conversation_id: conversationId,
      messages: result.messages,
      count: result.messages.length,
      dry_run: result.dry_run,
      graph_error: result.graph_error || null,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.graph_error || err.message || 'Failed to list DM messages',
      hint: err.hint || null,
    });
  }
});

module.exports = router;
