# Influence Platform — Antigravity Task Prompts
**HAVET DIGITAL | March 2026 | Confidentiel**

> 5 phases — 24 tasks — Each task includes a ready-to-paste prompt for Antigravity

---

## PHASE 1 — Critical Fixes — Production Blockers
> Priority: **IMMEDIATE** | Est. 1–2 days

These tasks must be done before any real usage. They are security issues and runtime bugs that will break the platform in production.

---

### Task 1.1 — Fix hardcoded admin credentials
**Priority:** CRITICAL | **Effort:** 2h

**Prompt for Antigravity:**
```
In the Content Factory (Python FastAPI), the authentication file auth.py contains hardcoded credentials (admin/admin123). Fix this properly:

1. Move credentials to environment variables using python-dotenv
2. Add ADMIN_USERNAME and ADMIN_PASSWORD to the .env file and .env.example
3. Update auth.py to read from os.environ
4. Hash the password using bcrypt (passlib is already installed)
5. Update docker-compose.yml to pass these env vars to the container
6. Test that login still works after the change

Do NOT break the existing JWT flow. Only change how credentials are stored and verified.
```

---

### Task 1.2 — Create missing alerts database table
**Priority:** CRITICAL | **Effort:** 3h

**Prompt for Antigravity:**
```
The Distribution Engine ban monitor references an `alerts` table in PostgreSQL that does not exist. This causes runtime errors when accounts are banned or shadowbanned.

1. Add an Alembic migration to create the alerts table with columns:
   - id (UUID PK)
   - account_id (UUID FK to accounts)
   - type (VARCHAR: ban/shadowban/warning)
   - message (TEXT)
   - created_at (TIMESTAMP)
   - is_read (BOOLEAN default false)
2. Add the corresponding SQLAlchemy model in the Content Factory models
3. Add a GET /alerts and POST /alerts/read/{id} endpoint in the Content Factory API
4. Run the migration and verify the table is created
5. Test that the ban monitor can now write to it without errors
```

---

### Task 1.3 — Fix CORS to allow production domains
**Priority:** CRITICAL | **Effort:** 1h

**Prompt for Antigravity:**
```
The Content Factory FastAPI backend currently only allows CORS from localhost:3000. This blocks any staging or production deployment.

1. Update the CORS configuration in main.py to read allowed origins from an environment variable ALLOWED_ORIGINS (comma-separated)
2. Default to localhost:3000 if the env var is not set
3. Add ALLOWED_ORIGINS to .env.example with a comment explaining the format
4. Update docker-compose.yml to pass this variable
5. Test that the dashboard still works and that a request from a different origin is correctly blocked when not in the list
```

---

## PHASE 2 — Complete Partial Features
> Priority: **HIGH** | Est. 3–5 days

These features exist in the codebase but are not fully wired or enforced. They are required for the platform to function as described in the spec.

---

### Task 2.1 — Wire DALL-E image generation end-to-end
**Priority:** HIGH | **Effort:** 4h

**Prompt for Antigravity:**
```
The DALL-E service exists in Content Factory but is not connected to the content generation pipeline. Content is currently published without images.

1. Review the existing DALL-E service file and identify where the integration stops
2. In the content generation endpoint (POST /content/generate), after generating the caption, call the DALL-E service with the visual_prompt from the template
3. Store the returned image URL in the content_packet.visual_url field
4. If DALL-E fails (rate limit / API error), fall back gracefully and set visual_url to null — do NOT block the caption from being queued
5. Add OPENAI_API_KEY to .env.example if not already there
6. Test end-to-end: generate a content packet for niche "fitness" and confirm visual_url is populated in the database
```

---

### Task 2.2 — Complete and enforce dynamic rate limiting
**Priority:** HIGH | **Effort:** 5h

**Prompt for Antigravity:**
```
The Distribution Engine has rate limiting logic but it is not fully enforced. This is a HIGH risk because insufficient rate limiting triggers Instagram bans.

1. Review the existing rate limiting code in the Distribution Engine
2. Enforce the following limits per account:
   - Max 3 posts per day for accounts in "warming" status
   - Max 8 posts per day for "active" accounts
   - Minimum 90 minutes between consecutive posts
3. Before each publish attempt in the publishing worker, check the account's daily_post_count and last_activity fields
4. If the rate limit is exceeded, do NOT discard the content — push it back to the Redis queue with a delay of 2 hours using a delayed queue pattern
5. Log every rate-limit block with the account_id and the reason
6. Add a unit test for the rate limiting logic
```

---

### Task 2.3 — Optimize proxy rotation and sticky sessions
**Priority:** HIGH | **Effort:** 4h

**Prompt for Antigravity:**
```
Proxy rotation is basic and needs to be optimized. Instagram detects accounts that suddenly switch IPs.

1. Implement sticky proxy assignment: once a proxy is assigned to an account, it should NOT rotate unless the proxy fails health check
2. Add a proxy health check job: every 30 minutes, test each proxy with a lightweight HTTP request and mark it inactive if it fails
3. Only assign a new proxy to an account when:
   a. Its assigned proxy fails health check, or
   b. The account has no proxy assigned
4. Update the Account Manager to expose GET /proxies/health showing the status of each proxy
5. Add logic to write to the alerts table when fewer than 20% of proxies are healthy
```

---

### Task 2.4 — Complete A/B test result tracking
**Priority:** MEDIUM | **Effort:** 5h

**Prompt for Antigravity:**
```
The Content Factory can generate A/B variants but does not track which variant performed better. The results tracking is missing.

1. Add a variant field (A or B) to the content_packets table via Alembic migration
2. Add an engagement_score field (INTEGER, nullable) to the publications table
3. Create a POST /content/{id}/engagement endpoint that accepts { likes, comments, shares } and computes:
   engagement_score = likes + (comments * 2) + (shares * 3)
4. In the Dashboard campaigns page, after a content packet is published, add a small "Log Engagement" form next to each published item that calls this endpoint
5. On the analytics page, add a simple A vs B comparison card showing average engagement_score for variant A vs variant B across the last 30 published packets
```

---

### Task 2.5 — Wire and display alerts in Dashboard
**Priority:** HIGH | **Effort:** 3h

**Prompt for Antigravity:**
```
The alerts table (created in Task 1.2) needs to be surfaced in the Dashboard so the operator can see ban and health warnings in real time.

1. In the Dashboard header/navbar, add an alert bell icon (use lucide-react BellIcon) with a red badge showing the count of unread alerts
2. Clicking the bell opens a dropdown panel showing the last 10 alerts, each with:
   - Account username
   - Alert type (ban/shadowban/warning)
   - Message
   - Timestamp
3. Add a "Mark as read" button on each alert that calls POST /alerts/read/{id}
4. Poll the alerts endpoint every 60 seconds using setInterval to keep the count fresh
5. If there are any unread CRITICAL alerts (type: ban), show a red banner at the top of the page
```

---

## PHASE 3 — Missing MVP Features
> Priority: **MEDIUM** | Est. 4–6 days

These features were in the original spec for the MVP but were not implemented. They are needed for the platform to be usable by a non-technical operator.

---

### Task 3.1 — Build Instagram mobile content preview
**Priority:** MEDIUM | **Effort:** 4h

**Prompt for Antigravity:**
```
Content creators need to preview how a generated post will look on Instagram before it is published. Currently there is no preview at all.

1. In the Content Planner page (/content), after a content packet is generated, show a preview card on the right side
2. The preview should look like an Instagram post:
   - Circular avatar placeholder at top left
   - Username
   - Image (visual_url if set, else a gray placeholder with text "Visual en cours de génération")
   - Caption text
   - Hashtags displayed in gray
   - Row of action icons (heart, comment, share) at the bottom
3. Use Tailwind CSS to style it. The card should have a max-width of 375px to simulate a mobile screen
4. Add a "Copy caption" button that copies the caption + hashtags to clipboard
```

---

### Task 3.2 — Build drag-and-drop content editor
**Priority:** MEDIUM | **Effort:** 5h

**Prompt for Antigravity:**
```
The spec calls for a visual content editor. A simplified version should let operators edit AI-generated captions before they are queued.

1. In the Content Planner page, after generation, make the caption in the generated content card editable (use a contentEditable div or a textarea)
2. Add a character counter showing remaining characters (Instagram caption limit: 2200)
3. Add a hashtag editor:
   - Display hashtags as removable chips/pills
   - Clicking the X on a chip removes that hashtag
   - Add a text input to add new hashtags
4. Add a "Save edits & queue" button that saves the edited caption and hashtags back to the content_packet via PUT /content/{id} before pushing to the Redis queue
5. Add a PUT /content/{id} endpoint in the Content Factory API that accepts { caption, hashtags } and updates the record
```

---

### Task 3.3 — Set up GitHub Actions CI/CD pipeline
**Priority:** MEDIUM | **Effort:** 3h

**Prompt for Antigravity:**
```
The spec called for GitHub Actions CI/CD. Tests exist but are not integrated into any pipeline.

1. Create .github/workflows/ci.yml that triggers on push to main and on pull requests
2. The pipeline should have three jobs running in parallel:
   a. test-content-factory: run pytest in the Python service
   b. test-distribution-engine: run npm test in the Node.js service
   c. lint: run eslint on the Next.js dashboard
3. Add a docker-build job that runs after all tests pass and builds both Docker images to confirm they build without errors
4. Add a .env.test file (committed, with fake/placeholder keys) used specifically for CI
5. Add a README badge showing the CI status
```

---

## PHASE 4 — Infrastructure & Security Hardening
> Priority: **MEDIUM** | Est. 2–3 days

These tasks make the platform production-ready and observable. They are not blockers for first use but are required before scaling.

---

### Task 4.1 — Add Sentry error tracking to all three services
**Priority:** MEDIUM | **Effort:** 4h

**Prompt for Antigravity:**
```
The spec calls for Sentry monitoring. Currently there is no error tracking — failures are silent.

1. Install sentry-sdk in the Content Factory (pip install sentry-sdk --break-system-packages) and initialize it in main.py using SENTRY_DSN from environment variables
2. Install @sentry/node in the Distribution Engine and initialize in app.js
3. Install @sentry/nextjs in the Dashboard and follow the Next.js setup wizard (wrap next.config.js)
4. Add SENTRY_DSN to .env.example (leave value blank with a comment)
5. In Sentry, create one project per service and copy the DSNs to .env
6. Test by intentionally throwing an error in each service and confirming it appears in Sentry
```

---

### Task 4.2 — Add Grafana + Prometheus metrics dashboard
**Priority:** MEDIUM | **Effort:** 5h

**Prompt for Antigravity:**
```
The spec includes Grafana for observability. Add basic metrics collection.

1. Add prometheus-fastapi-instrumentator to the Content Factory to expose a /metrics endpoint
2. Add prom-client to the Distribution Engine and expose a /metrics endpoint with custom metrics:
   - queue_size (gauge)
   - publications_total (counter)
   - active_accounts (gauge)
   - ban_events_total (counter)
3. Add a prometheus service and a grafana service to docker-compose.yml
4. Create grafana/provisioning/datasources/prometheus.yml to auto-configure Prometheus as a data source
5. Create a default dashboard JSON in grafana/provisioning/dashboards/ with panels for:
   - Queue size over time
   - Publications per hour
   - Active account count
   - Ban event rate
6. Document the Grafana URL (http://localhost:3002) in the README
```

---

### Task 4.3 — Resolve dual database connection conflict
**Priority:** MEDIUM | **Effort:** 4h

**Prompt for Antigravity:**
```
Both the Content Factory and Distribution Engine connect to the same PostgreSQL instance. This can cause connection pool exhaustion and locking issues at scale.

1. Audit the current database connection settings in both services
2. Set a connection pool max of 10 for the Content Factory (SQLAlchemy pool_size=10, max_overflow=5)
3. Set a connection pool max of 10 for the Distribution Engine (pg connection pool with max: 10)
4. Add a PgBouncer service to docker-compose.yml as a connection pooler sitting between both services and PostgreSQL
5. Update both services to connect through PgBouncer (default port 6432) instead of directly to PostgreSQL port 5432
6. Test under load: run 50 concurrent content generation requests and confirm no "too many connections" errors
```

---

## PHASE 5 — V2 Preparation — Deferred Features
> Priority: **LOW** | Post-MVP sprint

These items were explicitly deferred to V2 in the spec. Include them in the next sprint after the MVP is stable in production.

---

### Task 5.1 — Multi-user support with roles
**Priority:** LOW | **Effort:** 1 day

**Prompt for Antigravity:**
```
The platform currently supports only a single admin user. Add multi-user support.

1. Add a users table via Alembic migration: id, email, hashed_password, role (admin/operator/viewer), is_active, created_at
2. Add POST /users (admin only), GET /users, DELETE /users/{id} endpoints
3. Implement role-based access:
   - admin: full access
   - operator: can manage accounts and campaigns but not users
   - viewer: read-only
4. Add a Users page to the Dashboard accessible only to admins
5. Update the login flow to use email instead of username
6. Migrate the existing hardcoded admin user to the new users table on first boot
```

---

### Task 5.2 — Kubernetes migration for scale to 500+ accounts
**Priority:** LOW | **Effort:** 2 days

**Prompt for Antigravity:**
```
The current Docker Compose setup works for MVP but will not scale to 500 accounts. Prepare the Kubernetes migration.

1. Create k8s/ directory with Deployment YAML files for: content-factory, distribution-engine, dashboard, postgres, redis
2. Add HorizontalPodAutoscaler for the distribution-engine (scale from 2 to 10 replicas based on queue size metric)
3. Add a Kubernetes CronJob for the warmup-manager that runs every hour
4. Add Kubernetes Secrets for all sensitive env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, DB credentials)
5. Create a helm/ chart wrapping all the above for easy deployment
6. Document the migration steps from Docker Compose to Kubernetes in the README
```

---

### Task 5.3 — Multi-platform support (TikTok, Twitter/X)
**Priority:** LOW | **Effort:** 3 days

**Prompt for Antigravity:**
```
The Distribution Engine currently only supports Instagram. Add TikTok and Twitter/X as publishing targets.

1. Refactor the Distribution Engine publisher into an abstract Publisher class with a publish(content_packet, account) method
2. Create InstagramPublisher, TikTokPublisher, and TwitterPublisher as concrete implementations
3. Add a platform field to the accounts table (instagram/tiktok/twitter)
4. The publishing worker should route each content_packet to the correct publisher based on the target account's platform
5. For TikTok: use Playwright to automate posting via the TikTok web interface (stealth mode)
6. For Twitter: use the Twitter API v2 (OAuth 2.0) to post tweets — add TWITTER_API_KEY and TWITTER_API_SECRET to .env.example
```

---

### Task 5.4 — PDF/Excel automated analytics reports
**Priority:** LOW | **Effort:** 1 day

**Prompt for Antigravity:**
```
Add automated report generation so clients can receive weekly performance reports.

1. Install reportlab (PDF) and openpyxl (Excel) in the Content Factory
2. Create a GET /reports/weekly?format=pdf|excel endpoint that queries publication and engagement data for the past 7 days
3. The report should include:
   - Total publications by account
   - Average engagement score by niche
   - Top 5 performing content packets
   - Ban/shadowban events
   - Account health trends
4. In the Dashboard, add a "Download Weekly Report" button on the Analytics page that triggers the download
5. Add a weekly cron job (use APScheduler in the Content Factory) that auto-generates the report every Monday at 08:00 and stores it in a reports/ directory
6. Add a GET /reports endpoint that lists available saved reports
```

---

### Task 5.5 — Advanced analytics with predictive models
**Priority:** LOW | **Effort:** 2 days

**Prompt for Antigravity:**
```
Add predictive content scoring so the platform can recommend the best posting times and content types per niche.

1. Create an analytics_events table: content_id, account_id, metric_type, value, recorded_at
2. Build a POST /analytics/ingest endpoint that the Distribution Engine calls after each publication with initial engagement data
3. After 48 hours, build a job that fetches final engagement metrics (likes/comments) via Playwright and updates the analytics_events table
4. Build a simple scoring model in Python using numpy: compute a weighted engagement score per (niche, content_type, posting_hour) combination
5. Expose GET /analytics/recommendations?niche=fitness which returns the top 3 recommended (content_type, posting_hour) pairs
6. Surface these recommendations on the Dashboard analytics page as "Recommended posting strategy" cards
```

---

*Document prepared by HAVET DIGITAL — March 2026 | Confidentiel — Ne pas diffuser sans autorisation*
