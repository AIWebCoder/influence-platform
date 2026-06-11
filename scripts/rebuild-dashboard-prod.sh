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

echo "==> Production build (blocks 2–6 min — site will be down until step 3 finishes)"
echo "    Do NOT run another docker compose command in another terminal."
docker compose run --rm --no-deps dashboard npm run build

echo "==> Starting dashboard (next start only)"
docker compose up -d dashboard

echo "==> Waiting for HTTP on :3000 (up to 3 min)..."
ready=0
i=0
while [ "$i" -lt 36 ]; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ 2>/dev/null || echo "000")
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "308" ]; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 5
done

if [ "$ready" = "1" ]; then
  echo "==> Dashboard ready (HTTP $code)"
else
  echo "==> Dashboard not responding yet — check logs:"
  echo "    docker compose logs --tail=80 dashboard"
  exit 1
fi

docker compose exec dashboard test -f /app/.next/BUILD_ID && echo "==> BUILD_OK"
