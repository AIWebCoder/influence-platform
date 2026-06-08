# Calendar dispatch - UI preview and functional test

How to preview the Planification (/calendar) UI without database rows, and how to verify the real scheduling flow end-to-end.

## Why day cards can be empty

The calendar reads publication_intents via GET /scheduling/calendar, not generation jobs alone. A day card shows rows that have scheduled_for in the visible date range. Unscheduled draft / ready intents appear in the Awaiting slot panel at the bottom.

Empty cards usually mean:

- No publish intent was created with mode Scheduled and a future datetime, or
- The niche filter excludes every row, or
- Content Factory is unreachable (you should see a red error banner).

## Part A - UI preview (no database)

### Option 1 - Button in the UI

1. Open Planification (/calendar).
2. If the period is empty, click Show sample dispatches in the hint, or use the same control in the header.
3. Sample items appear on Mon-Sun (week view) with mixed statuses.
4. Switch to Month for extra sample rows on days 7, 14, and 21.
5. Use the Niche filter - samples filter locally.
6. Click a sample chip - Save is disabled (preview only).
7. Click Hide samples to return to live API data.

### Option 2 - Auto-load on startup

Set in .env or dashboard/.env.local:

NEXT_PUBLIC_CALENDAR_PREVIEW=true

Restart the dashboard. Samples load automatically on /calendar.

## Part B - Real functional test

### Prerequisites

- docker compose up -d
- GET http://localhost:8000/health returns 200
- NEXT_PUBLIC_CONTENT_API_URL=http://localhost:8000
- At least one IG account with ig_user_id and ig_access_token
- Optional: GENERATION_ALLOW_QUEUE_SIMULATION=true for fast Studio jobs

See docs/runbooks/operator-smoke-test.md section 2.4 and publish-instagram.md.

### Steps (dashboard)

1. Generation Studio - complete a job (or queue simulation).
2. Publish tab - mode Scheduled, datetime inside current week, select accounts, submit.
3. Open /calendar - Week view - chip on correct day.
4. Click chip, change datetime, Save - chip moves.
5. Optional: Month view, niche filter.

### API verification

curl "http://localhost:8000/scheduling/calendar?start_date=2026-06-02&end_date=2026-06-08"

curl -X PATCH "http://localhost:8000/scheduling/publish-intents/INTENT_ID/schedule" -H "Content-Type: application/json" -d "{\"scheduled_at\": \"2026-06-05T15:30:00+00:00\"}"

docker compose exec postgres psql -U ipuser -d influence_platform -c "SELECT id, status, scheduled_for, niche FROM publication_intents ORDER BY created_at DESC LIMIT 5;"

### Automated regression

docker compose exec -T content-factory pytest tests/test_publish_calendar.py tests/test_scheduling.py -q
