# Campaigns Module Audit (`/campaigns`)

**Date:** 2026-06-11  
**Scope:** Dashboard UI, Distribution Engine API, `CampaignManager` automation, DB schema, Generation Studio integration  
**Lens:** Senior PM (product, UX, strategy) + Senior Developer (architecture, security, quality)  
**Baseline:** Internal docs rate this module at **~55% complete** ([rapport-pre-release](../rapport-pre-release-influence-platform-fr.md))

**Related:** [Campaigns implementation plan](../planning/campaigns-implementation-plan.md)

---

## Executive summary

| Dimension | Grade | One-liner |
|-----------|-------|-----------|
| **Product clarity** | C+ | Positioned as an “autonomous AI engine”; reality is mostly **job grouping + one-click generate**. |
| **UX** | B− | Solid list/create flow; misleading copy and missing detail/history views. |
| **Backend API** | B− | CRUD works; weak validation and **access-control gaps** for multi-account campaigns. |
| **Automation** | D+ | Only **growth** has rules; runs every 6h; **content** and **engagement** types are inert. |
| **Integration** | B | Generation jobs link via `campaign_id`; no closed loop to publish/analytics in UI. |
| **Test coverage** | F | **No dedicated tests** for campaigns routes or `CampaignManager`. |

**Verdict:** Good **MVP shell** for “save a strategy and batch-launch reels.” Not yet a true campaign orchestration or autonomous growth product. Safe to use for content batching; do not sell automation beyond what is implemented.

---

## 1. Product audit (Senior PM)

### 1.1 Intended job-to-be-done

**What users likely expect** (from UI copy + [user guide](../guides/user-guide.md)):

> “Define a strategy → system runs it → I monitor results.”

**What the product actually delivers today:**

```
Create campaign (name, type, niche, topic, accounts)
        ↓
Manual "Generate" per row → Generation Studio jobs (reels)
        ↓
[optional background] Growth rule may bump posts_per_day if ER is high
```

So the core JTBD today is: **organize and repeat content generation across accounts**, not full autonomous marketing.

### 1.2 Strategy types — promise vs reality

| Type | UI label | User expectation | Implemented automation |
|------|----------|------------------|------------------------|
| **content** | Contenu (reach) | Auto content pipeline | ❌ No rules; manual Generate only |
| **growth** | Croissance (followers) | Auto frequency/scale | ⚠️ One rule: raise `posts_per_day` if ER > 1.5× threshold |
| **engagement** | Engagement (ROI) | Tied to `/engagement` (DMs, replies) | ❌ No link; name collides with Engagement module |

**PM issue:** Three types in the create dialog imply parity. Only **growth** does anything in the background, and lightly.

### 1.3 User journeys

#### Journey A — Create campaign ✅ (partial)

- Name, niche, topic, accounts → saved to DB.
- **Bug/UX:** Button says **“Confirmer et lancer”** but **does not launch** jobs — only creates the record.
- **Bug/UX:** Success toast uses `launchSuccess` (“Campagne lancée”) on create — **misleading**.

#### Journey B — Generate content ✅

- Dropdown → Generate → one job per account, faceless reel, `multi_scene_single_video`.
- Job IDs appended to `settings.generation_job_ids`.
- Link to Generation Studio for **last** job only.

**Gaps:**

- No progress aggregate (“3/5 jobs done”).
- No link to Publications/Queue for that campaign.
- Double-click can spawn **duplicate jobs** (no idempotency guard).

#### Journey C — Monitor campaign ❌

- API: `GET /campaigns/:id/history` exists.
- UI: **no detail page, no chart, no history table.**
- KPI strip (total / active / paused / with jobs) is list-level only.

#### Journey D — Autonomous optimization ⚠️

- Copy: *“adjust frequency, captions, times based on real-time telemetry.”*
- Reality: `CampaignManager` snapshots metrics + **only** may increase posting frequency for **growth** campaigns.
- No caption/time automation. “Real-time” = **6-hour cycle**.

### 1.4 Status model mismatch

| User guide | DB | UI |
|------------|-----|-----|
| Draft | — | ❌ Not supported |
| Active | `active` | ✅ |
| Paused | `paused` | ✅ |
| Completed | `completed` | ❌ Not in UI (can’t mark complete) |

### 1.5 Positioning in the platform

```
Generation Studio  →  create one-off content
Campaigns          →  reusable batch launcher (weak automation)
Publications/Queue →  publish pipeline
Engagement         →  comment/DM actions (separate module)
Calendar           →  scheduling
```

**PM recommendation:** Reposition Campaigns in nav/copy as **“Content strategies & batch generation”** until automation catches up. Rename or hide **engagement** type to avoid confusion with `/engagement`.

### 1.6 Success metrics (missing today)

No product metrics defined or surfaced:

- Jobs per campaign (created / completed / failed)
- Publish rate from campaign jobs
- ER / follower delta attributable to campaign
- Time-to-first-publish after Generate

Without these, operators cannot tell if a campaign “worked.”

---

## 2. UX / UI audit

### 2.1 What works well

- Clear page shell: header, KPI cards, searchable data table.
- Create modal: name, type, niche, topic, multi-account checkboxes.
- Row actions: Generate, Pause/Resume, Studio link, Delete with confirm.
- Empty state with CTA.
- i18n FR/EN largely present.
- Uses shared `DataTable` pattern (aligned with Publications, Queue).

### 2.2 UX issues

| Issue | Severity | Detail |
|-------|----------|--------|
| False “launch” on create | **High** | Modal CTA + toast imply jobs started |
| Status not localized | Medium | Table shows raw `active` / `paused` |
| Generate hidden in ⋮ menu | Medium | Primary action buried; no row-level CTA |
| Studio link = last job only | Medium | Multi-job campaigns hard to navigate |
| Notice overpromises | **High** | Autonomous adjustment copy ≠ behavior |
| No campaign detail view | **High** | Can't inspect one campaign deeply |
| `LaunchCampaignForm.tsx` | Low | **Dead code** — old `generateContent` path, unused |

### 2.3 UX pattern recommendation

Campaigns is a **list + detail** module, not a wizard:

```
/campaigns           → table + KPIs + create
/campaigns/[id]      → header, type badge, accounts, job timeline, history chart, actions
```

Aligns with Queue/Publications mental model.

---

## 3. Technical audit (Senior Developer)

### 3.1 Architecture

```
Dashboard (campaigns/page.tsx)
    → api.distribution.*  (DE :3001)
    → api.generationJobs.* (CF :8000)

Distribution Engine
    campaignRouter.js     CRUD + history
    CampaignManager.js    6h cron, growth rules only

PostgreSQL
    campaigns
    campaign_history
```

Clean separation. Weakness: **no domain service layer** — logic split between a ~480-line React page and thin routes.

### 3.2 Data model

```sql
campaigns (
  id, name, type, status,
  target_niche, target_account_id,  -- single-account FK
  settings JSONB  -- topic, account_ids[], generation_job_ids[]
)
```

**Design tension:** Multi-account campaigns store `account_ids` in JSONB but `target_account_id` is `null` when >1 account. Downstream code often reads **only** `target_account_id`.

**Schema reference:** `infra/V007_campaign_automation.sql`, `infra/V022_accounts_columns_and_campaigns.sql`

### 3.3 Security & access control — findings

#### Issue 1: Multi-account campaign visibility leak

`GET /campaigns` for scoped users:

```sql
WHERE target_account_id IS NULL OR target_account_id = ANY($1)
```

Campaigns with `target_account_id = NULL` (multi-account) are visible to **all** scoped users who have **any** account access — **not** filtered by `settings.account_ids`.

#### Issue 2: Create doesn’t verify all `account_ids`

`POST /campaigns` calls `assertAccountAccess` only for `target_account_id`. **`settings.account_ids` are not validated.**

#### Issue 3: Arbitrary status on PATCH

No enum check on `status` — client can send any string.

#### Issue 4: No campaign ownership / `created_by`

Fleet-wide campaigns with `target_account_id = null` are ambiguous for RBAC.

**Recommendation:** Add `campaign_accounts` junction table or enforce `assertAccountAccess` on every ID in `settings.account_ids`; fix list query to join on that set.

### 3.4 API gaps

| Endpoint | Gap |
|----------|-----|
| `POST /campaigns` | No schema validation (name length, type enum, required niche/topic) |
| `PATCH /campaigns/:id` | `settings` merge is blind JSONB concat — no schema |
| `GET /campaigns/:id` | **Missing** — only list + history |
| `GET /campaigns/:id/history` | Exists, **unused in UI** |

### 3.5 `CampaignManager` automation

**Runs:** On DE startup + every 6 hours (`distribution-engine/src/index.js`).

**Per active campaign:**

1. Load metrics (publications + `post_metrics` + `account_growth`)
2. Insert `campaign_history` snapshot
3. If `type === 'growth'` → maybe increase `posts_per_day`

**Gaps:**

- Ignores `settings.account_ids` — uses `target_account_id` or whole niche
- **content** / **engagement** types: no-op after snapshot
- No tie to generation jobs (doesn’t auto-trigger Generate)
- No alerting when campaign underperforms
- Metrics window: `since campaign.created_at` — no rolling window
- **No tests**

**Key files:**

- `distribution-engine/src/automation/CampaignManager.js`
- `distribution-engine/src/managers/campaignRouter.js`

### 3.6 Generation Studio integration

On Generate (`dashboard/src/app/campaigns/page.tsx`):

```typescript
api.generationJobs.create({
  execution_mode: "multi_scene_single_video",
  content_type: "reel",
  mode: "faceless",
  niche, topic, target_accounts: [accountId],
  campaign_id: campaign.id,
});
```

**Good:** `campaign_id` passed to Content Factory.  
**Missing:** UI doesn’t filter Generation Studio by campaign; no campaign filter on Queue/Publications.

### 3.7 Frontend code quality

| Area | Assessment |
|------|------------|
| `dashboard/src/app/campaigns/page.tsx` | ~480 lines — candidate to split |
| `dashboard/src/components/campaigns/campaigns-columns.tsx` | Clean, reusable |
| `dashboard/src/components/campaigns/LaunchCampaignForm.tsx` | Dead code — remove |
| Error handling | Uses `formatContentApiError` + toasts — good |
| Types | `CampaignRecord` in `api.ts` — `settings` loosely typed |
| Tests | **None** for campaigns page |

### 3.8 Observability

- Logs: `console.log` in `CampaignManager` only
- No metrics (Prometheus), no campaign-scoped traces
- No dashboard alert when Generate fails mid-loop (partial job creation possible)

### 3.9 Dead / legacy artifacts

- `LaunchCampaignForm.tsx` — calls deprecated `api.content.generateContent`, **not imported anywhere**
- User guide Page 10 — describes scheduling/goals **not in UI**
- `planning/implementation-phases.md` mentions `content-factory/src/api/campaigns.py` — **never built** (campaigns live in DE only)

---

## 4. Cross-module consistency

| Module | Relationship to Campaigns | Status |
|--------|---------------------------|--------|
| Generation Studio | Jobs created with `campaign_id` | ✅ Partial |
| Publications | No campaign filter | ❌ |
| Queue | No campaign filter | ❌ |
| Calendar | No campaign link | ❌ |
| Engagement | Separate; type name collision | ⚠️ |
| Analytics | No campaign dimension | ❌ |
| Accounts | Source of IG accounts | ✅ |

**End-to-end loop is broken in the UI:** Campaign → Generate → Publish → Measure → Optimize is only half-wired in the backend and invisible to users.

---

## 5. Test & quality checklist

| Area | Covered? |
|------|----------|
| `campaignRouter` CRUD | ❌ |
| Access control multi-account | ❌ |
| `CampaignManager` growth rule | ❌ |
| Dashboard E2E create → generate | ❌ |
| PATCH settings merge | ❌ |

**Minimum test pack:**

1. POST creates campaign; validates account access on all `account_ids`
2. GET list respects scope for multi-account campaigns
3. Growth rule triggers frequency increase when ER above threshold
4. Playwright: create campaign → generate → appears in Studio URL

---

## 6. What `/campaigns` does today (quick reference)

| Action | Works? |
|--------|--------|
| Create named strategy with accounts + topic | ✅ |
| Auto-launch on create | ❌ |
| Manual batch reel generation | ✅ |
| Pause / resume / delete | ✅ |
| View generation job in Studio | ✅ (last job) |
| View performance history | ❌ (API only) |
| Autonomous caption/time tuning | ❌ |
| Autonomous engagement | ❌ |
| Growth frequency tuning | ⚠️ (background, growth only) |

---

## 7. Audit sign-off checklist

Before marketing Campaigns as “autonomous”:

- [ ] Create flow copy matches behavior (create ≠ launch)
- [ ] RBAC fixed for multi-account campaigns
- [ ] Campaign detail + history visible in UI
- [ ] Strategy-type badges honest (manual vs automated)
- [ ] At least one E2E test for create → generate
- [ ] User guide Page 10 updated
- [ ] Engagement type renamed or wired to `/engagement`
