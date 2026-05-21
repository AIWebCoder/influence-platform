function isEngagementDryRun() {
  const fallback = (process.env.ENVIRONMENT || '').trim().toLowerCase() === 'production' ? 'false' : 'true';
  const v = (process.env.ENGAGEMENT_DRY_RUN ?? process.env.PUBLISH_DRY_RUN ?? fallback).trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function engagementModeLabel() {
  return isEngagementDryRun() ? 'DRY_RUN' : 'REAL';
}

function dryRunEngagementResult(actionType, targetId) {
  const slug = String(targetId || 'unknown').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `dry_run_${actionType}_${slug}`;
}

module.exports = { isEngagementDryRun, engagementModeLabel, dryRunEngagementResult };
