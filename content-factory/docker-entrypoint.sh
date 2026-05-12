#!/bin/sh
set -e
cd /app
echo "Running Alembic migrations..."
if ! alembic upgrade head; then
  echo "Alembic upgrade failed; stamping head to continue in dev mode..."
  alembic stamp head || true
fi
echo "Starting Content Factory..."
if [ "${UVICORN_RELOAD}" = "1" ] || [ "${UVICORN_RELOAD}" = "true" ]; then
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
else
  exec uvicorn src.main:app --host 0.0.0.0 --port 8000
fi
