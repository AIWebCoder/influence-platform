#!/bin/bash
# ─────────────────────────────────────────
# Influence Platform — Deploy Script
# Usage: ./scripts/deploy.sh [environment]
# Environments: staging, production
# ─────────────────────────────────────────

set -e

ENVIRONMENT=${1:-staging}
COMPOSE_FILE="docker-compose.yml"

case $ENVIRONMENT in
    staging)
        COMPOSE_FILE="docker-compose.staging.yml"
        ENV_FILE=".env.staging"
        ;;
    production)
        COMPOSE_FILE="docker-compose.prod.yml"
        ENV_FILE=".env.production"
        ;;
    *)
        echo "❌ Unknown environment: $ENVIRONMENT"
        echo "Usage: ./deploy.sh [staging|production]"
        exit 1
        ;;
esac

echo "🚀 Deploying to $ENVIRONMENT..."

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Environment file not found: $ENV_FILE"
    echo "Please create $ENV_FILE before deploying."
    exit 1
fi

# Load environment variables
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Pull latest images (if using pre-built images)
echo "📦 Pulling latest images..."
docker compose -f $COMPOSE_FILE pull || true

# Build custom images
echo "🔨 Building images..."
docker compose -f $COMPOSE_FILE build --no-cache

# Stop existing containers
echo "🛑 Stopping existing containers..."
docker compose -f $COMPOSE_FILE down

# Start services
echo "▶️ Starting services..."
docker compose -f $COMPOSE_FILE up -d

# Wait for health checks
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check service status
echo "📊 Service Status:"
docker compose -f $COMPOSE_FILE ps

# Verify health endpoints
echo "🏥 Health Check:"
if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "✅ Content Factory: healthy"
else
    echo "❌ Content Factory: unhealthy"
fi

if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    echo "✅ Distribution Engine: healthy"
else
    echo "❌ Distribution Engine: unhealthy"
fi

echo ""
echo "🎉 Deployment to $ENVIRONMENT complete!"
echo "📝 Access URLs:"
case $ENVIRONMENT in
    staging)
        echo "   Dashboard: http://localhost:3001"
        echo "   Content Factory: http://localhost:8001"
        ;;
    production)
        echo "   Dashboard: http://localhost:3004"
        echo "   Content Factory: http://localhost:8002"
        ;;
esac
