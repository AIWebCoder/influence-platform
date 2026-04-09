from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import asyncpg
import httpx


logger = logging.getLogger(__name__)


class CircuitOpenError(RuntimeError):
    pass


class DistributionApiClient:
    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: int = 15,
        auth_username: str,
        auth_password: str,
        database_url: str | None = None,
        max_retries: int = 3,
        breaker_threshold: int = 5,
        breaker_open_seconds: int = 60,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.auth_username = auth_username
        self.auth_password = auth_password
        self.database_url = database_url
        self.max_retries = max_retries
        self.breaker_threshold = breaker_threshold
        self.breaker_open_seconds = breaker_open_seconds

        self.jwt_token: str | None = None
        self._breaker_failures = 0
        self._breaker_open_until = 0.0
        self._db_pool: asyncpg.Pool | None = None

        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            headers={"Content-Type": "application/json"},
        )

    async def startup(self) -> None:
        if self.database_url:
            self._db_pool = await asyncpg.create_pool(dsn=self.database_url, min_size=1, max_size=3)
        await self.login()

    async def close(self) -> None:
        await self._client.aclose()
        if self._db_pool is not None:
            await self._db_pool.close()

    async def login(self) -> None:
        payload = {
            "username": self.auth_username,
            "password": self.auth_password,
        }
        resp = await self._client.post("/auth/login", json=payload)
        resp.raise_for_status()
        data = resp.json()
        token = data.get("access_token")
        if not token:
            raise RuntimeError("Auth login succeeded without access_token.")
        self.jwt_token = token
        self._client.headers.update({"Authorization": f"Bearer {self.jwt_token}"})
        logger.info("Distribution API auth token obtained.")

    async def get_accounts(self) -> list[dict[str, Any]]:
        resp = await self._request("GET", "/accounts")
        data = resp.json()
        return data if isinstance(data, list) else []

    async def get_campaigns(self) -> list[dict[str, Any]]:
        resp = await self._request("GET", "/campaigns")
        data = resp.json()
        if not isinstance(data, list):
            return []
        return [c for c in data if c.get("status") in {"running", "active"}]

    async def report_execute(self, account_id: str, payload: dict[str, Any]) -> None:
        resp = await self._request("POST", f"/accounts/{account_id}/execute", json=payload)
        if resp.status_code >= 400:
            logger.error(
                "Failed report_execute account=%s status=%s body=%s",
                account_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

    async def get_proxy_credentials(self, account_id: str) -> dict[str, Any]:
        resp = await self._request("GET", f"/accounts/{account_id}/proxy-credentials")
        return resp.json()

    async def rotate_proxy(self, account_id: str) -> dict[str, Any]:
        resp = await self._request("POST", f"/accounts/{account_id}/proxy/rotate")
        return resp.json()

    async def health_check(self) -> bool:
        try:
            resp = await self._request("GET", "/health")
            return resp.status_code == 200
        except Exception:
            return False

    def is_circuit_open(self) -> bool:
        return time.time() < self._breaker_open_until

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        if self.is_circuit_open():
            raise CircuitOpenError("distribution-engine circuit breaker is open")

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            start = time.perf_counter()
            try:
                response = await self._client.request(method, path, **kwargs)
                duration = time.perf_counter() - start
                logger.info(
                    "api_request method=%s path=%s status=%s duration_ms=%.2f",
                    method,
                    path,
                    response.status_code,
                    duration * 1000,
                )
                if response.status_code == 401:
                    await self.login()
                    response = await self._client.request(method, path, **kwargs)
                response.raise_for_status()
                self._breaker_failures = 0
                return response
            except Exception as exc:
                last_error = exc
                self._breaker_failures += 1
                await self._log_failure(path=path, method=method, error=str(exc))
                if self._breaker_failures >= self.breaker_threshold:
                    self._breaker_open_until = time.time() + self.breaker_open_seconds
                    logger.error(
                        "Circuit opened for %ss after %s failures",
                        self.breaker_open_seconds,
                        self._breaker_failures,
                    )
                    break
                if attempt < self.max_retries:
                    await asyncio.sleep(2 ** (attempt - 1))
        raise RuntimeError(f"Request failed after retries: {method} {path}") from last_error

    async def _log_failure(self, *, path: str, method: str, error: str) -> None:
        logger.error("api_failure method=%s path=%s error=%s", method, path, error)
        if self._db_pool is None:
            return
        try:
            async with self._db_pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO account_actions (account_id, action_type, success, error_message)
                    VALUES ($1, $2, $3, $4)
                    """,
                    None,
                    "api_client_error",
                    False,
                    json.dumps({"method": method, "path": path, "error": error})[:1000],
                )
        except Exception:
            logger.exception("Failed to persist api failure log")
