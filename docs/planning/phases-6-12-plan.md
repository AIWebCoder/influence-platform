# Influence Platform — Phases 6-12 Implementation Plan

**Project:** Influence Platform  
**Current Status:** Phase 11 Complete  
**Document Version:** 1.1  
**Date:** March 13, 2026

---

## Executive Summary

This document outlines the implementation plan for Phases 6-12, covering production hardening, security, observability, AI optimization, automation intelligence, data analytics, and scaling.

**Total Phases:** 7  
**Total Tasks:** ~50+  
**Estimated Timeline:** 8-12 weeks

---

## Phase 6 — Production Hardening

### Purpose
Add safety guards to prevent Instagram automation detection and account bans.

### Tasks

| Task ID |           Title            |                                Description                                |                        Files                        |
| :-----: | :------------------------: | :-----------------------------------------------------------------------: | :-------------------------------------------------: |
|   6.1   | Action Caps Implementation | Add per-action limits (likes, follows, DMs, comments) per account per day |   `distribution-engine/src/core/actionLimits.js`    |
|   6.2   |      Cooldown Timers       |               Implement enforced wait times between actions               |  `distribution-engine/src/core/cooldownManager.js`  |
|   6.3   |  Safety Guard Middleware   |          Add pre-action validation for all Instagram operations           | `distribution-engine/src/middleware/safetyGuard.js` |
|   6.4   | Account Health Thresholds  |               Auto-reduce activity when health score drops                | `distribution-engine/src/managers/WarmupManager.js` |
|   6.5   |    Action Randomization    |         Add random delays and variations to mimic human behavior          |    `distribution-engine/src/utils/humanizer.js`     |
|   6.6   |   Daily Action Tracking    |                Track all actions in database for analysis                 |            New table: `account_actions`             |

### Implementation Order
1. Create `account_actions` table in `infra/init.sql`
2. Implement ActionLimits class
3. Add CooldownManager
4. Integrate into PublishingWorker
5. Add humanizer utilities
6. Test with mock accounts

---

## Phase 7 — Security

### Purpose
Implement enterprise-grade security with role-based access control.

### Tasks

| Task ID |           Title           |                Description                |                      Files                      |
| :-----: | :-----------------------: | :---------------------------------------: | :---------------------------------------------: |
|   7.1   | Role-Based Access Control |   Define roles: admin, operator, viewer   |       `content-factory/src/core/rbac.py`        |
|   7.2   |    JWT Refresh Tokens     |     Implement token refresh mechanism     |     `content-factory/src/core/security.py`      |
|   7.3   |     API Rate Limiting     | Add per-user rate limits to all endpoints | `content-factory/src/middleware/rateLimiter.py` |
|   7.4   |  Environment Validation   | Fail startup if critical env vars missing |      `content-factory/src/core/config.py`       |
|   7.5   |      Password Policy      |         Enforce strong passwords          |     `content-factory/src/core/security.py`      |
|   7.6   |       Audit Logging       |           Log all admin actions           |             New table: `audit_logs`             |

### Implementation Order
1. Update `users` table with roles
2. Implement RBAC decorators
3. Add refresh token logic
4. Add rate limiting middleware
5. Enhance config validation
6. Create audit log table

---

## Phase 8 — Observability

### Purpose
Comprehensive monitoring and alerting for production operations.

### Tasks

| Task ID |           Title            |            Description            |                       Files                       |
| :-----: | :------------------------: | :-------------------------------: | :-----------------------------------------------: |
|   8.1   | Publishing Success Metrics |    Track success/failure rates    |     `distribution-engine/src/core/metrics.js`     |
|   8.2   |   Account Login Metrics    |  Track Instagram login failures   | `distribution-engine/src/metrics/loginMetrics.js` |
|   8.3   |   Proxy Failure Metrics    |  Track proxy health and failures  | `distribution-engine/src/metrics/proxyMetrics.js` |
|   8.4   |   Queue Backlog Metrics    |   Track pending content backlog   | `distribution-engine/src/metrics/queueMetrics.js` |
|   8.5   |     Grafana Dashboards     |   Create operational dashboards   |            `infra/grafana/dashboards/`            |
|   8.6   |      Alerting System       | Slack/Discord webhook integration |  `content-factory/src/services/alertWebhook.py`   |

### Implementation Order
1. Expand metrics.js with new metrics
2. Add metric recording to relevant services
3. Create Grafana dashboard JSON
4. Implement alerting webhook service
5. Configure Prometheus alerts

---

## Phase 9 — AI Optimization

### Purpose
Improve AI-generated content through feedback loops and A/B testing.

### Tasks

| Task ID |           Title            |                Description                 |                       Files                        |
| :-----: | :------------------------: | :----------------------------------------: | :------------------------------------------------: |
|   9.1   |      Caption Scoring       | Score generated captions before publishing |  `content-factory/src/services/captionScorer.py`   |
|   9.2   | Engagement Metrics Storage |     Store detailed engagement per post     |             New table: `post_metrics`              |
|   9.3   |     A/B Test Framework     |      Track Variant A vs B performance      |   `content-factory/src/services/abTestEngine.py`   |
|   9.4   |    Prompt Feedback Loop    | Analyze top performers to improve prompts  | `content-factory/src/services/promptOptimizer.py`  |
|   9.5   |  Content Type Performance  |    Compare post/story/reel performance     | `content-factory/src/services/contentAnalytics.py` |

### Implementation Order
1. Create `post_metrics` table
2. Implement caption scorer
3. Add engagement logging endpoint
4. Build A/B test tracking
5. Create prompt optimization service

---

## Phase 10 — Automation Intelligence

### Purpose
Smart automation that adapts based on data and account health.

### Tasks

| Task ID |           Title            |                Description                 |                           Files                           |
| :-----: | :------------------------: | :----------------------------------------: | :-------------------------------------------------------: |
|  10.1   |    Smart Posting Times     |     ML-based optimal posting schedule      |   `distribution-engine/src/services/smartScheduler.js`    |
|  10.2   |   Engagement Prediction    | Predict post performance before publishing | `distribution-engine/src/services/engagementPredictor.js` |
|  10.3   | Auto-Frequency Adjustment  |    Dynamically adjust posting frequency    | `distribution-engine/src/services/frequencyOptimizer.js`  |
|  10.4   |  Health-Based Publishing   |  Skip publishing for low-health accounts   |   `distribution-engine/src/services/healthPublisher.js`   |
|  10.5   | Trending Hashtag Detection |   Recommend trending hashtags per niche    |    `content-factory/src/services/trendingDetector.py`     |

### Implementation Order
1. Collect historical posting data
2. Implement smart scheduler with time-based analysis
3. Build engagement prediction model
4. Add frequency auto-adjustment
5. Integrate health-based publishing logic

---

## Phase 11 — Data Analytics

### Purpose
Comprehensive analytics infrastructure for business insights.

### Tasks

| Task ID |           Title           |                Description                |                    Files                     |
| :-----: | :-----------------------: | :---------------------------------------: | :------------------------------------------: |
|  11.1   |    Post Metrics Table     |    Track likes, comments, reach, saves    |    `infra/init.sql` - add `post_metrics`     |
|  11.2   |   Account Actions Table   |    Track likes, follows, DMs, comments    |   `infra/init.sql` - add `account_actions`   |
|  11.3   |  Proxy Performance Table  | Track proxy response times, success rates |  `infra/init.sql` - add `proxy_performance`  |
|  11.4   | Caption Performance Table |   Track caption variants and engagement   | `infra/init.sql` - add `caption_performance` |
|  11.5   |       Analytics API       |      Endpoints for dashboard charts       |    `content-factory/src/api/analytics.py`    |
|  11.6   |  Performance Dashboards   |        Visual analytics in Grafana        |         `infra/grafana/dashboards/`          |

### Implementation Order
1. Add all new tables to init.sql
2. Create migration for existing data
3. Implement analytics API endpoints
4. Create Grafana dashboards
5. Add export functionality

---

## Phase 12 — Scaling

### Purpose
Prepare platform for 500+ accounts with horizontal scaling.

### Tasks

| Task ID |         Title          |            Description             |                        Files                         |
| :-----: | :--------------------: | :--------------------------------: | :--------------------------------------------------: |
|  12.1   |   Horizontal Workers   |      Multiple queue consumers      |          `distribution-engine/src/workers/`          |
|  12.2   |     Priority Queue     |  High/medium/low priority content  |   `distribution-engine/src/core/priorityQueue.js`    |
|  12.3   |  Proxy Load Balancer   | Distribute requests across proxies | `distribution-engine/src/proxy/proxyLoadBalancer.js` |
|  12.4   |   Worker Autoscaling   |       K8s HPA configuration        |                    `k8s/hpa.yaml`                    |
|  12.5   | Database Read Replicas |        Offload read queries        |              `docker-compose.prod.yml`               |
|  12.6   |    Redis Clustering    |    High availability for queue     |               `infra/redis-cluster.js`               |

### Implementation Order
1. Implement priority queue system
2. Create worker orchestration
3. Add proxy load balancer
4. Create K8s manifests
5. Configure read replicas
6. Set up Redis cluster

---

## Required Files Summary

### New Files to Create

```
infra/init.sql                          # Add new tables
content-factory/src/
├── src/core/actionLimits.py            # Phase 6
├── src/core/rbac.py                    # Phase 7
├── src/core/cooldownManager.py         # Phase 6
├── src/middleware/rateLimiter.py       # Phase 7
├── src/middleware/safetyGuard.py       # Phase 6
├── src/services/
│   ├── captionScorer.py                # Phase 9
│   ├── abTestEngine.py                 # Phase 9
│   ├── promptOptimizer.py              # Phase 9
│   ├── contentAnalytics.py             # Phase 9
│   ├── trendingDetector.py             # Phase 10
│   ├── alertWebhook.py                 # Phase 8
│   └── promptOptimizer.py              # Phase 10
├── src/metrics/                        # Phase 8
└── src/api/analytics.py                # Phase 11

distribution-engine/src/
├── src/core/
│   ├── actionLimits.js                 # Phase 6
│   ├── cooldownManager.js              # Phase 6
│   ├── priorityQueue.js                # Phase 12
│   └── metrics.js                      # Expand - Phase 8
├── src/metrics/
│   ├── loginMetrics.js                 # Phase 8
│   ├── proxyMetrics.js                 # Phase 8
│   └── queueMetrics.js                 # Phase 8
├── src/services/
│   ├── smartScheduler.js               # Phase 10
│   ├── engagementPredictor.js          # Phase 10
│   ├── frequencyOptimizer.js           # Phase 10
│   └── healthPublisher.js              # Phase 10
├── src/proxy/
│   └── proxyLoadBalancer.js            # Phase 12
├── src/workers/
│   ├── worker1.js                      # Phase 12
│   └── worker2.js                      # Phase 12
├── src/middleware/
│   └── safetyGuard.js                  # Phase 6
└── src/utils/
    └── humanizer.js                    # Phase 6

infra/
├── grafana/dashboards/
│   ├── operations.json                 # Phase 8
│   ├── analytics.json                  # Phase 11
│   └── scaling.json                    # Phase 12

k8s/
├── hpa.yaml                            # Phase 12
├── deployment.yaml                     # Phase 12
└── service.yaml                        # Phase 12
```

### Files to Modify

```
infra/init.sql                            # Add new tables
content-factory/src/core/config.py        # Phase 7
content-factory/src/core/security.py      # Phase 7
content-factory/src/main.py               # Add middleware
content-factory/requirements.txt          # Add new deps
distribution-engine/src/core/metrics.js   # Phase 8
distribution-engine/package.json          # Add new deps
docker-compose.prod.yml                   # Phase 12
```

---

## Execution Order

```
Phase 6 (Week 1-2)
    └── Production Hardening
        ├── 6.1-6.3 (Foundation)
        └── 6.4-6.6 (Advanced)

Phase 7 (Week 2-3)
    └── Security
        ├── 7.1-7.3 (Core)
        └── 7.4-7.6 (Advanced)

Phase 8 (Week 3-4)
    └── Observability
        ├── 8.1-8.3 (Metrics)
        └── 8.4-8.6 (Alerting)

Phase 9 (Week 4-5)
    └── AI Optimization
        ├── 9.1-9.2 (Foundation)
        └── 9.3-9.5 (Intelligence)

Phase 10 (Week 5-6)
    └── Automation Intelligence
        ├── 10.1-10.3 (Prediction)
        └── 10.4-10.5 (Optimization)

Phase 11 (Week 6-7)
    └── Data Analytics
        ├── 11.1-11.3 (Tables)
        └── 11.4-11.6 (API & Dashboards)

Phase 12 (Week 7-8+)
    └── Scaling
        ├── 12.1-12.3 (Foundation)
        └── 12.4-12.6 (Production)
```

---

## Dependencies Between Phases

```
Phase 6 ──┬──> Phase 7
           │         │
           │         └──> Phase 8
           │
           └──────────> Phase 9
                        │
                        └──> Phase 10
                                 │
                                 └──> Phase 11
                                          │
                                          └──> Phase 12
```

**Note:** Some tasks can run in parallel where dependencies allow.

---

## Database Schema Additions

```sql
-- Phase 6: Account Actions
CREATE TABLE account_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id),
    action_type VARCHAR(20) NOT NULL, -- like, follow, comment, dm, post
    target_id VARCHAR(255),
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Phase 9: Post Metrics
CREATE TABLE post_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_packet_id UUID REFERENCES content_packets(id),
    account_id UUID REFERENCES accounts(id),
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    engagement_score INTEGER,
    recorded_at TIMESTAMP DEFAULT NOW()
);

-- Phase 11: Proxy Performance
CREATE TABLE proxy_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proxy_id UUID REFERENCES proxies(id),
    response_time_ms INTEGER,
    success BOOLEAN,
    error_message TEXT,
    checked_at TIMESTAMP DEFAULT NOW()
);

-- Phase 11: Caption Performance
CREATE TABLE caption_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_packet_id UUID REFERENCES content_packets(id),
    variant VARCHAR(5), -- A or B
    engagement_score INTEGER,
    posted_at TIMESTAMP,
    performance_category VARCHAR(20) -- top, average, poor
);

-- Phase 7: Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints to Add

### Content Factory

| Method |               Path               | Phase |
| :----: | :------------------------------: | :---: |
|  GET   |      /analytics/engagement       |  11   |
|  GET   | /analytics/accounts/{id}/actions |  11   |
|  POST  |     /analytics/caption/score     |   9   |
|  GET   |       /analytics/ab-tests        |   9   |
|  POST  |       /analytics/ab-tests        |   9   |
|  GET   |       /analytics/trending        |  10   |
|  POST  |         /webhooks/alerts         |   8   |

### Distribution Engine

| Method |          Path          | Phase |
| :----: | :--------------------: | :---: |
|  GET   |  /metrics/publishing   |   8   |
|  GET   |     /metrics/proxy     |   8   |
|  GET   |     /metrics/queue     |   8   |
|  POST  |     /actions/track     |   6   |
|  GET   | /scheduler/smart-times |  10   |
|  GET   |   /health/prediction   |  10   |

---

## Technology Additions

| Phase |    Technology     |      Purpose       |
| :---: | :---------------: | :----------------: |
|   6   |  Humanizer utils  |   Anti-detection   |
|   7   |      bcrypt       |  Password hashing  |
|   8   |    node-fetch     |   Webhook calls    |
|   9   | simple-statistics |    A/B analysis    |
|  10   |     ml-matrix     | Prediction models  |
|  11   |     chart.js      | Data visualization |
|  12   |   redis-cluster   |      Queue HA      |

---

*Document prepared for development team execution*  
*Last Updated: March 13, 2026*
