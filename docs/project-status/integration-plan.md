# Plan d'integration / Integration plan — Influence Platform MVP

> **FR :** Plan pour integrer tous les points **A faire** et **Partiel** du [checklist livrable](./livrable-client-checklist.md).  
> **EN :** Integration plan for all gaps listed in the client delivery checklist.

**Date :** 15 May 2026  
**Reference :** [livrable-client-checklist.md](./livrable-client-checklist.md)  
**Goal :** MVP from ~55% to ~90%

Duration: 8-10 weeks (3 devs) or 12-14 weeks (1-2 devs)

## Principles

1. Single publish path: publish:commands + publication_intents
2. Instagram Graph API first
3. Ready content in DB and Redis
4. Vertical slices end-to-end
5. Scale proof: 1 then 10 then 50-100 accounts

## Phases overview

| Phase | Duration | Focus |
|-------|----------|--------|
| P0 | 1-2 wk | Real publish, IG tokens, media URL |
| P1 | 2 wk | E2E and CI |
| P2 | 2-3 wk | Templates, calendar, queue UI |
| P3 | 2-3 wk | 50-100 accounts, proxies, health |
| P4 | 2 wk | Dashboard campaigns, metrics, alerts |
| P5 | 1 wk | CI hardening, runbooks |

Order: P0 then P1 then P2 and P3 parallel then P4 then P5

---

## P0 - Publication foundations (BLOCKING)

**Deliverable M1 (week 2):** One real Instagram reel published, visible in Publications UI.

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P0.1 | Document single publish path | `content-factory/src/services/publish_dispatcher.py`, `generation_orchestrator.py` | Runbook + one official diagram |
| P0.2 | Require IG account fields | `distribution-engine/src/managers/AccountService.js`, `dashboard/src/app/accounts/page.tsx` | Cannot dispatch without `ig_user_id` + token |
| P0.3 | Disable dry-run in prod | `distribution-engine/src/core/publishMode.js`, `docker-compose.prod.yml` | Real `post_url` in `publications` table |
| P0.4 | Public media URL for Graph API | `generation_orchestrator.py` | No local-only video blocking distribution |
| P0.5 | Deprecate legacy queue for studio | `generation_task.py`, `content:ready` consumer docs | Studio uses intents only |
| P0.6 | Align tests and internal docs | `content-factory/tests/test_content.py`, `docs/project-status/project-report.md` | Tests match Kie/Gemini path |

**Canonical flow:** Generation Studio -> `POST /generation-jobs` -> orchestrator -> `publication_intents` -> `publish_outbox` -> Redis `publish:commands` -> `PublishingWorker` -> Instagram Graph API.

---

## P1 - End-to-end pipeline and quality

**Deliverable M2 (week 4):** Green CI + smoke E2E on publish path.

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P1.1 | Integration tests for orchestrator | New `content-factory/tests/test_generation_orchestrator.py` | Distribution step mocks Redis |
| P1.2 | Tests for publish intents | New `content-factory/tests/test_publish_intents.py` | Idempotency verified |
| P1.3 | CI: Postgres + Redis for DE tests | `.github/workflows/ci.yml` | DE job runs with services |
| P1.4 | Dashboard E2E smoke | `dashboard/e2e/create-publish-monitor.spec.ts` | Optional CI job on PR |
| P1.5 | Correlate job to publication | DB columns / logs `publishPipelineLog.js` | Trace ID in CF + DE logs |
| P1.6 | Extend scheduling tests | `content-factory/tests/test_scheduling.py` | Schedule write API covered |

**Checklist impact:** items 4.1-4.3 move to ~75%.

---

## P2 - Content Factory (operator product)

**In progress (May 2026):** P2.1–P2.9 backend/UI started; test debt tracked in [test-failures-backlog.md](./test-failures-backlog.md).


**Deliverable M3 (week 6):** Calendar, ready queue page, templates wired to generation.

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P2.1 | Niches CRUD (replace stub) | `content-factory/src/api/niches.py`, new service, Alembic seed | `GET /niches` from DB |
| P2.2 | Templates in generation pipeline | `generation_orchestrator.py`, `template_service.py` | `template_id` injects caption/visual prompts |
| P2.3 | Filter templates by niche | `content-factory/src/api/templates.py` | `GET /templates?niche_id=` |
| P2.4 | Templates UI | New `dashboard/src/app/templates/page.tsx`, `AppSidebar.tsx` | List/create/edit templates |
| P2.5 | Schedule write API | `content-factory/src/api/scheduling.py`, `scheduling_service.py` | `PATCH` with `scheduled_at` |
| P2.6 | Job completion creates content_packet | `generation_orchestrator.py`, `content_service.py` | Calendar API shows studio jobs |
| P2.7 | Editorial calendar page | New `dashboard/src/app/calendar/page.tsx`, `api.ts` | Month/week view, timezone display |
| P2.8 | Ready queue list API | `content-factory` or query `publication_intents` | List items with status `ready` |
| P2.9 | Ready queue page | New `dashboard/src/app/queue/page.tsx`, home link | Operators see queue contents, not only size |
| P2.10 | Generation hardening | `generation_orchestrator.py`, studio UI | Clear errors for API credits / local media |

**Dependencies:** P2.2 after P2.1; P2.6-9 after P0.

**Checklist impact:** items 1.3-1.5 move to **Livre**; 1.1-1.2 to ~90%.

---

## P3 - Distribution Engine (scale and isolation)

**In progress (May 2026):** strict 1:1 proxies enforced; proxy CRUD + pool capacity; bulk account import; ops-summary mounted; shadowban sweep scheduled.

**Deliverable M4 (week 8):** Documented load test at 50 accounts; proxy policy enforced.

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P3.1 | **Decision:** proxy 1:1 vs shared pool | ADR in `docs/architecture/` | Written policy |
| P3.2 | Enforce proxy assignment | `distribution-engine/src/managers/ProxyManager.js` | No account without proxy if policy requires |
| P3.3 | Proxy CRUD + seed | `proxyRouter.js`, seed SQL/script | 50+ proxies loadable |
| P3.4 | Auto-assign on account create | `AccountService.js` | `POST /accounts` assigns proxy |
| P3.5 | Fix Playwright proxy OR drop for MVP | `SessionManager.js`, `ProxyManager.js` | Either works or documented out of scope |
| P3.6 | Bulk account import | `accountsRouter.js` `POST /accounts/bulk` | CSV/JSON import |
| P3.7 | Raise worker concurrency | `redis.js`, `docker-compose.yml`, `PublishingWorker.js` | Config for 10-20 workers |
| P3.8 | Warm-up lifecycle in DB | `WarmupManager.js` | `warmup_started_at` / `completed_at` updated |
| P3.9 | Mount ops-summary API | `distribution-engine/src/index.js`, `dashboardRouter.js` | Fix status casing (`active` vs `ACTIVE`) |
| P3.10 | Schedule shadowban checks | `ShadowbanMonitor.js`, `index.js` | Cron runs in production |
| P3.11 | Replace simulated metrics | `MetricsCollector.js` | Real data or feature disabled with label |
| P3.12 | Load test 50 and 100 | `scripts/load-tests/` | Results in `docs/runbooks/scale-50-accounts.md` |

**Dependencies:** P3.12 after P3.1-7.

**Checklist impact:** items 2.1-2.5 move to ~80%.

---

## P4 - Dashboard (complete ops loop)

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P4.1 | Sidebar: health, proxies, queue, calendar, templates | `AppSidebar.tsx` | All pages reachable |
| P4.2 | Protect admin routes | `middleware.ts` | `/users`, `/account-health` require auth |
| P4.3 | **Campaigns V1** (if in contract) | `campaigns/page.tsx`, `LaunchCampaignForm.tsx`, `CampaignManager.js` | Create campaign -> N generation jobs |
| P4.3b | **Or** defer campaigns | Update `livrable-client-checklist.md` | Client sign-off on scope cut |
| P4.4 | Analytics page (light) | `analytics/page.tsx` | 7-day publish stats, not placeholder |
| P4.5 | Alerts with JWT | `AlertBell.tsx`, `dashboard/src/lib/api.ts` | Authenticated alert list |
| P4.6 | Account onboarding for IG publish | `accounts/page.tsx` | Token status visible before dispatch |

**Checklist impact:** items 3.1-3.4 move to ~85%.

---

## P5 - Infrastructure and delivery quality

| ID | Task | Key files | Acceptance |
|----|------|-----------|------------|
| P5.1 | Remove `continue-on-error` on dashboard Docker build | `.github/workflows/ci.yml` | Failed build fails CI |
| P5.2 | Runbook: Instagram publish | `docs/runbooks/publish-instagram.md` | Tokens, dry-run, troubleshooting |
| P5.3 | Runbook: 50-account scale | `docs/runbooks/scale-50-accounts.md` | Proxies, workers, limits |
| P5.4 | Grafana/Prometheus doc for operators | `README.md` or runbook | URLs and login documented |
| P5.5 | Update client checklist after each milestone | `livrable-client-checklist.md` | Status reflects reality |

**Deliverable M5 (week 10):** Overall checklist ~85-90%.

---

## Dependency matrix

| Task | Depends on | Blocks |
|------|------------|--------|
| P0 real publish | IG tokens, media URL | P1, P2.6, P2.9 |
| P2 calendar/queue | P0 packets | P4.1 nav |
| P2 templates | P2.1 niches | P4.3 campaigns (if built) |
| P3 bulk 50 accounts | P3.1-4 proxies | P3.12 load test |
| P1 E2E CI | P0 | Client demo |
| P4 campaigns | P2.2 templates (optional) | - |

---

## Team split (suggested)

| Track | Phases | Skills |
|-------|--------|--------|
| A - Content + Dashboard content | P2, P4 (templates, calendar, queue, campaigns) | Python FastAPI + Next.js |
| B - Distribution + scale | P0.2-0.4, P3, P5 infra | Node.js + DevOps |
| C - Quality | P1, P5.1 | QA / full-stack |

Weekly sync: publish path diagram + checklist % per block.

---

## Milestones

| Milestone | Target week | Success criteria |
|-----------|-------------|------------------|
| M1 First real post | W2 | IG reel live + Publications row |
| M2 Pipeline CI | W4 | CF pytest + DE tests + dashboard build + E2E smoke |
| M3 Content operator | W6 | Calendar + queue + templates in UI |
| M4 Scale 50 | W8 | Load test report + proxy policy live |
| M5 MVP delivery | W10 | Client checklist >= 85% |

---

## Product decisions (locked for V1 — May 2026)

1. **Instagram:** Graph API publish path only for V1 (no Twitter/TikTok in account API or ops UI).
2. **Proxies:** **Strict 1:1** — each account gets a dedicated unassigned proxy (`PROXY_STRICT_ONE_TO_ONE=true`).
3. **Campaigns:** **Minimal UI now** — `/campaigns` creates campaign + spawns generation jobs per IG account.
4. **Warm-up:** posting rate limits only vs emulator engagement — still TBD.
5. **Platforms:** Twitter/TikTok/Facebook/LinkedIn **out of V1 scope** (dashboard shows IG only; DE rejects other platforms).

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Instagram token expiry | Publish stops | `tokenExpiryMonitor` + P4.5 alerts |
| AI provider credits exhausted | Jobs fail | Studio error messages + demo mode doc |
| Two Redis publish paths | Operator confusion | P0.1 single path + deprecation |
| Playwright maintenance cost | Delays at scale | Graph API only in production |
| Internal docs say 100% done | Client trust | Checklist + this plan as source of truth |

---

## Tracking

- GitHub issues: prefix `int/P0-`, `int/P2-`, etc.
- Definition of Done: acceptance criteria + automated test or runbook step
- Update [livrable-client-checklist.md](./livrable-client-checklist.md) at M1-M5

---

*Integration plan v1.0 - Influence Platform - aligns with livrable-client-checklist.md*
