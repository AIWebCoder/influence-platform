#!/usr/bin/env sh
# Rebuild dashboard production bundle on the server after git pull.
set -e
cd "$(dirname "$0")/.."

echo "==> Git HEAD"
git log -1 --oneline

docker compose stop dashboard
docker compose rm -f dashboard
echo "==> Removing production .next volume (must succeed)"
docker volume rm influence-platform_dashboard_next

echo "==> Starting dashboard (logs must show npm run build, not only Ready in ~450ms)"
FORCE_DASHBOARD_REBUILD=1 docker compose up -d dashboard
sleep 5
docker compose logs --tail=40 dashboard