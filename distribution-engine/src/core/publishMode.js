function isPublishDryRun() {
  const v = (process.env.PUBLISH_DRY_RUN ?? 'true').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function publishModeLabel() {
  return isPublishDryRun() ? 'DRY_RUN' : 'REAL_PUBLISH';
}

function dryRunPostUrl(packetId) {
  return 'https://dry-run.invalid/p/' + String(packetId).replace(/-/g, '').slice(0, 12);
}

module.exports = { isPublishDryRun, publishModeLabel, dryRunPostUrl };