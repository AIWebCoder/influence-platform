# Runbook - Publication Instagram (P0)

Canonical path: Generation Studio -> publish-intents -> dispatch -> publish_outbox -> Redis publish:commands -> PublishingWorker -> Graph API.

Legacy content:ready is skipped when GENERATION_DISTRIBUTION_MODE=publish_intents (default).

## Account prerequisites

- ig_user_id and ig_access_token on accounts table
- Dashboard Accounts form or PATCH /accounts/:id/instagram

## Production

- PUBLISH_DRY_RUN=false
- ENVIRONMENT=production (distribution-engine)

See integration-plan.md phase P0.

Operator smoke: [operator-smoke-test.md](./operator-smoke-test.md). Scale 50 accounts: [scale-50-accounts.md](./scale-50-accounts.md).