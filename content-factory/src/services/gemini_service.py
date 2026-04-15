import json
import logging
import random
from typing import Optional
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

import google.generativeai as genai
from google.api_core.exceptions import GoogleAPIError, RetryError

from src.core.config import settings

logger = logging.getLogger(__name__)

class ContentGenerationError(Exception):
    pass

class GeminiService:
    def __init__(self):
        key = (settings.GEMINI_API_KEY or "").strip()
        if not key:
            # We don't raise here to allow instantiation, but generation will fail if unconfigured.
            pass
        genai.configure(api_key=key)
        self.model = genai.GenerativeModel('gemini-2.5-flash')

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((GoogleAPIError, RetryError)),
        reraise=True
    )
    async def generate_caption(
        self,
        niche: str,
        variant_style: Optional[str] = None,
        topic: Optional[str] = None,
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
            response = await self.model.generate_content_async(
                contents=[
                    {"role": "user", "parts": [system_prompt, user_prompt]}
                ],
                generation_config=genai.types.GenerationConfig(
                    temperature=0.7,
                    response_mime_type="application/json",
                )
            )

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
        retry=retry_if_exception_type((GoogleAPIError, RetryError)),
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
        )
        user_prompt = (
            f"Niche: {niche}. Topic: {topic}. Content type: {content_type}. Creator mode: {mode}. "
            f"Produce exactly {n} scenes for one cohesive short video."
        )

        try:
            response = await self.model.generate_content_async(
                contents=[
                    {"role": "user", "parts": [system_prompt, user_prompt]}
                ],
                generation_config=genai.types.GenerationConfig(
                    temperature=0.75,
                    response_mime_type="application/json",
                )
            )

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
