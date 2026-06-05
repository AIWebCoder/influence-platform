"""Topic ideas for Generation Studio (LLM + static fallbacks)."""
from __future__ import annotations

import json
import logging
from typing import Any

from src.core.config import settings
from src.services.anthropic_service import AnthropicService, ContentGenerationError as AnthropicContentGenerationError
from src.services.gemini_service import GeminiService, ContentGenerationError as GeminiContentGenerationError

logger = logging.getLogger(__name__)

DEFAULT_TOPIC_EXAMPLES: dict[str, list[str]] = {
    "fitness": [
        "routine mobilite matinale pour teletravailleurs",
        "entrainement HIIT 15 minutes sans materiel",
    ],
    "food": [
        "meal prep proteine en moins de 30 minutes",
        "petit-dejeuner equilibre pour semaine chargee",
    ],
    "travel": [
        "long week-end a Lisbonne petit budget",
        "itinerary 48h a Barcelone sans voiture",
    ],
    "business": [
        "premiers recrutements marketing pour une startup B2B",
        "rituel hebdo de priorisation pour fondateur solo",
    ],
    "lifestyle": [
        "habitudes simples pour des matins plus calmes",
        "reset du dimanche soir pour une semaine sereine",
    ],
}


def normalize_topic_examples(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        text = str(item or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text[:500])
    return out[:20]


def default_topics_for_niche(niche: str) -> list[str]:
    key = str(niche or "").strip().lower() or "lifestyle"
    return list(DEFAULT_TOPIC_EXAMPLES.get(key) or DEFAULT_TOPIC_EXAMPLES["lifestyle"])


def fallback_topic_suggestions(
    niche: str,
    *,
    count: int = 5,
    db_examples: list[str] | None = None,
) -> list[str]:
    """Static pool when the LLM provider is unavailable or returns invalid JSON."""
    pool = normalize_topic_examples(db_examples or []) + default_topics_for_niche(niche)
    if not pool:
        pool = default_topics_for_niche("lifestyle")
    n = max(1, min(int(count), 10))
    out: list[str] = []
    seen: set[str] = set()
    idx = 0
    while len(out) < n and idx < n * len(pool):
        candidate = pool[idx % len(pool)]
        idx += 1
        if candidate in seen:
            continue
        seen.add(candidate)
        out.append(candidate)
    return out[:n]


def _format_hint(execution_mode: str, content_type: str) -> str:
    mode = str(execution_mode or "").strip()
    ct = str(content_type or "post").strip().lower()
    if mode == "single_image":
        return f"Instagram {ct} photo concepts (single striking frame, no video)."
    if mode in ("multi_scene_single_video", "ailiveai_single_video"):
        return f"Short vertical video ({ct}) hooks and narratives, 4-15 seconds feel."
    if mode == "scene_based":
        return f"Multi-scene storyboard topics for an Instagram {ct}."
    return f"Instagram {ct} content angles."


def _prefer_anthropic() -> bool:
    primary = str(getattr(settings, "TEXT_PROVIDER_PRIMARY", "gemini")).strip().lower()
    if primary == "anthropic":
        return bool((settings.resolved_anthropic_api_key() or "").strip())
    if (settings.GEMINI_API_KEY or "").strip():
        return False
    return bool((settings.resolved_anthropic_api_key() or "").strip())


def _is_anthropic_credit_error(err: Exception) -> bool:
    msg = str(err or "").lower()
    return "credit balance is too low" in msg or "plans & billing" in msg


async def generate_topic_suggestions(
    *,
    niche: str,
    content_type: str = "post",
    execution_mode: str = "multi_scene_single_video",
    locale: str = "fr",
    count: int = 5,
) -> list[str]:
    """Return fresh short topic strings for the studio subject field."""
    n = max(1, min(int(count), 10))
    lang = "French" if str(locale or "").lower().startswith("fr") else "English"
    niche_label = str(niche or "").strip() or "lifestyle"
    format_hint = _format_hint(execution_mode, content_type)
    system_prompt = (
        "You are a social media strategist for Instagram creators. "
        f"Write in {lang}. Output a raw JSON object with one key 'topics': an array of exactly "
        f"{n} distinct short subject lines (max 120 characters each). "
        "Each topic must be specific, concrete, and usable as a generation brief - not a hashtag list. "
        "No markdown, no code fences."
    )
    user_prompt = (
        f"Niche: {niche_label}. Format: {format_hint} "
        f"Propose {n} fresh topic ideas a creator could pick right now."
    )

    use_anthropic = _prefer_anthropic()
    if use_anthropic:
        try:
            return await _generate_with_anthropic(system_prompt, user_prompt, n)
        except Exception as e:
            if settings.GEMINI_API_KEY and _is_anthropic_credit_error(e):
                logger.warning("topic_suggestions anthropic->gemini: %s", e)
            else:
                raise

    if not (settings.GEMINI_API_KEY or "").strip():
        raise RuntimeError("No text model provider configured for topic suggestions")

    gemini = GeminiService()
    return await gemini.generate_topic_suggestions(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        count=n,
    )


async def _generate_with_anthropic(system_prompt: str, user_prompt: str, count: int) -> list[str]:
    svc = AnthropicService()
    response = await svc.client.messages.create(
        model=svc.model,
        max_tokens=800,
        temperature=0.85,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    content_text = response.content[0].text
    if content_text.startswith("```json"):
        content_text = content_text[7:-3].strip()
    elif content_text.startswith("```"):
        content_text = content_text[3:-3].strip()
    parsed = json.loads(content_text)
    topics = normalize_topic_examples(parsed.get("topics") if isinstance(parsed, dict) else [])
    if len(topics) < 1:
        raise AnthropicContentGenerationError("Invalid topic suggestions payload from model")
    return topics[:count]