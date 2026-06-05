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
        content_type: Optional[str] = None,
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
        ct = (content_type or "").strip().lower()
        format_instruction = (
            f" Tailor length and tone for an Instagram {ct}."
            if ct in ("post", "reel", "story")
            else ""
        )
        user_prompt = (
            f"Write a highly engaging Instagram caption for the '{niche}' niche.{style_instruction}{topic_instruction}{format_instruction} "
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
    async def generate_ailiveai_persona_profile(
        self,
        niche: str,
        topic: str,
        mode: str,
        trace: Optional[dict[str, Any]] = None,
        persona_gender: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Structured on-camera persona for AliveAI blocking /prompts ``appearance``.
        """
        pg = (persona_gender or "FEMALE").strip().upper()
        if pg not in ("MALE", "FEMALE", "TRANS"):
            pg = "FEMALE"
        system_prompt = (
            "You are a casting director for AliveAI image generation (Create Prompt API). "
            "Output one raw JSON object with these keys (all string values required unless noted; no markdown, no code fences):\n"
            "- full_name: realistic Western-style given name and family name (two words). API uses this to influence the face.\n"
            "- face_details: max ~950 characters. Only facial detail for the face-improve step: eye shape and color, eyelids, "
            "eyebrow shape and density, nose bridge and tip, lips shape, jawline and chin, cheekbones, overall face shape, "
            "visible skin texture on the face. Be specific.\n"
            "- character_appearance: max ~1450 characters. Full-body description: apparent age, nationality cues, height and "
            "build (athletic, curvy, slim, stocky, petite, etc.), posture, hair (length, cut, color), skin on body, wardrobe "
            "head-to-toe. Face matches full_name; do not paste face_details verbatim.\n"
            "- age, nationalities, height, body_shape, hair, skin_tone, wardrobe_style, expressions_grimaces, face (short UI summary).\n"
            "- image_background: max ~600 characters; soft backdrop, lighting.\n"
            "- image_scene: max ~500 characters; still atmosphere (may be empty string).\n"
            "- from_location: max 80 characters or empty string.\n"
            "- negative_details: max ~400 characters (artifacts to avoid).\n"
            "- block_explicit_content: boolean, true for social-safe content.\n"
            f"The on-screen subject gender is fixed to {pg} (AliveAI MALE|FEMALE|TRANS). "
            "All fields must consistently match that gender.\n"
            "Align with niche and topic tone; no spoken dialogue from the topic."
        )
        user_prompt = (
            f"Niche: {niche}. Topic (for tone only): {topic}. Creator mode: {mode}. "
            f"Mandatory persona gender: {pg}. Invent one believable on-screen persona; every visual detail must match."
        )
        emit(
            "gemini_request_start",
            operation="generate_ailiveai_persona_profile",
            prompt_chars=len(system_prompt) + len(user_prompt),
            **self._trace_kwargs(trace),
        )
        response = await self.model.generate_content_async(
            contents=[{"role": "user", "parts": [system_prompt, user_prompt]}],
            generation_config=genai.types.GenerationConfig(
                temperature=0.65,
                response_mime_type="application/json",
            ),
        )
        self._log_gemini_usage("generate_ailiveai_persona_profile", response, trace)
        emit("gemini_request_success", operation="generate_ailiveai_persona_profile", **self._trace_kwargs(trace))
        content_text = response.text
        if content_text.startswith("```json"):
            content_text = content_text[7:-3].strip()
        elif content_text.startswith("```"):
            content_text = content_text[3:-3].strip()
        parsed = json.loads(content_text)
        if not isinstance(parsed, dict):
            raise ContentGenerationError("Invalid persona profile payload from AI model")
        required = (
            "full_name",
            "face_details",
            "character_appearance",
            "age",
            "nationalities",
            "height",
            "body_shape",
            "face",
            "expressions_grimaces",
            "hair",
            "skin_tone",
            "wardrobe_style",
            "image_background",
            "image_scene",
            "from_location",
            "negative_details",
        )
        allow_empty = frozenset({"from_location", "image_scene"})
        for key in required:
            if key not in parsed:
                raise ContentGenerationError(f"Persona profile missing key: {key}")
            if key in allow_empty:
                continue
            if not str(parsed.get(key) or "").strip():
                raise ContentGenerationError(f"Persona profile empty key: {key}")
        bec = parsed.get("block_explicit_content")
        if isinstance(bec, str) and bec.strip().lower() in ("true", "1", "yes"):
            parsed["block_explicit_content"] = True
        elif isinstance(bec, str) and bec.strip().lower() in ("false", "0", "no"):
            parsed["block_explicit_content"] = False
        elif not isinstance(bec, bool):
            parsed["block_explicit_content"] = True
        return parsed

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
        ailiveai_on_camera_topic_scene: bool = False,
    ) -> list[dict]:
        """
        Returns a list of scene dicts: scene_index, prompt, duration (seconds 3–5), role (hook|motion|detail).
        Raw JSON only from the model.
        """
        sc = int(scene_count)
        if sc == 1:
            n = 1
        else:
            n = sc if sc in range(6, 9) else random.randint(6, 8)

        strict_rules = (
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
        ailive_rules = (
            "RULES for this on-camera image-to-video shot (a reference portrait of the talent is generated separately):"
            "1. Anchor the beat to the TOPIC and NICHE — setting, props, situation, and emotional arc for one clip."
            "2. You may describe subtle facial expressions, head movement, reactions, and light upper-body gestures that fit the topic."
            "3. Do NOT restate a full casting sheet (no exhaustive measurements list); assume likeness is fixed from the reference image."
            "4. One continuous 5–10 second shot: coherent lighting, vertical framing, readable composition."
            "5. Avoid explicit sexual content, gore, or hateful stereotypes."
        )
        if n == 1:
            rules_block = ailive_rules if ailiveai_on_camera_topic_scene else strict_rules
            system_prompt = (
                "You are a director for short-form vertical video (Instagram Reels/Stories). "
                "Output a raw JSON object with a single key 'scenes' whose value is an array of exactly 1 object. "
                "The object must have: 'scene_index' (0), 'prompt' (string, one vivid continuous-shot brief for AI image-to-video), "
                "'duration' (integer seconds, must be 3, 4, or 5 only), "
                "'role' (must be exactly 'motion'). "
                "The prompt should read as one uninterrupted clip (about 5–10 seconds of final video): setting, mood, key visual, optional camera drift. "
                "Do NOT use markdown or code fences. Output raw JSON only."
                + rules_block
            )
            user_prompt = (
                f"Niche: {niche}. Topic: {topic}. Content type: {content_type}. Creator mode: {mode}. "
                + (
                    "Write one scene focused on what happens in the video given the topic — not a full character design sheet."
                    if ailiveai_on_camera_topic_scene
                    else "Write one rich scene description for a single generative video (not a multi-beat storyboard)."
                )
            )
        else:
            system_prompt = (
                "You are a director for short-form vertical video (Instagram Reels/Stories). "
                f"Output a raw JSON object with a single key 'scenes' whose value is an array of exactly {n} objects. "
                "Each object must have: 'scene_index' (integer starting at 0), 'prompt' (string, vivid visual direction), "
                "'duration' (integer seconds, must be 3, 4, or 5 only), "
                "'role' (string, one of: hook, motion, detail — distribute roles across the sequence). "
                "Do NOT use markdown or code fences. Output raw JSON only."
                + strict_rules
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
            if n == 1:
                if len(normalized) < 1:
                    raise ContentGenerationError("Too few scenes returned from AI model")
                return normalized[:1]
            if len(normalized) < 6:
                raise ContentGenerationError("Too few scenes returned from AI model")
            return normalized[:8]

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
    async def generate_topic_suggestions(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        count: int = 5,
    ) -> list[str]:
        from src.services.topic_suggestion_service import normalize_topic_examples

        content_text = ""
        try:
            response = await self.model.generate_content_async(
                f"{system_prompt}\n\n{user_prompt}",
                generation_config={"temperature": 0.85, "max_output_tokens": 800},
            )
            content_text = (response.text or "").strip()
            if content_text.startswith("```json"):
                content_text = content_text[7:-3].strip()
            elif content_text.startswith("```"):
                content_text = content_text[3:-3].strip()
            parsed = json.loads(content_text)
            topics = normalize_topic_examples(parsed.get("topics") if isinstance(parsed, dict) else [])
            if not topics:
                raise ContentGenerationError("Invalid topic suggestions payload from AI model")
            return topics[:count]
        except json.JSONDecodeError as e:
            logger.error("Failed to parse Gemini topic suggestions as JSON: %s", content_text)
            raise ContentGenerationError("Invalid response format from AI model") from e
        except Exception as e:
            logger.error("Error calling Gemini API for topic suggestions: %s", e)
            raise
