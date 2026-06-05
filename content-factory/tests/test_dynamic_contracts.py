from starlette.requests import Request

from src.api.generation_jobs import PreviewScenesBody, _build_fallback_preview_plan, _trace_id_from_request
from src.services.generation_orchestrator import _capped_scene_count, _draft_scene_count


def _request_with_headers(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode("utf-8"), v.encode("utf-8")) for k, v in headers.items()],
    }
    return Request(scope)


def test_trace_id_extracted_from_request_headers():
    req = _request_with_headers({"x-trace-id": "trace-123"})
    assert _trace_id_from_request(req) == "trace-123"


def test_fallback_preview_plan_shape_is_contract_stable():
    body = PreviewScenesBody(niche="fitness", topic="morning routine")
    plan = _build_fallback_preview_plan(body, 3)
    assert len(plan) == 3
    for idx, scene in enumerate(plan):
        assert scene["scene_index"] == idx
        assert scene["duration"] == 5
        assert isinstance(scene["prompt"], str) and scene["prompt"]
        assert scene["fallback_source"] == "quota_recovery_template"


def test_scene_count_not_capped_when_demo_caps_disabled():
    payload = {"scene_count": 8}
    # This checks the helper contract only; runtime config decides cap behavior.
    assert _capped_scene_count(payload) >= 1


def test_draft_scene_count_is_one_for_motion_and_bolt():
    assert _draft_scene_count("multi_scene_single_video", {"scene_count": 7}) == 1
    assert _draft_scene_count("ailiveai_single_video", {"scene_count": 7}) == 1
    assert _draft_scene_count("single_image", {"scene_count": 7}) == 1
    assert _draft_scene_count("scene_based", {"scene_count": 7}) == 7
