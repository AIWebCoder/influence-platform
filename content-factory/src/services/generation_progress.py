"""Map pipeline step state to job.progress (estimated, provider-poll-aware)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.models.generation_job import GenerationJob

SINGLE_CLIP_MODES = frozenset({"multi_scene_single_video", "ailiveai_single_video"})
PHOTO_MODES = frozenset({"single_image"})

_SCENE_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("scene_generation", 8),
    ("image_generation", 22),
    ("video_generation", 45),
    ("assembly", 15),
    ("distribution", 10),
)


def _step_skipped(step) -> bool:
    meta = step.step_metadata if hasattr(step, "step_metadata") else {}
    if not isinstance(meta, dict):
        meta = {}
    return bool(meta.get("skipped"))


def sync_job_progress(job: "GenerationJob") -> None:
    """Recompute generation_jobs.progress from steps + execution_mode."""
    status = str(getattr(job, "status", "") or "")
    if status == "completed":
        job.progress = 100
        return
    if status in ("draft", "ready"):
        job.progress = 0
        return
    if status in ("failed", "cancelled"):
        return

    mode = str(getattr(job, "execution_mode", "") or "scene_based")
    steps_list = list(getattr(job, "steps", None) or [])
    steps = {s.step_name: s for s in steps_list}
    running = next((s for s in steps_list if s.status == "running"), None)

    if mode in SINGLE_CLIP_MODES:
        if running:
            sp = int(running.progress or 0)
            if running.step_name == "video_generation":
                job.progress = min(94, 12 + int(82 * sp / 100))
            elif running.step_name == "distribution":
                job.progress = min(99, 94 + int(5 * sp / 100))
            else:
                job.progress = max(int(job.progress or 0), 10)
        else:
            vg = steps.get("video_generation")
            if vg and vg.status == "completed":
                job.progress = max(int(job.progress or 0), 90)
            elif status in ("running", "pending", "cancelling"):
                job.progress = max(int(job.progress or 0), 10)
        return

    if mode in PHOTO_MODES:
        if running:
            sp = int(running.progress or 0)
            if running.step_name == "scene_generation":
                job.progress = min(20, 5 + int(15 * sp / 100))
            elif running.step_name == "image_generation":
                job.progress = min(92, 20 + int(72 * sp / 100))
            elif running.step_name == "distribution":
                job.progress = min(99, 92 + int(7 * sp / 100))
            else:
                job.progress = max(int(job.progress or 0), 8)
        else:
            ig = steps.get("image_generation")
            if ig and ig.status == "completed":
                job.progress = max(int(job.progress or 0), 90)
            elif status in ("running", "pending", "cancelling"):
                job.progress = max(int(job.progress or 0), 8)
        return

    total_w = sum(w for _, w in _SCENE_WEIGHTS)
    acc = 0
    for name, w in _SCENE_WEIGHTS:
        st = steps.get(name)
        if not st:
            continue
        if st.status == "completed" or _step_skipped(st):
            acc += w
            continue
        if st.status == "running":
            sp = int(st.progress or 0)
            acc += int(w * min(100, sp) / 100)
            break
        break
    job.progress = min(99, max(8, int(100 * acc / total_w)))


def provider_poll_step_progress(poll_index: int, max_polls: int) -> int:
    """Estimated video_generation % while polling (never 100 until step completes)."""
    if max_polls < 1:
        max_polls = 1
    # 8–92% during polls; asymptotic so late polls still move the bar
    ratio = min(1.0, poll_index / max_polls)
    return min(92, 8 + int(84 * ratio))
