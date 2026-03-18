import logging
from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from src.core.config import settings

logger = logging.getLogger(__name__)

class ImageGenerationError(Exception):
    pass

class OpenAIService:
    def __init__(self):
        # AsyncOpenAI automatically picks up OPENAI_API_KEY from environment
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.model = "dall-e-3"

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((APITimeoutError, RateLimitError, APIError)),
        reraise=True
    )
    async def generate_image(self, prompt: str) -> str:
        """
        Generates an image via DALL-E 3 based on the provided visual prompt.
        Retries up to 3 times on transient network/API errors.
        Returns the expiring URL of the generated image.
        """
        try:
            response = await self.client.images.generate(
                model=self.model,
                prompt=prompt,
                size="1024x1024",
                quality="standard",
                n=1,
            )

            if not response.data or not response.data[0].url:
                raise ValueError("No image URL returned from OpenAI")

            return response.data[0].url

        except Exception as e:
            logger.error(f"Error calling OpenAI API: {str(e)}")
            raise ImageGenerationError("Failed to generate image via DALL-E") from e
