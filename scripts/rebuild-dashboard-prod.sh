#!/usr/bin/env sh
# Rebuild dashboard production bundle on the server after git pull.
# Usage (from repo root on scm-101):
#   sh scripts/rebuild-dashboard-prod.sh
set -e
cd "$(dirname "$0")/.."

echo "==> Git HEAD"
git log -1 --oneline

if ! grep -q 'jobParam = searchParams.get("job")' dashboard/src/app/generation-studio/page.tsx 2>/dev/null; then
  echo "WARN: generation-studio URL fix missing — run: git pull origin main"
fi

echo "==> Stopping dashboard and clearing production .next volume"
docker compose stop dashboard
docker volume rm influence-platform_dashboard_next 2>/dev/null || true

echo "==> Starting dashboard (must run npm run build in logs — not only Ready in 450ms)"
docker compose up -d dashboard
sleep 3
docker compose logs --tail=30 dashboard

echo ""
echo "If you only see 'Ready' without 'Creating an optimized production build', run:"
echo "  docker compose stop dashboard"
echo "  docker volume rm influence-platform_dashboard_next"
echo "  FORCE_DASHBOARD_REBUILD=1 docker compose up -d dashboard"
echo "  docker compose logs -f dashboard"