"""Structured JSON logs for the publish pipeline (grep for event=publish_pipeline)."""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger("publish_pipeline")


def _truncate(s: str, max_len: int = 200) -> str:
    t = str(s or "")
    if len(t) <= max_len:
        return t
    return t[: max_len - 3] + "..."


def summarize_public_url(url: str) -> dict[str, Any]:
    u = str(url or "").strip()
    if not u:
        return {"public_url_empty": True}
    try:
        p = urlparse(u)
        return {
            "url_scheme": p.scheme or "",
            "url_host": p.hostname or "",
            "url_path_len": len(p.path or ""),
            "url_preview": _truncate(u, 180),
        }
    except Exception:
        return {"url_preview": _truncate(u, 180)}


def log_publish_event(stage: str, **fields: Any) -> None:
    record: dict[str, Any] = {
        "event": "publish_pipeline",
        "component": "content_factory",
        "stage": stage,
        **fields,
    }
    logger.info(json.dumps(record, default=str))