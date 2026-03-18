import json
import logging
from typing import Optional
from anthropic import AsyncAnthropic, APIError, APITimeoutError, RateLimitError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from src.core.config import settings

logger = logging.getLogger(__name__)

class ContentGenerationError(Exception):
    pass

class AnthropicService:
    def __init__(self):
        # The AsyncAnthropic client automatically picks up ANTHROPIC_API_KEY from environment 
        # but we can explicitly pass it if needed.
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.model = settings.CLAUDE_MODEL

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((APITimeoutError, RateLimitError, APIError)),
        reraise=True
    )
    async def generate_caption(self, niche: str, variant_style: Optional[str] = None) -> dict:
        """
        Generates an Instagram caption and hashtags based on the provided niche using Claude.
        Optional variant_style allows for specific A/B testing instructions (e.g., 'educational', 'promotional').
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
        user_prompt = f"Write a highly engaging Instagram caption for the '{niche}' niche.{style_instruction} Include a hook, body, and call-to-action. Provide 5-10 highly relevant hashtags."

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
