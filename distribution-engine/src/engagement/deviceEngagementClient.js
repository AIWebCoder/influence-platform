const axios = require('axios');
const { getPool } = require('../core/database');
const { fetchMediaSummary } = require('./instagramCommentsService');

const DEFAULT_EMULATOR_CONTROLLER_URL = 'http://emulator-controller:9102';
const DEVICE_LIKE_TIMEOUT_MS = 120_000;

function isDeviceLikeEnabled() {
  const v = (process.env.ENGAGEMENT_COMMENT_LIKE_VIA_DEVICE || '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function emulatorControllerBaseUrl() {
  return (
    (process.env.EMULATOR_CONTROLLER_URL || '').trim() ||
    (process.env.EMULATOR_CONTROLLER_INTERNAL_URL || '').trim() ||
    DEFAULT_EMULATOR_CONTROLLER_URL
  ).replace(/\/$/, '');
}

async function resolveEmulatorSerial(accountId) {
  const pool = getPool();
  const personaRes = await pool.query(
    `
    SELECT pdb.emulator_serial
    FROM accounts a
    JOIN persona_device_bindings pdb ON pdb.persona_id = a.persona_id
    WHERE a.id = $1::uuid
      AND pdb.emulator_serial IS NOT NULL
      AND TRIM(pdb.emulator_serial) <> ''
    ORDER BY pdb.last_seen_at DESC NULLS LAST
    LIMIT 1
    `,
    [accountId],
  );
  if (personaRes.rows[0]?.emulator_serial) {
    return String(personaRes.rows[0].emulator_serial).trim();
  }

  const bindingRes = await pool.query(
    `
    SELECT emulator_serial
    FROM emulator_proxy_bindings
    WHERE account_id = $1::uuid
      AND status = 'active'
      AND emulator_serial IS NOT NULL
      AND TRIM(emulator_serial) <> ''
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
    `,
    [accountId],
  );
  if (bindingRes.rows[0]?.emulator_serial) {
    return String(bindingRes.rows[0].emulator_serial).trim();
  }
  return null;
}

async function resolvePostPermalink(accountId, mediaId) {
  if (!mediaId) return null;
  const pool = getPool();
  const pubRes = await pool.query(
    `
    SELECT COALESCE(
      pt.external_post_url,
      CASE
        WHEN p.instagram_post_id ~ '^[0-9]+$' THEN NULL
        ELSE NULL
      END
    ) AS permalink
    FROM publications p
    LEFT JOIN publication_targets pt ON pt.id = p.publication_target_id
    WHERE p.account_id = $1::uuid
      AND p.status = 'published'
      AND (
        COALESCE(pt.external_post_id, p.instagram_post_id) = $2
        OR btrim(COALESCE(pt.external_post_id, p.instagram_post_id, '')) = $2
      )
    ORDER BY COALESCE(pt.published_at, p.published_at) DESC NULLS LAST
    LIMIT 1
    `,
    [accountId, String(mediaId).trim()],
  );
  const fromPub = pubRes.rows[0]?.permalink;
  if (fromPub) return fromPub;

  try {
    const summary = await fetchMediaSummary(accountId, String(mediaId).trim());
    return summary?.permalink || null;
  } catch (_) {
    return null;
  }
}

async function likeCommentViaDevice({
  accountId,
  commentId,
  parentTargetId,
  targetUsername,
  commentTextHint,
}) {
  if (!isDeviceLikeEnabled()) {
    return {
      success: false,
      error:
        'comment_like via device is disabled. Set ENGAGEMENT_COMMENT_LIKE_VIA_DEVICE=true and bind an emulator to the account persona.',
      stage: 'comment_like_device_disabled',
      safe_to_retry: false,
    };
  }

  const serial = await resolveEmulatorSerial(accountId);
  if (!serial) {
    return {
      success: false,
      error:
        'No emulator bound to this account. Bind a device under Personas or link emulator_proxy_bindings.',
      stage: 'comment_like_no_device',
      safe_to_retry: false,
    };
  }

  const postUrl = await resolvePostPermalink(accountId, parentTargetId);
  if (!postUrl) {
    return {
      success: false,
      error: 'Could not resolve Instagram post URL for device automation (missing permalink).',
      stage: 'comment_like_no_permalink',
      safe_to_retry: false,
    };
  }

  const url = `${emulatorControllerBaseUrl()}/emulators/${encodeURIComponent(serial)}/engagement/like-comment`;
  try {
    const response = await axios.post(
      url,
      {
        post_url: postUrl,
        comment_username: targetUsername || null,
        comment_text: commentTextHint || null,
        comment_id: commentId,
      },
      { timeout: DEVICE_LIKE_TIMEOUT_MS },
    );
    if (response?.data?.status === 'success' || response?.data?.success) {
      return {
        success: true,
        external_result_id: `device_like_${String(commentId).slice(0, 32)}`,
        stage: 'comment_like_device',
        note: `Executed on emulator ${serial}`,
      };
    }
    return {
      success: false,
      error: response?.data?.error || 'Device comment like failed',
      stage: 'comment_like_device_failed',
      safe_to_retry: true,
    };
  } catch (err) {
    const msg = err?.response?.data?.error || err?.message || String(err);
    return {
      success: false,
      error: `Device comment like error: ${msg}`,
      stage: 'comment_like_device_error',
      safe_to_retry: !(err?.response?.status && err.response.status < 500),
    };
  }
}

module.exports = {
  isDeviceLikeEnabled,
  likeCommentViaDevice,
  resolveEmulatorSerial,
  resolvePostPermalink,
};
