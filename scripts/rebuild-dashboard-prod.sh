#!/usr/bin/env sh
# Rebuild dashboard production bundle on the server after git pull.
# Requires docker-compose.override.yml (copy from docker-compose.override.prod.example.yml).
set -e
cd "$(dirname "$0")/.."

echo "==> Git HEAD"
git log -1 --oneline

if [ ! -f docker-compose.override.yml ]; then
  echo "==> Installing docker-compose.override.yml from example"
  cp docker-compose.override.prod.example.yml docker-compose.override.yml
fi

echo "==> Stopping dashboard"
docker compose stop dashboard || true
docker compose rm -f dashboard || true

PROJECT="${COMPOSE_PROJECT_NAME:-influence-platform}"
VOLUME_NAME="${PROJECT}_dashboard_next"
echo "==> Removing .next volume: ${VOLUME_NAME} (ignore error if missing)"
docker volume rm "${VOLUME_NAME}" 2>/dev/null || true

echo "==> Building and starting dashboard (watch logs — build takes 2–4 min)"
echo "    Do NOT run another docker compose command until build finishes."
FORCE_DASHBOARD_REBUILD=1 docker compose up -d dashboard

echo "==> Tailing logs (Ctrl+C when you see 'Ready' or compiled routes)..."
sleep 3
docker compose logs --tail=30 dashboard

echo ""
echo "==> When build completes, verify:"
echo "    curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/engagement"
echo "    docker compose exec dashboard test -f /app/.next/BUILD_ID && echo BUILD_OK"
