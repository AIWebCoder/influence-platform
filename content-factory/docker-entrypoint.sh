#!/bin/sh
set -e
cd /app
echo "Running Alembic migrations..."
if ! alembic upgrade head; then
  echo "Alembic upgrade failed; stamping head to continue in dev mode..."
  alembic stamp head || true
fi
echo "Starting Content Factory..."
# Trust X-Forwarded-* from nginx/docker bridge (not only 127.0.0.1).
UVICORN_PROXY_FLAGS="--proxy-headers --forwarded-allow-ips=*"
if [ "${UVICORN_RELOAD}" = "1" ] || [ "${UVICORN_RELOAD}" = "true" ]; then
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload $UVICORN_PROXY_FLAGS
else
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000 $UVICORN_PROXY_FLAGS
fi
