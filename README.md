# Influence Platform

AI-powered social media automation platform with a Next.js dashboard, campaign orchestration services, and Android emulator control.

## Architecture

- `dashboard` (Next.js): operations UI, campaigns, emulator views and controls.
- `content-factory` (FastAPI): AI content generation.
- `distribution-engine` (Express): accounts/campaign APIs, proxy assignment, JWT-protected service endpoints.
- `emulator-controller` (Python asyncio): Appium/ADB orchestration, proxy bridge, live emulator frames, tap/swipe input.
- `postgres` + `pgbouncer` + `redis`: persistence, pooling, and counters/rate limits.
- `prometheus` + `grafana`: metrics and monitoring.

## Quick Start

```bash
# 1) Clone
git clone <repo>
cd influence-platform

# 2) Configure env
cp .env.example .env
# Fill required keys/secrets in .env

# 3) Start services
docker-compose up -d

# 4) Check status
docker-compose ps
```

## Main Endpoints

|        Service       |            URL             |
|----------------------|----------------------------|
| Dashboard            | http://localhost:3000      |
| Content Factory API  | http://localhost:8000      |
| Content Factory Docs | http://localhost:8000/docs |
| Distribution Engine  | http://localhost:3001      |
| Emulator Controller  | http://localhost:9102      |
| Prometheus           | http://localhost:9090      |
| Grafana              | http://localhost:3002      |

## Required Migrations

On **`docker compose up`**, the **content-factory** image runs **`alembic upgrade head`** before Uvicorn starts (`content-factory/docker-entrypoint.sh`), so SQLAlchemy-managed tables (`generation_jobs`, `organizations`, etc.) are applied automatically.

Postgres still loads **`infra/init.sql`** on first volume init. For emulator rate limits and proxy bindings on an existing database, apply:

```bash
docker-compose exec -T postgres psql -U ipuser -d influence_platform -f /docker-entrypoint-initdb.d/init.sql
docker-compose exec -T postgres psql -U ipuser -d influence_platform -f /work/infra/V008_account_rate_limits.sql
docker-compose exec -T postgres psql -U ipuser -d influence_platform -f /work/infra/V009_proxy_bridge_and_types.sql
```

`infra/V005_analytics_tables.sql` only adds **`account_growth`** and aligns **`post_metrics.publication_id`** (no second `post_metrics` definition).

If `/work` is not mounted in your container, run from host with `docker compose exec -T postgres psql ...` using paths under your repo, or mount the repo path.

**Local dev (no Docker):** from `content-factory/`, run `alembic upgrade head` after Postgres is up.

## Emulator Operations

- Emulator page: `http://localhost:3000/emulators` (auth-protected).
- Live frame API (proxied by dashboard): `GET /api/emulators`.
- Input APIs (dashboard -> emulator-controller proxy):
  - `POST /api/emulators/:serial/input/tap`
  - `POST /api/emulators/:serial/input/swipe`

## Proxy Networking Notes

- Android global proxy only supports `host:port`.
- This repo uses a per-emulator bridge strategy for authenticated upstream proxies.
- SOCKS5 and HTTP upstream proxy types are supported via bridge metadata:
  - `proxy_type`, `auth_mode`, `rotation_hint`, `session_id`.
- Bridge-related env vars:
  - `PROXY_BRIDGE_LISTEN_HOST`
  - `PROXY_BRIDGE_PUBLIC_HOST`
  - `PROXY_BRIDGE_PORT_START`
  - `PROXY_BRIDGE_PORT_END`

## Useful Commands

```bash
# Logs
docker-compose logs -f emulator-controller
docker-compose logs -f distribution-engine

# Database shell
docker-compose exec postgres psql -U ipuser -d influence_platform

# Redis shell
docker-compose exec redis redis-cli

# Restart one service
docker-compose restart emulator-controller

# Stop all
docker-compose down
```