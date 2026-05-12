import json
import logging
import random
from typing import Any, Optional
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
    async def generate_ailiveai_persona_profile(
        self,
        niche: str,
        topic: str,
        mode: str,
        persona_gender: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Structured on-camera persona for AliveAI blocking /prompts ``appearance``.
        Returns JSON-compatible dict with casting fields plus ``appearance_for_image_model``.
        """
        pg = (persona_gender or "FEMALE").strip().upper()
        if pg not in ("MALE", "FEMALE", "TRANS"):
            pg = "FEMALE"
        system_prompt = (
            "You are a casting director for AliveAI image generation (Create Prompt API). "
            "Output one raw JSON object with these keys (all string values required unless noted; no markdown, no code fences):\n"
            "- full_name: realistic Western-style given name and family name (two words). API uses this to influence the face.\n"
            "- face_details: max ~950 characters. Only facial detail for the face-improve step: eye shape and color, eyelids, "
            "eyebrow shape and density, nose bridge and tip, lips shape, jawline and chin, cheekbones, overall face shape "
            "(oval/heart/square etc.), visible skin texture on the face, any freckles or beauty marks. Be specific and concrete.\n"
            "- character_appearance: max ~1450 characters. Full-body character description for the main appearance field: "
            "apparent age, nationality or regional heritage as subtle visual cues, height and build (e.g. athletic, curvy, slim, "
            "stocky, petite), shoulder and hip line, posture, full hair description (length, cut, color, texture), skin tone on "
            "body, hands, wardrobe head-to-toe, jewelry if any. Do not repeat the entire face_details block verbatim; "
            "reference that the face matches full_name. Cohesive prose, no bullet lists.\n"
            "- age: short phrase (e.g. late 20s).\n"
            "- nationalities: heritage/nationality for casting tone.\n"
            "- height: verbal (e.g. 5'6\" or 168cm).\n"
            "- body_shape: one line (athletic / curvy / slim / average / stocky / etc.).\n"
            "- hair: one line summary (also covered in character_appearance).\n"
            "- skin_tone: one line.\n"
            "- wardrobe_style: one line.\n"
            "- expressions_grimaces: typical micro-expressions on camera.\n"
            "- face: one short line summary of face type for UI (not a duplicate of face_details).\n"
            "- image_background: max ~600 characters; environment behind subject (soft light, shallow depth of field, "
            "non-distracting).\n"
            "- image_scene: max ~500 characters; optional lighting/pose-atmosphere for the still (not a storyboard).\n"
            "- from_location: max 80 characters; city or region vibe if relevant, else empty string.\n"
            "- negative_details: max ~400 characters; things to avoid (e.g. extra fingers, warped eyes, text overlays).\n"
            "- block_explicit_content: boolean, true for general social-safe content.\n"
            f"The on-screen subject gender is fixed to {pg} (AliveAI enum MALE|FEMALE|TRANS). "
            "full_name, face_details, character_appearance, and wardrobe must consistently match that gender.\n"
            "Align energy with niche and topic; do not paste the topic as spoken dialogue."
        )
        user_prompt = (
            f"Niche: {niche}. Topic (for tone only): {topic}. Creator mode: {mode}. "
            f"Mandatory persona gender: {pg}. Invent one believable on-screen persona suited to this niche; "
            "every visual and naming choice must match this gender."
        )
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=2400,
            temperature=0.65,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        content_text = response.content[0].text
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
        if n == 1:
            if len(normalized) < 1:
                raise ContentGenerationError("Too few scenes returned from AI model")
            return normalized[:1]
        if len(normalized) < 6:
            raise ContentGenerationError("Too few scenes returned from AI model")
        return normalized[:8]
