from __future__ import annotations

import logging
from typing import Any

from anthropic import Anthropic


logger = logging.getLogger(__name__)


class ContentGenerator:
    def __init__(self, api_key: str, model: str) -> None:
        self.client = Anthropic(api_key=api_key)
        self.model = model

    async def generate_for_account(
        self,
        *,
        niche: str,
        tone: str,
        campaign: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        campaign_text = ""
        if campaign:
            campaign_text = (
                f"Campaign: {campaign.get('name', 'Unnamed')}. "
                f"Target niche: {campaign.get('target_niche', niche)}. "
                f"Type: {campaign.get('type', 'organic')}."
            )

        prompt = (
            "Generate Instagram post content.\n"
            f"Niche: {niche}\n"
            f"Tone: {tone}\n"
            f"{campaign_text}\n"
            "Return strict JSON with keys: caption (string), hashtags (array of 10-15 strings)."
        )

        response = await self._messages_create(prompt)
        text = response.get("text", "")
        logger.info(
            "content_generated_response niche=%s tone=%s campaign=%s chars=%s",
            niche,
            tone,
            campaign.get("id") if campaign else None,
            len(text),
        )

        # Basic safe fallback if model formatting diverges
        if '"caption"' not in text or '"hashtags"' not in text:
            logger.warning("Claude response not strict JSON, using fallback parsing.")
            return {
                "caption": text.strip()[:1800] or f"New post about {niche}",
                "hashtags": [f"#{niche.replace(' ', '')}", "#instagram", "#growth"],
            }

        import json

        try:
            payload = json.loads(text)
            caption = str(payload.get("caption", "")).strip()
            hashtags = payload.get("hashtags", [])
            if not isinstance(hashtags, list):
                hashtags = []
            return {
                "caption": caption,
                "hashtags": [str(h) for h in hashtags][:20],
            }
        except Exception:
            logger.exception("Failed to parse Claude response JSON.")
            return {
                "caption": text.strip()[:1800] or f"New post about {niche}",
                "hashtags": [f"#{niche.replace(' ', '')}", "#instagram", "#socialmedia"],
            }

    async def _messages_create(self, prompt: str) -> dict[str, Any]:
        import asyncio

        def _call() -> dict[str, Any]:
            result = self.client.messages.create(
                model=self.model,
                max_tokens=500,
                temperature=0.7,
                messages=[{"role": "user", "content": prompt}],
            )
            chunks = []
            for block in result.content:
                if getattr(block, "type", None) == "text":
                    chunks.append(block.text)
            return {"text": "\n".join(chunks).strip()}

        return await asyncio.to_thread(_call)
