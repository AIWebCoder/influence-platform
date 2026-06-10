"""Generate Instagram comment replies for the engagement module."""
from __future__ import annotations

import asyncio
import json
import logging
import re

from src.core.config import settings
from src.services.anthropic_service import AnthropicService, ContentGenerationError as AnthropicContentGenerationError
from src.services.gemini_service import ContentGenerationError as GeminiContentGenerationError

logger = logging.getLogger(__name__)

MAX_REPLY_CHARS = 500
GEMINI_REPLY_TIMEOUT_SECONDS = 60
GEMINI_REPLY_FALLBACK_MODELS = ("gemini-2.5-flash", "gemini-2.0-flash")
GEMINI_MAX_OUTPUT_TOKENS = 1024


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


def _strip_json_fence(text: str) -> str:
    content = (text or "").strip()
    if content.startswith("```json"):
        return content[7:-3].strip()
    if content.startswith("```"):
        return content[3:-3].strip()
    return content


def _normalize_reply(raw: str) -> str:
    reply = re.sub(r"\s+", " ", (raw or "").strip())
    if len(reply) > MAX_REPLY_CHARS:
        reply = reply[: MAX_REPLY_CHARS - 1].rstrip() + "…"
    return reply


def _looks_truncated(reply: str) -> bool:
    text = (reply or "").strip()
    if len(text) < 45:
        return False
    if text.endswith("…"):
        return True
    if re.search(r"[.!?…]$", text):
        return False
    # No closing punctuation — likely cut off mid-sentence (e.g. "...sur nos ast").
    return True


def _extract_gemini_text(response) -> str:
    text = getattr(response, "text", None)
    if text:
        return text
    chunks: list[str] = []
    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", []) or []:
            part_text = getattr(part, "text", None)
            if part_text:
                chunks.append(part_text)
    return "".join(chunks)


def _unescape_json_string(value: str) -> str:
    return (
        value.replace('\\"', '"')
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\\\", "\\")
    )


def _parse_reply_payload(content_text: str) -> str:
    cleaned = _strip_json_fence(content_text).strip()
    if not cleaned:
        raise GeminiContentGenerationError("Empty reply payload from model")

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict) and isinstance(parsed.get("reply"), str):
            return _normalize_reply(parsed["reply"])
        if isinstance(parsed, str):
            return _normalize_reply(parsed)
    except json.JSONDecodeError:
        pass

    field_match = re.search(r'"reply"\s*:\s*"((?:[^"\\]|\\.)*)', cleaned, re.DOTALL | re.IGNORECASE)
    if field_match:
        return _normalize_reply(_unescape_json_string(field_match.group(1)))

    prefix_match = re.match(r'^\s*\{\s*"reply"\s*:\s*"(.*)\s*\}?\s*$', cleaned, re.DOTALL | re.IGNORECASE)
    if prefix_match:
        inner = prefix_match.group(1).rstrip().rstrip('"').rstrip("}")
        if inner:
            return _normalize_reply(_unescape_json_string(inner))

    if re.match(r'^\s*\{\s*"reply"\s*:\s*"', cleaned, re.IGNORECASE):
        inner = re.sub(r'^\s*\{\s*"reply"\s*:\s*"', "", cleaned, count=1, flags=re.IGNORECASE)
        inner = inner.rstrip().rstrip('"}').rstrip('"')
        if inner:
            return _normalize_reply(_unescape_json_string(inner))

    return _normalize_reply(cleaned.strip('"').strip("'"))


def _build_prompts(
    *,
    comment_text: str,
    comment_username: str | None,
    post_caption: str | None,
    locale: str,
    tone: str | None,
) -> tuple[str, str]:
    lang = "French" if str(locale or "").lower().startswith("fr") else "English"
    author = (comment_username or "").strip().lstrip("@") or "the commenter"
    tone_hint = (tone or "").strip() or ("chaleureux et professionnel" if lang == "French" else "warm and professional")
    caption_block = (post_caption or "").strip()
    caption_section = f"\nPost caption: {caption_block[:400]}" if caption_block else ""

    system_prompt = (
        "You write short, authentic Instagram comment replies for brand accounts. "
        f"Write in {lang}. Return ONLY the reply message text — no JSON, no quotes wrapper, "
        "no markdown, no code fences. Write one or two complete sentences that end with "
        ". or ! or ?. Max 280 characters."
    )
    user_prompt = (
        f"Reply to this Instagram comment from @{author}:\n\"{comment_text.strip()[:800]}\""
        f"{caption_section}\n"
        f"Tone: {tone_hint}. Keep it conversational, under 280 characters, and finish the last sentence."
    )
    return system_prompt, user_prompt


async def _generate_with_anthropic(system_prompt: str, user_prompt: str) -> str:
    svc = AnthropicService()
    response = await svc.client.messages.create(
        model=svc.model,
        max_tokens=400,
        temperature=0.75,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    content_text = _strip_json_fence(response.content[0].text)
    return _parse_reply_payload(content_text)


def _gemini_generation_config(model_name: str) -> dict:
    config: dict = {
        "temperature": 0.75,
        "max_output_tokens": GEMINI_MAX_OUTPUT_TOKENS,
        "response_mime_type": "text/plain",
    }
    # Gemini 2.5 thinking models can consume the output budget and truncate visible text.
    if "2.5" in model_name or "2.0-flash-thinking" in model_name:
        config["thinking_config"] = {"thinking_budget": 0}
    return config


async def _generate_with_gemini(system_prompt: str, user_prompt: str) -> str:
    import google.generativeai as genai

    key = (settings.GEMINI_API_KEY or "").strip()
    if not key:
        raise GeminiContentGenerationError("GEMINI_API_KEY is not configured")
    genai.configure(api_key=key)

    configured = (settings.GEMINI_MODEL or "").strip()
    model_names: list[str] = []
    for name in (configured, *GEMINI_REPLY_FALLBACK_MODELS):
        if name and name not in model_names:
            model_names.append(name)

    last_error: Exception | None = None
    prompt = f"{system_prompt}\n\n{user_prompt}"
    retry_suffix = (
        "\n\nImportant: reply with complete sentence(s) ending in . or ! — do not stop mid-word."
    )
    for model_name in model_names:
        for attempt in range(2):
            active_prompt = prompt if attempt == 0 else prompt + retry_suffix
            try:
                model = genai.GenerativeModel(model_name)
                response = await asyncio.wait_for(
                    model.generate_content_async(
                        active_prompt,
                        generation_config=_gemini_generation_config(model_name),
                    ),
                    timeout=GEMINI_REPLY_TIMEOUT_SECONDS,
                )
                reply = _parse_reply_payload(_extract_gemini_text(response))
                if _looks_truncated(reply) and attempt == 0:
                    logger.warning(
                        "engagement_reply truncated model=%s len=%s — retrying",
                        model_name,
                        len(reply),
                    )
                    continue
                return reply
            except asyncio.TimeoutError:
                last_error = GeminiContentGenerationError(
                    f"Gemini request timed out for model {model_name}"
                )
                logger.warning("engagement_reply gemini timeout model=%s", model_name)
                break
            except Exception as exc:
                last_error = exc
                err_text = str(exc).lower()
                if attempt == 0 and "thinking_config" in err_text:
                    logger.warning("engagement_reply thinking_config unsupported model=%s", model_name)
                    try:
                        model = genai.GenerativeModel(model_name)
                        response = await asyncio.wait_for(
                            model.generate_content_async(
                                active_prompt,
                                generation_config={
                                    "temperature": 0.75,
                                    "max_output_tokens": GEMINI_MAX_OUTPUT_TOKENS,
                                    "response_mime_type": "text/plain",
                                },
                            ),
                            timeout=GEMINI_REPLY_TIMEOUT_SECONDS,
                        )
                        reply = _parse_reply_payload(_extract_gemini_text(response))
                        if _looks_truncated(reply) and attempt == 0:
                            continue
                        return reply
                    except Exception as fallback_exc:
                        last_error = fallback_exc
                logger.warning("engagement_reply gemini failed model=%s err=%s", model_name, exc)
                break

    if last_error:
        raise last_error
    raise GeminiContentGenerationError("No Gemini model available for engagement replies")


async def generate_engagement_reply(
    *,
    comment_text: str,
    comment_username: str | None = None,
    post_caption: str | None = None,
    locale: str = "fr",
    tone: str | None = None,
) -> str:
    text = (comment_text or "").strip()
    if not text:
        raise ValueError("comment_text is required")

    system_prompt, user_prompt = _build_prompts(
        comment_text=text,
        comment_username=comment_username,
        post_caption=post_caption,
        locale=locale,
        tone=tone,
    )

    use_anthropic = _prefer_anthropic()
    if use_anthropic:
        try:
            return await _generate_with_anthropic(system_prompt, user_prompt)
        except Exception as exc:
            if settings.GEMINI_API_KEY and _is_anthropic_credit_error(exc):
                logger.warning("engagement_reply anthropic->gemini: %s", exc)
            else:
                raise

    if not (settings.GEMINI_API_KEY or "").strip():
        raise RuntimeError("No text model provider configured for engagement replies")

    return await _generate_with_gemini(system_prompt, user_prompt)
