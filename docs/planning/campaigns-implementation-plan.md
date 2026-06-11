# Campaigns Module — Implementation Plan

**Date:** 2026-06-11  
**Status:** In progress (Phase 1 done locally; Phase 2 started)  
**Target maturity:** ~55% → **~85%** (operable SaaS feature with honest automation scope)  
**Source audit:** [campaigns-module-audit.md](../audits/campaigns-module-audit.md)  
**Aligns with:** Phase 19 in [next-phase-dev.md](./next-phase-dev.md)

---

## 1. Vision & positioning

### North star

> **Campaigns = reusable content strategies** that batch-generate reels, track outcomes, and (for growth strategies) lightly tune posting frequency — with a clear path to fuller automation later.

### What we are NOT building in this plan

- Full marketing automation (captions, times, A/B at scale) — Phase 4+
- Replacing Generation Studio or Calendar
- Merging with `/engagement` (DM/comment inbox) — separate mental model

### Success criteria (exit gates)

| Metric | Target |
|--------|--------|
| Operator can create → generate → see job status without leaving Campaigns | 100% |
| Multi-account RBAC correct | 0 scope leaks in tests |
| Campaign history visible | Chart + table on detail view |
| Honest UI copy | No “launch” on create-only action |
| Test coverage | DE route tests + 1 Playwright flow |
| Internal readiness score | ≥ 80% on campaigns slice |

---

## 2. Phased roadmap

```
Phase 1 — Trust & clarity     (3–5 days)   P0 bugs, copy, dead code
Phase 2 — Operability         (1–1.5 wk)   Detail view, RBAC, API hardening
Phase 3 — Measurement         (1 wk)       History UI, cross-module filters
Phase 4 — Automation v2       (2+ wk)      Content scheduler, growth rules, engagement decision
```

Dependencies: **1 → 2 → 3** sequential; **4** can start after Phase 2 API is stable.

---

## 3. Phase 1 — Trust & clarity

**Goal:** Fix misleading UX and remove landmines. No new pages.

### 3.1 Tasks

| ID | Task | Owner | Files |
|----|------|-------|-------|
| P1-1 | Rename create CTA: “Créer la campagne” / “Create campaign” (not “Launch”) | FE | `i18n.ts`, `campaigns/page.tsx` |
| P1-2 | Separate toasts: `createSuccess` vs `launchSuccess` | FE | `i18n.ts`, `campaigns/page.tsx` |
| P1-3 | Localize status badges (`active` → Actif, etc.) | FE | `campaigns-columns.tsx`, `i18n.ts` |
| P1-4 | Add strategy badge: **Manual** vs **Automated** (only `growth` = automated) | FE | `campaigns-columns.tsx` |
| P1-5 | Tone down `notice` copy to match real automation | FE | `i18n.ts` |
| P1-6 | Delete `LaunchCampaignForm.tsx` (unused) | FE | remove file |
| P1-7 | Update user guide Page 10 | Docs | `guides/user-guide.md` |
| P1-8 | Guard Generate: disable while `launchingId` + debounce double-click | FE | `campaigns/page.tsx` |

### 3.2 Acceptance criteria

- [ ] Creating a campaign never shows “launched” toast
- [ ] Status column shows translated labels in FR and EN
- [ ] `growth` row shows “Automated” badge; `content`/`engagement` show “Manual”
- [ ] No references to `LaunchCampaignForm` in codebase

### 3.3 PR suggestion

Single PR: `fix(dashboard): campaigns copy and honest strategy badges`

---

## 4. Phase 2 — Operability

**Goal:** Campaign detail view, secure multi-account model, hardened API.

### 4.1 Data model (choose one)

**Option A — Junction table (recommended)**

```sql
CREATE TABLE campaign_accounts (
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, account_id)
);
```

- Migrate from `settings.account_ids`
- `target_account_id` deprecated; keep for backward compat one release

**Option B — JSONB only (faster, weaker)**

- Validate `settings.account_ids` on every write
- Fix list query with `settings->'account_ids' ?| array[...]`

**Decision:** Option A for RBAC clarity and query performance.

**Migration file:** `infra/V0XX_campaign_accounts.sql`

### 4.2 API tasks

| ID | Task | Endpoint / file |
|----|------|-----------------|
| P2-1 | `GET /campaigns/:id` — single campaign + accounts + job summary | `campaignRouter.js` |
| P2-2 | `GET /campaigns/:id/jobs` — resolve `generation_job_ids` via CF or DE proxy | new route or extend `:id` |
| P2-3 | Validate POST body (zod/joi): name, type enum, niche, topic, account_ids[] | `campaignRouter.js` |
| P2-4 | `assertAccountAccess` on **every** account in create/update | `campaignRouter.js` |
| P2-5 | Fix GET list scope via `campaign_accounts` join | `campaignRouter.js` |
| P2-6 | PATCH status enum: `active` \| `paused` \| `completed` | `campaignRouter.js` |
| P2-7 | Transactional create: campaign + junction rows | `campaignRouter.js` |

### 4.3 Dashboard tasks

| ID | Task | Route / component |
|----|------|-------------------|
| P2-8 | Campaign detail page `/campaigns/[id]` | `app/campaigns/[id]/page.tsx` |
| P2-9 | `CampaignDetailHeader` — name, type, status, actions | `components/campaigns/` |
| P2-10 | `CampaignJobsTable` — job id, status, account, Studio link | `components/campaigns/` |
| P2-11 | `CampaignAccountsList` — linked IG accounts | `components/campaigns/` |
| P2-12 | Refactor `page.tsx` — extract `useCampaigns`, `CampaignCreateDialog` | `hooks/` or `components/campaigns/` |
| P2-13 | Row click → detail; keep ⋮ menu for quick actions | `campaigns-columns.tsx` |
| P2-14 | “Mark completed” action | detail + PATCH |

### 4.4 Acceptance criteria

- [ ] User A cannot see campaign scoped only to User B’s accounts
- [ ] Detail page lists all jobs for campaign, not only last
- [ ] `GET /campaigns/:id` returns 404 for out-of-scope users
- [ ] Unit tests for P2-4, P2-5 in `distribution-engine/tests/`

### 4.5 PR breakdown

1. `feat(distribution-engine): campaign_accounts RBAC and validation`
2. `feat(dashboard): campaign detail page and job list`

---

## 5. Phase 3 — Measurement

**Goal:** Close the loop Campaign → Generate → Publish → Measure.

### 5.1 Backend

| ID | Task | Detail |
|----|------|--------|
| P3-1 | Enrich `GET /campaigns/:id` with aggregates | jobs: total/completed/failed; pubs: count from `publications` where metadata links campaign |
| P3-2 | Ensure `campaign_id` on publications path | trace CF job → packet → publication |
| P3-3 | `GET /campaigns/:id/history` — already exists; add pagination | `campaignRouter.js` |

### 5.2 Dashboard

| ID | Task | Detail |
|----|------|--------|
| P3-4 | `CampaignHistoryChart` — ER, posts, followers over time (recharts) | detail page |
| P3-5 | KPI strip on detail: jobs done, published, avg ER | detail page |
| P3-6 | Filter Queue by `campaign_id` query param | `queue/page.tsx` |
| P3-7 | Filter Publications by campaign | `publications/page.tsx` |
| P3-8 | Link from detail: “View in Queue” / “View publications” | detail page |

### 5.3 Acceptance criteria

- [ ] After generate + publish, detail page shows ≥1 publication
- [ ] History chart renders ≥2 snapshots from `campaign_history`
- [ ] Queue `?campaign=<id>` filters correctly

### 5.4 PR breakdown

1. `feat(distribution-engine): campaign metrics aggregation`
2. `feat(dashboard): campaign history chart and cross-links`

---

## 6. Phase 4 — Automation v2

**Goal:** Make strategy types meaningful; expand `CampaignManager`.

### 6.1 Content campaigns

| ID | Task | Detail |
|----|------|--------|
| P4-1 | `settings.schedule` — cron or interval (e.g. weekly) | JSONB schema |
| P4-2 | CampaignManager: if `type=content` + due → call CF create+launch job | new method |
| P4-3 | UI: schedule picker on create/edit | dashboard |
| P4-4 | Respect `paused` / `completed` — skip auto-run | CampaignManager |

### 6.2 Growth campaigns

| ID | Task | Detail |
|----|------|--------|
| P4-5 | Decrease frequency when ER below threshold | `runGrowthRules` |
| P4-6 | Use `campaign_accounts` not niche-wide blast | `getTargetAccounts` |
| P4-7 | Configurable `er_threshold` in settings UI | dashboard |
| P4-8 | Alert via existing AlertBell when rule fires | DE → alerts table |

### 6.3 Engagement type — decision required

| Option | Action |
|--------|--------|
| **A. Rename** | `engagement` → `community` or hide until wired |
| **B. Integrate** | Auto-create engagement intents from campaign rules (high effort) |
| **C. Remove** | Drop type until `/engagement` matures |

**Recommendation:** Option A for V1.1; Option B as Phase 5.

### 6.4 Observability

| ID | Task |
|----|------|
| P4-9 | Structured logs (`campaign_id`, `rule`, `action`) |
| P4-10 | Prometheus counters: `campaign_rules_triggered_total` |

### 6.5 Acceptance criteria

- [ ] Content campaign auto-generates on schedule when active
- [ ] Growth campaign never modifies accounts outside `campaign_accounts`
- [ ] Engagement type renamed or documented as manual-only

---

## 7. Testing strategy

### Distribution Engine (`distribution-engine/tests/`)

```
campaignRouter.test.js
  - create validates all account_ids
  - list scoped to campaign_accounts
  - patch status rejects invalid enum
  - get by id 403 out of scope

campaignManager.test.js
  - growth rule increases posts_per_day when ER high
  - growth rule skips paused campaigns
  - content schedule triggers job creation (mock CF)
```

### Dashboard

```
tests/e2e/campaigns.spec.ts
  - create campaign
  - generate opens job (mock API or staging)
  - detail page loads
```

### CI

- Add campaign tests to existing `ci.yml` DE job (already runs pytest for CF; extend Node test step if present)

---

## 8. Documentation updates

| Doc | Update |
|-----|--------|
| [user-guide.md](../guides/user-guide.md) | Page 10 — match UI |
| [delivery-status.md](../project-status/delivery-status.md) | Campaigns % after each phase |
| [content-api-report.md](../architecture/content-api-report.md) | `campaign_id` on jobs/publications |
| New runbook | `docs/runbooks/campaigns-operator.md` — create, generate, monitor, pause |

---

## 9. Timeline estimate

| Phase | Duration | Cumulative maturity |
|-------|----------|---------------------|
| Phase 1 | 3–5 days | ~60% |
| Phase 2 | 5–8 days | ~72% |
| Phase 3 | 5 days | ~82% |
| Phase 4 | 10–15 days | ~90% |

**Suggested first sprint (2 weeks):** Phase 1 + Phase 2 core (detail page + RBAC).

---

## 10. Open questions

1. **Single vs multi-account default:** Should create require exactly one primary account?
2. **Completed campaigns:** Auto-complete when all jobs published, or manual only?
3. **Campaign budgets:** API cost caps per campaign (Generation Studio spend)?
4. **Calendar integration:** Should scheduled content campaigns write to `/calendar`?

Resolve in PM review before Phase 4.

---

## 11. File map (implementation touchpoints)

```
infra/
  V0XX_campaign_accounts.sql          Phase 2

distribution-engine/
  src/managers/campaignRouter.js      Phases 2–3
  src/automation/CampaignManager.js   Phase 4
  tests/campaignRouter.test.js        Phases 2–4

content-factory/
  src/api/generation_jobs.py          Phase 3 (campaign_id trace)
  publications metadata               Phase 3

dashboard/
  src/app/campaigns/page.tsx          Phase 1–2 refactor
  src/app/campaigns/[id]/page.tsx     Phase 2
  src/components/campaigns/*          Phases 2–3
  src/lib/api.ts                      Phases 2–3
  src/lib/i18n.ts                     Phase 1

docs/
  audits/campaigns-module-audit.md    This audit
  planning/campaigns-implementation-plan.md  This plan
```

---

## 12. Getting started

**Immediate next PR (Phase 1):**

```bash
git checkout -b fix/campaigns-phase-1-trust main
# P1-1 through P1-8
npm run build  # dashboard/
pytest         # if DE touched
```

**Tracking:** Create GitHub milestone `Campaigns v2` with labels `campaigns`, `P0`–`P3` per phase.
