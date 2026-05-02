import json
import logging
import random
from typing import Optional
from anthropic import AsyncAnthropic, APIError, APITimeoutError, RateLimitError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from src.core.config import settings

logger = logging.getLogger(__name__)

class ContentGenerationError(Exception):
    pass

class AnthropicService:
    def __init__(self):
        key = settings.resolved_anthropic_api_key()
        self.client = AsyncAnthropic(api_key=key)
        self.model = settings.CLAUDE_MODEL

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((APITimeoutError, RateLimitError, APIError)),
        reraise=True
    )
    async def generate_caption(
        self,
        niche: str,
        variant_style: Optional[str] = None,
        topic: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> dict:
        """
        Generates an Instagram caption and hashtags based on the provided niche using Claude.
        Optional variant_style allows for specific A/B testing instructions (e.g., 'educational', 'promotional').
        Optional topic narrows the creative direction.
        Retries up to 3 times on transient network/API errors.
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
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                temperature=0.7,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_prompt}
                ]
            )

            # Extract the response text
            content_text = response.content[0].text
            
            # Parse the JSON response
            # Claude sometimes includes markdown json blocks despite instructions, so we clean it just in case
            if content_text.startswith("```json"):
                content_text = content_text[7:-3].strip()
            elif content_text.startswith("```"):
                content_text = content_text[3:-3].strip()

            result = json.loads(content_text)
            
            if "caption" not in result or "hashtags" not in result:
                raise ValueError("Response missing required keys 'caption' or 'hashtags'")
                
            return result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response as JSON: {content_text}")
            raise ContentGenerationError("Invalid response format from AI model") from e
        except Exception as e:
            logger.error(f"Error calling Anthropic API: {str(e)}")
            raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((APITimeoutError, RateLimitError, APIError)),
        reraise=True,
    )
    async def generate_scene_plan(
        self,
        niche: str,
        topic: str,
        content_type: str,
        mode: str,
        scene_count: int,
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

        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2000,
            temperature=0.75,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content_text = response.content[0].text
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
