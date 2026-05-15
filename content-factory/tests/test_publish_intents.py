"""P1: publish-intent dispatch validation and idempotency."""

import pytest
from unittest.mock import AsyncMock

from src.services.publish_dispatcher import dispatch_publish_intent


class _Result:
    def __init__(self, first_value=None, scalar_value=None, rows=None):
        self._first = first_value
        self._scalar = scalar_value
        self._rows = rows or []

    def first(self):
        return self._first

    def scalar_one(self):
        return self._scalar

    def fetchall(self):
        return self._rows


@pytest.mark.asyncio
async def test_dispatch_rejects_non_public_asset_url():
    intent_id = "11111111-1111-4111-8111-111111111111"
    asset_id = "22222222-2222-4222-8222-222222222222"
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _Result(
                first_value=(
                    intent_id,
                    "ready",
                    "reel",
                    "caption",
                    "[]",
                    asset_id,
                    "33333333-3333-4333-8333-333333333333",
                )
            ),
            _Result(first_value=(asset_id, "/local/only.mp4", "video/mp4")),
        ]
    )
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    with pytest.raises(ValueError, match="public_url"):
        await dispatch_publish_intent(intent_id, db)

    db.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_dispatch_rejects_missing_instagram_credentials():
    intent_id = "11111111-1111-4111-8111-111111111111"
    asset_id = "22222222-2222-4222-8222-222222222222"
    account_id = "44444444-4444-4444-8444-444444444444"
    db = AsyncMock()
    db.execute = AsyncMock(
        side_effect=[
            _Result(
                first_value=(
                    intent_id,
                    "ready",
                    "reel",
                    "caption",
                    "[]",
                    asset_id,
                    "33333333-3333-4333-8333-333333333333",
                )
            ),
            _Result(first_value=(asset_id, "https://cdn.example.com/v.mp4", "video/mp4")),
            _Result(
                rows=[
                    ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", account_id, "instagram", "", ""),
                ]
            ),
            _Result(),
        ]
    )
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    with pytest.raises(ValueError, match="missing Instagram publish fields"):
        await dispatch_publish_intent(intent_id, db)

    db.rollback.assert_awaited()