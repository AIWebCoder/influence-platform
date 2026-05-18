"""Shared pytest configuration for Content Factory."""

import asyncio

import pytest

# Single event loop for the whole test session — avoids asyncpg "different loop" errors
# when reusing the global SQLAlchemy engine with FastAPI's ASGITransport.
@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
