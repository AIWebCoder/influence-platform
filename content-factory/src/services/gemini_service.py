import json
import logging
import random
from typing import Any, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

import google.generativeai as genai
from google.api_core.exceptions import GoogleAPIError, RetryError

from src.core.config import settings
from src.services.pipeline_trace import emit

logger = logging.getLogger(__name__)

class ContentGenerationError(Exception):
    pass

def _is_gemini_retryable(exc: BaseException) -> bool:
    # Do not retry known quota/rate-limit failures; retries only burn remaining quota window.
    msg = str(exc).lower()
    if "quota exceeded" in msg or "rate limit" in msg or "resourceexhausted" in msg or "429" in msg:
        return False
    return isinstance(exc, (GoogleAPIError, RetryError))


class GeminiService:
    def __init__(self):
        key = (settings.GEMINI_API_KEY or "").strip()
        if not key:
            # We don't raise here to allow instantiation, but generation will fail if unconfigured.
            pass
        genai.configure(api_key=key)
        self.model = genai.GenerativeModel(settings.GEMINI_MODEL)

    def _trace_kwargs(self, trace: Optional[dict[str, Any]]) -> dict[str, Any]:
        if not trace:
            return {}
        return {k: trace[k] for k in ("job_id", "step") if k in trace}

    def _log_gemini_usage(self, operation: str, response: Any, trace: Optional[dict[str, Any]]) -> None:
        tk = self._trace_kwargs(trace)
        um = getattr(response, "usage_metadata", None)
        if um is None:
            emit("gemini_usage_missing", operation=operation, **tk)
            return
        emit(
            "gemini_usage",
            operation=operation,
            prompt_token_count=getattr(um, "prompt_token_count", None),
            candidates_token_count=getattr(um, "candidates_token_count", None),
            total_token_count=getattr(um, "total_token_count", None),
            **tk,
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(_is_gemini_retryable),
        reraise=True
    )
    async def generate_caption(
        self,
        niche: str,
        variant_style: Optional[str] = None,
        topic: Optional[str] = None,
        trace: Optional[dict[str, Any]] = None,
    ) -> dict:
        """
        Generates an Instagram caption and hashtags based on the provided niche using Gemini.
        Returns JSON dict with 'caption' and 'hashtags'.
        """
        system_prompt = (
            "You are an expert social media manager and copywriter specializing in Instagram growth. "
            "Your task is to generate high-converting, engaging, and authentic Instagram captions. "
            "Output the result as a raw JSON object with two keys: 'caption' (string) and 'hashtags' (array of strings). "
            "Do NOT include any markdown formatting, markdown code blocks, or explanatory text in your response. "
            "Just output the raw JSON."
        )

        style_instruction = f" Use a {variant_style} style." if variant_style else ""
        topic_instruction = f" Focus on this topic: {topic}." if topic else ""
        user_prompt = (
            f"Write a highly engaging Instagram caption for the '{niche}' niche.{style_instruction}{topic_instruction} "
            "Include a hook, body, and call-to-action. Provide 5-10 highly relevant hashtags."
        )

        try:
            emit(
                "gemini_request_start",
                operation="generate_caption",
                prompt_chars=len(system_prompt) + len(user_prompt),
                **self._trace_kwargs(trace),
            )
            response = await self.model.generate_content_async(
                contents=[
                    {"role": "user", "parts": [system_prompt, user_prompt]}
                ],
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    response_mime_type="application/json",
                )
            )
            self._log_gemini_usage("generate_caption", response, trace)
            emit("gemini_request_success", operation="generate_caption", **self._trace_kwargs(trace))

            content_text = response.text
            
            # Clean possible markdown blocks
            if content_text.startswith("```json"):
                content_text = content_text[7:-3].strip()
            elif content_text.startswith("```"):
                content_text = content_text[3:-3].strip()

            result = json.loads(content_text)
            
            if "caption" not in result or "hashtags" not in result:
                raise ValueError("Response missing required keys 'caption' or 'hashtags'")
                
            return result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {content_text}")
            raise ContentGenerationError("Invalid response format from AI model") from e
        except Exception as e:
            logger.error(f"Error calling Gemini API: {str(e)}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception(_is_gemini_retryable),
        reraise=True,
    )
    async def generate_scene_plan(
        self,
        niche: str,
        topic: str,
        content_type: str,
        mode: str,
        scene_count: int,
        trace: Optional[dict[str, Any]] = None,
    ) -> list[dict]:
        """
        Returns a list of scene dicts: scene_index, prompt, duration (seconds 3–5), role (hook|motion|detail).
        Raw JSON only from the model.
        """
        n = scene_count if scene_count in range(6, 9) else random.randint(6, 8)

        system_prompt = (
            "You are a director for short-form vertical video (Instagram Reels/Stories). "
            f"Output a raw JSON object with a single key 'scenes' whose value is an array of exactly {n} objects. "
            "Each object must have: 'scene_index' (integer starting at 0), 'prompt' (string, vivid visual direction), "
            "'duration' (integer seconds, must be 3, 4, or 5 only), "
            "'role' (string, one of: hook, motion, detail — distribute roles across the sequence). "
            "Do NOT use markdown or code fences. Output raw JSON only."
            "STRICT RULES for writing each scene prompt:"
            "1. NEVER describe human body parts in motion (no hands reaching, no feet walking, no arms moving)."
            "2. NEVER describe physics-based actions (no liquid pouring, no objects falling, no splashing)."
            "3. NEVER describe a person performing an action — describe the environment or result instead."
            "4. ALWAYS describe what the scene LOOKS LIKE, not what is HAPPENING in it."
            "5. If motion is needed, use camera movement only: slow zoom in, slow pan, gentle drift."
            "6. Prefer atmospheric, product-style, aesthetic shots with strong lighting and composition."
            "7. Keep scenes simple — one subject, one environment, one mood."
            "EXAMPLES OF BAD prompts (never generate these):"
            "- 'A hand reaches out to silence an alarm clock'"
            "- 'Bare feet walking across a hardwood floor'"
            "- 'Water being poured into a glass with ice'"
            "- 'Person performing mountain climbers on a yoga mat'"
            "EXAMPLES OF GOOD prompts (always generate like these):"
            "- 'A minimalist wooden alarm clock on a bedside table, soft morning light through sheer curtains, warm aesthetic'"
            "- 'Clean hardwood floor with a rolled-out yoga mat, bright airy living room, golden morning light, slow zoom in'"
            "- 'A glass of water with lemon slices and ice cubes on a marble surface, high contrast lighting, fresh aesthetic'"
            "- 'Yoga mat unrolled near a sunlit window, peaceful bedroom, soft shadows, gentle camera drift'"
        )
        user_prompt = (
            f"Niche: {niche}. Topic: {topic}. Content type: {content_type}. Creator mode: {mode}. "
            f"Produce exactly {n} scenes for one cohesive short video."
        )

        try:
            emit(
                "gemini_request_start",
                operation="generate_scene_plan",
                prompt_chars=len(system_prompt) + len(user_prompt),
                scene_count_target=n,
                **self._trace_kwargs(trace),
            )
            response = await self.model.generate_content_async(
                contents=[
                    {"role": "user", "parts": [system_prompt, user_prompt]}
                ],
                generation_config=genai.types.GenerationConfig(
                    temperature=0.75,
                    response_mime_type="application/json",
                )
            )
            self._log_gemini_usage("generate_scene_plan", response, trace)
            emit("gemini_request_success", operation="generate_scene_plan", **self._trace_kwargs(trace))

            content_text = response.text
            if content_text.startswith("```json"):
                content_text = content_text[7:-3].strip()
            elif content_text.startswith("```"):
                content_text = content_text[3:-3].strip()

            parsed = json.loads(content_text)
            scenes = parsed.get("scenes")
            if not isinstance(scenes, list) or len(scenes) == 0:
                raise ContentGenerationError("Invalid scenes payload from AI model")

            normalized = []
            for i, s in enumerate(scenes):
                if not isinstance(s, dict):
                    continue
                dur = int(s.get("duration", 4))
                if dur not in (3, 4, 5):
                    dur = min(max(dur, 3), 5) if dur else 4
                normalized.append(
                    {
                        "scene_index": int(s.get("scene_index", i)),
                        "prompt": str(s.get("prompt", "")).strip(),
                        "duration": dur,
                        "role": str(s.get("role", "motion")).strip()[:32],
                    }
                )
            if len(normalized) < 6:
                raise ContentGenerationError("Too few scenes returned from AI model")
            return normalized[:8]

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {content_text}")
            raise ContentGenerationError("Invalid response format from AI model") from e
        except Exception as e:
            logger.error(f"Error calling Gemini API: {str(e)}")
            raise
