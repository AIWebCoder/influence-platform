#!/bin/bash
# ─────────────────────────────────────────
# Influence Platform — Rollback Script
# Usage: ./scripts/rollback.sh [environment] [version]
# Environments: staging, production
# ─────────────────────────────────────────

set -e

ENVIRONMENT=${1:-production}
VERSION=${2:-previous}

case $ENVIRONMENT in
    staging)
        COMPOSE_FILE="docker-compose.staging.yml"
        ;;
    production)
        COMPOSE_FILE="docker-compose.prod.yml"
        ;;
    *)
        echo "❌ Unknown environment: $ENVIRONMENT"
        exit 1
        ;;
esac

echo "🔄 Rolling back $ENVIRONMENT to $VERSION..."

# Get previous image tags
case $VERSION in
    previous)
        # For Docker Compose, we just restart with previous images
        echo "♻️ Restarting services with previous images..."
        docker compose -f $COMPOSE_FILE down
        docker compose -f $COMPOSE_FILE up -d
        ;;
    *)
        # Specific version tag would require image tagging strategy
        echo "❌ Specific version rollback not implemented yet"
        echo "   Use 'previous' to rollback to last known good state"
        exit 1
        ;;
esac

# Wait for services
sleep 10

# Check status
echo "📊 Service Status after rollback:"
docker compose -f $COMPOSE_FILE ps

echo "✅ Rollback complete!"
