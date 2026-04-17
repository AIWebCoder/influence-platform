#!/bin/sh
set -e
cd /app
echo "Running Alembic migrations..."
alembic upgrade head
echo "Starting Content Factory..."
exec uvicorn src.main:app --host 0.0.0.0 --port 8000
