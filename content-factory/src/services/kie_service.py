import logging
import asyncio
import httpx
import json

from src.core.config import settings

logger = logging.getLogger(__name__)

KIE_BASE = "https://api.kie.ai"
POLL_INTERVAL_SECONDS = 5
MAX_POLLS = 60  # 5s × 60 = 5 minutes max wait


class KieService:
    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {settings.KIE_API_KEY}",
            "Content-Type": "application/json",
        }

    async def generate_image(self, prompt: str, aspect_ratio: str = "1:1") -> str | None:
        """
        Generate an image via Kie.ai 4o Image API.
        """
        if not settings.KIE_API_KEY:
            logger.error("KIE_API_KEY is missing.")
            return None

        url = f"{KIE_BASE}/api/v1/gpt4o-image/generate"
        payload = {
            "prompt": prompt,
            "size": aspect_ratio,
            "isEnhance": False
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(url, json=payload, headers=self.headers)
                resp.raise_for_status()
                data = resp.json()
                
                if data.get("code") != 200:
                    logger.error(f"[KieService] Image generate error: {data}")
                    if data.get("code") == 402:
                        return "ERROR: INSUFFICIENT_CREDITS"
                    return None
                    
                task_id = data.get("data", {}).get("taskId")
                if not task_id:
                    logger.error(f"[KieService] No taskId returned for image generation: {data}")
                    return None

                logger.info(f"[KieService] Started image task {task_id}")
                return await self._poll_image_task(client, task_id)
            except Exception as e:
                logger.error(f"[KieService] Error starting image generation: {e}")
                return None

    async def _poll_image_task(self, client: httpx.AsyncClient, task_id: str) -> str | None:
        poll_url = f"{KIE_BASE}/api/v1/gpt4o-image/record-info?taskId={task_id}"
        
        for attempt in range(MAX_POLLS):
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            try:
                resp = await client.get(poll_url, headers=self.headers)
                resp.raise_for_status()
                data = resp.json()
                
                if data.get("code") != 200:
                    logger.warning(f"[KieService] Unexpected poll response: {data}")
                    continue
                    
                status = data.get("data", {}).get("status")
                if status == "SUCCESS":
                    result_urls = data.get("data", {}).get("response", {}).get("resultUrls", [])
                    if result_urls:
                        return result_urls[0]
                    return None
                elif status in ["FAILED", "FAIL", "ERROR", "CANCELED"]:
                    logger.error(f"[KieService] Image task failed: {data}")
                    return None
                # continue polling for processing
            except Exception as e:
                logger.warning(f"[KieService] Poll error (attempt {attempt + 1}): {e}")

        logger.error(f"[KieService] Image job {task_id} timed out after {MAX_POLLS * POLL_INTERVAL_SECONDS}s")
        return None

    async def generate_video(self, prompt: str, duration: int = 5, aspect_ratio: str = "9:16") -> str | None:
        """
        Generate a video via Kie.ai jobs API.
        """
        if not settings.KIE_API_KEY:
            logger.error("KIE_API_KEY is missing.")
            return None

        url = f"{KIE_BASE}/api/v1/jobs/createTask"
        payload = {
            "model": "kling-2.6/text-to-video",
            "input": {
                "prompt": prompt,
                "sound": False,
                "aspect_ratio": aspect_ratio,
                "duration": str(duration)
            }
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(url, json=payload, headers=self.headers)
                resp.raise_for_status()
                data = resp.json()
                
                if data.get("code") != 200:
                    logger.error(f"[KieService] Video generate error: {data}")
                    if data.get("code") == 402:
                        return "ERROR: INSUFFICIENT_CREDITS"
                    return None
                    
                task_id = data.get("data", {}).get("taskId")
                if not task_id:
                    logger.error(f"[KieService] No taskId returned for video generation: {data}")
                    return None

                logger.info(f"[KieService] Started video task {task_id}")
                return await self._poll_video_task(client, task_id)
            except Exception as e:
                logger.error(f"[KieService] Error starting video generation: {e}")
                return None

    async def _poll_video_task(self, client: httpx.AsyncClient, task_id: str) -> str | None:
        poll_url = f"{KIE_BASE}/api/v1/jobs/recordInfo?taskId={task_id}"
        
        for attempt in range(MAX_POLLS):
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            try:
                resp = await client.get(poll_url, headers=self.headers)
                resp.raise_for_status()
                payload = resp.json()
                
                if payload.get("code") != 200:
                    logger.warning(f"[KieService] Unexpected poll response: {payload}")
                    continue
                    
                data = payload.get("data", {})
                state = data.get("state", "").lower()
                
                if state == "success":
                    result_urls = []
                    resp_dict = data.get("response") or {}
                    
                    if "resultUrls" in resp_dict:
                        result_urls = resp_dict.get("resultUrls", [])
                    
                    if not result_urls:
                        result_json_str = data.get("resultJson", "{}")
                        try:
                            if result_json_str:
                                result_dict = json.loads(result_json_str)
                                result_urls = result_dict.get("resultUrls", [])
                        except json.JSONDecodeError:
                            logger.error(f"[KieService] Failed to parse resultJson: {result_json_str}")
                    
                    if result_urls:
                        return result_urls[0]
                    
                    logger.error(f"[KieService] Video task success but no resultUrls found in data: {data}")
                    return None
                elif state in ["failed", "fail", "error", "canceled"]:
                    fail_msg = data.get("failMsg", "Unknown failure")
                    logger.error(f"[KieService] Video task failed: {fail_msg}")
                    return None
                # continue polling for processing
            except Exception as e:
                logger.warning(f"[KieService] Poll error (attempt {attempt + 1}): {e}")

        logger.error(f"[KieService] Video job {task_id} timed out after {MAX_POLLS * POLL_INTERVAL_SECONDS}s")
        return None
