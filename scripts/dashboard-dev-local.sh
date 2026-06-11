#!/usr/bin/env sh
# Reset local Docker dashboard for next dev (fixes globals.css / .next cache issues).
set -e
cd "$(dirname "$0")/.."

echo "==> Stopping dashboard"
docker compose stop dashboard || true
docker compose rm -f dashboard || true

PROJECT="${COMPOSE_PROJECT_NAME:-influence-platform}"
docker volume rm "${PROJECT}_dashboard_next" 2>/dev/null || true

echo "==> Refreshing node_modules in container"
docker compose run --rm --no-deps dashboard npm ci

echo "==> Starting dashboard (next dev, NODE_ENV=development)"
docker compose up -d dashboard

echo "==> Logs:"
sleep 2
docker compose logs --tail=20 dashboard
