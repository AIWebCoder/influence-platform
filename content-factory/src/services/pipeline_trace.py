"""Structured JSON logs for the generation pipeline (one JSON object per log line)."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_LOGGER = logging.getLogger("pipeline_trace")
_CONFIGURED = False


def configure_pipeline_trace_logging() -> Path:
    """
    Raw JSON lines to logs/pipeline_trace.log + stdout (no propagation to root — avoids double JSON).
    Idempotent.
    """
    global _CONFIGURED
    log_path = Path(__file__).resolve().parent.parent / "logs" / "pipeline_trace.log"
    if _CONFIGURED:
        return log_path
    log_dir = log_path.parent
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    fmt = logging.Formatter("%(message)s")
    _LOGGER.setLevel(logging.INFO)
    _LOGGER.propagate = False
    for h in list(_LOGGER.handlers):
        _LOGGER.removeHandler(h)
    try:
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(fmt)
        _LOGGER.addHandler(fh)
    except OSError:
        # e.g. read-only FS — still log to stdout
        pass
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    _LOGGER.addHandler(sh)
    _CONFIGURED = True
    return log_path


def emit(
    event: str,
    job_id: Optional[str] = None,
    step: Optional[str] = None,
    scene_index: Optional[int] = None,
    scene_id: Optional[str] = None,
    duration_ms: Optional[float] = None,
    level: str = "info",
    **extra: Any,
) -> None:
    """
    Emit one structured pipeline event (single JSON line in pipeline_trace.log).

    Core fields: ts, event, job_id, step, scene_index (when provided).
    """
    configure_pipeline_trace_logging()
    log_line: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "service": "content-factory",
        "component": "generation_pipeline",
    }
    if job_id is not None:
        log_line["job_id"] = job_id
    if step is not None:
        log_line["step"] = step
    if scene_index is not None:
        log_line["scene_index"] = scene_index
    if scene_id is not None:
        log_line["scene_id"] = scene_id
    if duration_ms is not None:
        log_line["duration_ms"] = round(float(duration_ms), 2)
    for k, v in extra.items():
        if v is not None and k not in log_line:
            log_line[k] = v
    line = json.dumps(log_line, default=str, ensure_ascii=False)
    if level == "error":
        _LOGGER.error(line)
    elif level == "warning":
        _LOGGER.warning(line)
    else:
        _LOGGER.info(line)


def get_job_trace(job_id: str, *, limit: Optional[int] = None) -> list[dict[str, Any]]:
    """Return parsed JSON log lines for the given job_id (optional tail limit)."""
    configure_pipeline_trace_logging()
    path = Path(__file__).resolve().parent.parent / "logs" / "pipeline_trace.log"
    if not path.is_file():
        return []
    out: list[dict[str, Any]] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if str(obj.get("job_id", "")) != str(job_id):
                    continue
                out.append(obj)
    except OSError:
        return []
    if limit is not None and limit > 0 and len(out) > limit:
        out = out[-limit:]
    return out
