# `/content` API — Full Report

**Generated:** 2026-04-13 · **Service:** Content Factory (FastAPI on port 8000)

---

## 1. Endpoint Inventory

|  #  |  Method  |                Path                | Auth |                        Description                        |
| :-: | :------: | :--------------------------------: | :--: | :-------------------------------------------------------: |
|  1  |  `POST`  |        `/content/generate`         | None | Generate a single content packet via AI (Claude + kie.ai) |
|  2  |  `POST`  |      `/content/generate/bulk`      | None |              Generate N packets concurrently              |
|  3  |  `POST`  |    `/content/generate/ab-test`     | None |      Generate 2 variants (A/B) with distinct styles       |
|  4  |  `GET`   |       `/content/queue/size`        | None |            Redis `content:ready` queue length             |
|  5  |  `GET`   |             `/content`             | None |               List all packets (paginated)                |
|  6  |  `GET`   |      `/content/{content_id}`       | None |                 Get single packet by UUID                 |
|  7  |  `PUT`   |      `/content/{content_id}`       | None |                  Full update of a packet                  |
|  8  | `PATCH`  |      `/content/{content_id}`       | None |           Partial edit (caption/hashtags only)            |
|  9  | `DELETE` |      `/content/{content_id}`       | None |                      Delete a packet                      |
| 10  |  `POST`  | `/content/{content_id}/engagement` | None |       Log engagement metrics for a published packet       |

> ⚠️ **No authentication middleware** is applied to any `/content` route. All 10 endpoints are publicly accessible.

---

## 2. Request / Response Schemas

### Input Schemas

#### `ContentGenerateRequest` — POST /generate, PUT, POST /generate/ab-test

```json
{
  "niche": "fitness",
  "type": "post",
  "target_accounts": ["account_uuid"],
  "scheduled_at": "ISO8601 | null",
  "template_id": "uuid | null",
  "campaign_id": "uuid | null"
}
```

|       Field       |     Type      | Required | Default  |                     Notes                      |
| :---------------: | :-----------: | :------: | :------: | :--------------------------------------------: |
|      `niche`      |     `str`     |    ✅    |    —     | Niche slug e.g. `fitness`, `food`, `lifestyle` |
|      `type`       |     `str`     |    ❌    | `"post"` |  One of: `post`, `story`, `reel`, `carousel`   |
| `target_accounts` |  `list[str]`  |    ✅    |    —     |          Account UUIDs to publish to           |
|  `scheduled_at`   | `str \| null` |    ❌    |  `null`  |               ISO 8601 datetime                |
|   `template_id`   | `str \| null` |    ❌    |  `null`  |              FK to `templates.id`              |
|   `campaign_id`   | `str \| null` |    ❌    |  `null`  |        Stored in `metadata.campaign_id`        |

#### `BulkGenerateRequest` — POST /generate/bulk

```json
{
  "niche": "fitness",
  "type": "post",
  "target_accounts": ["account_uuid"],
  "count": 5
}
```

#### `ContentEditRequest` — PATCH /{content_id}

```json
{
  "caption": "new caption | null",
  "hashtags": ["#tag1", "#tag2"]
}
```

#### `EngagementRequest` — POST /{content_id}/engagement

```json
{
  "likes": 100,
  "comments": 20,
  "shares": 5
}
```

Score formula: `likes + (comments × 2) + (shares × 3)`

---

### Response Schema — `ContentPacket`

All read/write endpoints return this shape:

```json
{
  "id": "uuid",
  "type": "post | story | reel | carousel",
  "caption": "AI-generated text or 'Generation in progress...'",
  "visual_url": "https://... | null",
  "visual_type": "image | video | null",
  "hashtags": ["#tag1", "#tag2"],
  "target_accounts": ["account_uuid"],
  "scheduled_at": "ISO8601 | empty string",
  "niche": "fitness",
  "status": "pending | queued | publishing | published | failed | cancelled",
  "metadata": {
    "template_id": "uuid | null",
    "campaign_id": "uuid | null",
    "variant": "original | A | B"
  },
  "created_at": "ISO8601"
}
```

---

## 3. Database Schema — `content_packets`

### Columns

|      Column       |      Type      | Nullable |       Default        |                  Notes                  |
| :---------------: | :------------: | :------: | :------------------: | :-------------------------------------: |
|       `id`        |     `UUID`     |    NO    | `uuid_generate_v4()` |               Primary key               |
|      `type`       | `VARCHAR(20)`  |    NO    |          —           |   CHECK: post, story, reel, carousel    |
|     `caption`     |     `TEXT`     |   YES    |          —           |          AI-generated caption           |
|   `visual_url`    |     `TEXT`     |   YES    |          —           |         kie.ai image/video URL          |
|   `visual_urls`   |    `JSONB`     |   YES    |         `[]`         |    Multi-image placeholder (unused)     |
|   `visual_type`   | `VARCHAR(10)`  |   YES    |          —           |         `"image"` or `"video"`          |
|    `hashtags`     |    `JSONB`     |   YES    |         `[]`         |        Array of hashtag strings         |
| `target_accounts` |    `JSONB`     |   YES    |         `[]`         |         Array of account UUIDs          |
|  `scheduled_at`   | `TIMESTAMPTZ`  |   YES    |          —           |        Publication schedule time        |
|      `niche`      | `VARCHAR(100)` |   YES    |          —           |            Niche identifier             |
|     `status`      | `VARCHAR(20)`  |   YES    |     `'pending'`      |            Lifecycle status             |
|    `metadata`     |    `JSONB`     |   YES    |         `{}`         |    Mapped as `metadata_json` in ORM     |
|     `variant`     |  `VARCHAR(5)`  |   YES    |          —           | Unused (variant info lives in metadata) |
|   `template_id`   |     `UUID`     |   YES    |          —           |           FK → `templates.id`           |
|   `created_at`    | `TIMESTAMPTZ`  |   YES    |       `now()`        |           Creation timestamp            |
|   `updated_at`    | `TIMESTAMPTZ`  |   YES    |       `now()`        |       Auto-updated via DB trigger       |

### Indexes

|                Name                |    Type    |   Column(s)    |
| :--------------------------------: | :--------: | :------------: |
|       `content_packets_pkey`       | PK / btree |      `id`      |
|    `idx_content_packets_niche`     |   btree    |    `niche`     |
| `idx_content_packets_scheduled_at` |   btree    | `scheduled_at` |
|    `idx_content_packets_status`    |   btree    |    `status`    |

### Check Constraints

- **Type:** `post`, `story`, `reel`, `carousel`
- **Status:** `pending`, `queued`, `publishing`, `published`, `failed`, `cancelled`

### Foreign Key References (incoming)

|         Table         |      FK Column      |          Relationship          |
| :-------------------: | :-----------------: | :----------------------------: |
|    `publications`     | `content_packet_id` | Published instances of content |
|    `post_metrics`     | `content_packet_id` |  Performance metrics per post  |
| `caption_performance` | `content_packet_id` |    Caption A/B test scoring    |

### Triggers

- `trigger_content_packets_updated_at` — auto-sets `updated_at` on every UPDATE

---

## 4. Live Data Statistics (as of 2026-04-13)

### Overview

|         Metric         | Value  |
| :--------------------: | :----: |
|     Total packets      | **29** |
| With caption generated |   0    |
| With visual generated  |   0    |
| With `visual_type` set |   0    |

### By Status

|  Status  | Count |  %   |
| :------: | :---: | :--: |
| `failed` |  29   | 100% |

### By Content Type

|  Type  | Count |
| :----: | :---: |
| `post` |  29   |

### By Niche

|    Niche    | Count |
| :---------: | :---: |
|  `fitness`  |  15   |
| `lifestyle` |   7   |
|   `food`    |   7   |

### Downstream Tables

|         Table         | Rows |
| :-------------------: | :--: |
|    `publications`     |  0   |
|    `post_metrics`     |  0   |
| `caption_performance` |  0   |

> ⚠️ **Root cause of 100% failure:** `ANTHROPIC_API_KEY` is not set in `.env`. Claude caption generation fails immediately, which cascades into full packet failure before kie.ai visual generation is even attempted.

---

## 5. Generation Pipeline

### Flow

```
POST /content/generate
       │
       ▼
┌─────────────────────┐
│  api/content.py     │  1. Validate request
│  generate_content() │  2. INSERT content_packet (status=pending)
│                     │  3. Return 200 immediately
└────────┬────────────┘
         │ spawn background task
         ▼
┌─────────────────────────────┐
│  generation_task.py         │
│  generate_single_content()  │
│                             │
│  Step 1: Claude caption     │──▶ anthropic_service.py → generate_caption()
│  Step 2: Dedup check        │──▶ 80% similarity threshold vs last 50 packets
│  Step 3: kie.ai visual      │──▶ kie_service.py → generate_image() or generate_video()
│  Step 4: UPDATE DB          │──▶ status = "queued", caption, hashtags, visual_url, visual_type
│  Step 5: LPUSH Redis        │──▶ content:ready queue
└─────────────────────────────┘
         │
         ▼ Redis BRPOP
┌─────────────────────────────┐
│  distribution-engine        │
│  redis.js → consumeQueue()  │
│                             │
│  Route by visual_type:      │
│  ├── "video" or reel        │──▶ PublishingWorker.publishReel() [stub]
│  └── "image" or other       │──▶ InstagramBot.publishContent()
└─────────────────────────────┘
```

### Visual Generation Routing (kie.ai)

| Content Type |   kie.ai Method    |   Aspect Ratio    | `visual_type` |
| :----------: | :----------------: | :---------------: | :-----------: |
|    `post`    | `generate_image()` |        1:1        |   `"image"`   |
|  `carousel`  | `generate_image()` |        1:1        |   `"image"`   |
|   `story`    | `generate_image()` |       9:16        |   `"image"`   |
|    `reel`    | `generate_video()` | — (duration: 15s) |   `"video"`   |

### Key Files

|    Component    |                          File                           |                     Entry Point                     |
| :-------------: | :-----------------------------------------------------: | :-------------------------------------------------: |
|   API Router    |          `content-factory/src/api/content.py`           |               `router = APIRouter()`                |
| Background Task |    `content-factory/src/services/generation_task.py`    |             `generate_single_content()`             |
|   Caption AI    |   `content-factory/src/services/anthropic_service.py`   |        `AnthropicService.generate_caption()`        |
|    Visual AI    |      `content-factory/src/services/kie_service.py`      | `KieService.generate_image()` / `.generate_video()` |
|  CRUD Service   |    `content-factory/src/services/content_service.py`    |               `ContentService` class                |
|    DB Model     |         `content-factory/src/models/content.py`         |                `ContentPacket(Base)`                |
|   Redis Push    |           `content-factory/src/core/redis.py`           |                  `push_to_queue()`                  |
| Queue Consumer  |         `distribution-engine/src/core/redis.js`         |                  `consumeQueue()`                   |
|    Publisher    | `distribution-engine/src/publisher/PublishingWorker.js` |                  `processPacket()`                  |

---

## 6. Queue Payload — `content:ready`

The JSON payload pushed to Redis and consumed by the distribution engine:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "post",
  "caption": "AI-generated caption text...",
  "visual_url": "https://api.kie.ai/assets/...",
  "visual_type": "image",
  "hashtags": ["#fitness", "#workout", "#motivation"],
  "target_accounts": ["account-uuid-1", "account-uuid-2"],
  "scheduled_at": "2026-04-13T10:00:00+00:00",
  "niche": "fitness",
  "status": "queued",
  "metadata": {
    "template_id": null,
    "campaign_id": null,
    "variant": "original"
  },
  "created_at": "2026-04-13T09:55:00+00:00"
}
```

**Producer:** `content-factory` → `LPUSH content:ready`  
**Consumer:** `distribution-engine` → `BRPOP content:ready` (concurrency: `MAX_CONCURRENT_WORKERS`, default 3)

---

## 7. Status Lifecycle

```
pending ──▶ queued ──▶ publishing ──▶ published
   │           │            │
   │           │            └──▶ failed (retryable → retrying → retry loop)
   │           │                       └──▶ permanently_failed
   │           └──▶ cancelled
   └──▶ failed (generation error)
```

|    Status    |        Set By         |                      Where                      |
| :----------: | :-------------------: | :---------------------------------------------: |
|  `pending`   |     API endpoint      |   On `POST /generate` — packet created in DB    |
|   `queued`   |    Background task    | After AI generation succeeds, before Redis push |
| `publishing` |  Distribution engine  |    When PublishingWorker picks up the packet    |
| `published`  |     InstagramBot      |       After successful Playwright publish       |
|   `failed`   | Background task / Bot |      On generation error or publish error       |
| `cancelled`  |        Manual         |         Not implemented yet — reserved          |

---

## 8. Known Issues

### 🔴 Critical

|  #  |                 Issue                  |      Location       |                         Impact                          |
| :-: | :------------------------------------: | :-----------------: | :-----------------------------------------------------: |
|  1  |      `ANTHROPIC_API_KEY` not set       |       `.env`        | All generation fails — 29/29 packets stuck as `failed`  |
|  2  | No authentication on `/content` routes |  `api/content.py`   | Public write access to generation, deletion, engagement |
|  3  |      Dead import `OpenAIService`       | `api/content.py:13` |        Unused import — OpenAI replaced by kie.ai        |

### 🟡 Moderate

|  #  |                    Issue                     |             Location              |                        Impact                        |
| :-: | :------------------------------------------: | :-------------------------------: | :--------------------------------------------------: |
|  4  | Bulk/AB-test responses missing `visual_type` | `api/content.py:137-147, 198-208` |     Manual dict construction skips the new field     |
|  5  |            No pagination metadata            |          `GET /content`           |  No `total_count` — clients can't paginate properly  |
|  6  |             No ordering on list              |          `GET /content`           | Returns in DB insertion order, not `created_at DESC` |
|  7  |         `visual_urls` column unused          |        `models/content.py`        |   JSONB column exists but nothing reads/writes it    |
|  8  |           `variant` column unused            |        `models/content.py`        |    Variant info stored in `metadata_json` instead    |
|  9  |           Engagement uses raw SQL            |     `api/content.py:367-370`      |               Bypasses ORM validation                |

### 🟢 Minor

|  #  |                            Issue                             |        Location         |                  Impact                   |
| :-: | :----------------------------------------------------------: | :---------------------: | :---------------------------------------: |
| 10  |               Docstring still mentions DALL-E                |   `api/content.py:66`   |       Cosmetic — should say kie.ai        |
| 11  | `ContentService.update_packet` uses `flush()` not `commit()` | `content_service.py:27` | Works because callers commit, but fragile |

---

## 9. Environment Variables

|       Variable       |          Required For          |              Current Status              |
| :------------------: | :----------------------------: | :--------------------------------------: |
| `ANTHROPIC_API_KEY`  |  Caption generation (Claude)   |              ❌ **Not set**              |
|    `KIE_API_KEY`     |   Visual generation (kie.ai)   |            ❌ Not set (empty)            |
|   `OPENAI_API_KEY`   | Legacy DALL-E (no longer used) |                 Not set                  |
| `CONTENT_QUEUE_NAME` |        Redis queue name        | ✅ `"content:ready"` (default in config) |
|    `DATABASE_URL`    |     PostgreSQL connection      |        ✅ Set via docker-compose         |
|     `REDIS_URL`      |        Redis connection        |        ✅ Set via docker-compose         |

---

## 10. Migration History

|    Revision    |              Description               |    Date    |
| :------------: | :------------------------------------: | :--------: |
| `18dee1761371` |             Initial schema             |     —      |
| `a1b2c3d4e5f6` |            Add alerts table            |     —      |
| `b2c3d4e5f6g7` |         Add variant engagement         |     —      |
| `c3d4e5f6g7h8` |            Add users table             |     —      |
| `d4e5f6g7h8i9` |       Add verification sessions        |     —      |
| `e5f6g7h8i9j0` | Add multi-tenant (orgs, subscriptions) | 2026-03-18 |
| `f6g7h8i9j0k1` |      **Add `visual_type` column**      | 2026-04-13 |
