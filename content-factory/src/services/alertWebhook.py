import os
import aiohttp
import logging
from datetime import datetime
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class AlertWebhook:
    """Send alerts to Slack, Discord, or custom webhooks."""
    
    def __init__(self):
        self.slack_webhook = os.getenv("SLACK_WEBHOOK_URL")
        self.discord_webhook = os.getenv("DISCORD_WEBHOOK_URL")
        self.custom_webhook = os.getenv("CUSTOM_WEBHOOK_URL")
    
    async def send_alert(
        self,
        level: str,  # info, warning, error, critical
        title: str,
        message: str,
        fields: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Send alert to all configured webhooks."""
        payload = self._build_payload(level, title, message, fields)
        
        success = True
        
        if self.slack_webhook:
            try:
                await self._send_to_slack(payload)
            except Exception as e:
                logger.error(f"Failed to send Slack alert: {e}")
                success = False
        
        if self.discord_webhook:
            try:
                await self._send_to_discord(payload)
            except Exception as e:
                logger.error(f"Failed to send Discord alert: {e}")
                success = False
        
        if self.custom_webhook:
            try:
                await self._send_to_custom(payload)
            except Exception as e:
                logger.error(f"Failed to send custom webhook: {e}")
                success = False
        
        return success
    
    def _build_payload(
        self,
        level: str,
        title: str,
        message: str,
        fields: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build common alert payload."""
        return {
            "level": level,
            "title": title,
            "message": message,
            "fields": fields or {},
            "timestamp": datetime.utcnow().isoformat(),
            "service": "content-factory",
        }
    
    async def _send_to_slack(self, payload: Dict[str, Any]) -> None:
        """Send alert to Slack."""
        color_map = {
            "info": "#36a64f",
            "warning": "#ff9800",
            "error": "#f44336",
            "critical": "#8b0000",
        }
        
        slack_payload = {
            "attachments": [{
                "color": color_map.get(payload["level"], "#808080"),
                "title": payload["title"],
                "text": payload["message"],
                "fields": [
                    {"title": k, "value": str(v), "short": True}
                    for k, v in payload.get("fields", {}).items()
                ],
                "footer": "Influence Platform",
                "ts": int(datetime.utcnow().timestamp()),
            }]
        }
        
        async with aiohttp.ClientSession() as session:
            await session.post(self.slack_webhook, json=slack_payload)
    
    async def _send_to_discord(self, payload: Dict[str, Any]) -> None:
        """Send alert to Discord."""
        color_map = {
            "info": 3066993,
            "warning": 16776960,
            "error": 15158332,
            "critical": 10038562,
        }
        
        discord_payload = {
            "embeds": [{
                "title": payload["title"],
                "description": payload["message"],
                "color": color_map.get(payload["level"], 8421504),
                "fields": [
                    {"name": k, "value": str(v), "inline": True}
                    for k, v in payload.get("fields", {}).items()
                ],
                "timestamp": payload["timestamp"],
            }]
        }
        
        async with aiohttp.ClientSession() as session:
            await session.post(self.discord_webhook, json=discord_payload)
    
    async def _send_to_custom(self, payload: Dict[str, Any]) -> None:
        """Send alert to custom webhook."""
        async with aiohttp.ClientSession() as session:
            await session.post(self.custom_webhook, json=payload)
    
    # Convenience methods
    async def alert_critical(self, title: str, message: str, **fields):
        """Send critical alert."""
        return await self.send_alert("critical", title, message, fields)
    
    async def alert_error(self, title: str, message: str, **fields):
        """Send error alert."""
        return await self.send_alert("error", title, message, fields)
    
    async def alert_warning(self, title: str, message: str, **fields):
        """Send warning alert."""
        return await self.send_alert("warning", title, message, fields)
    
    async def alert_info(self, title: str, message: str, **fields):
        """Send info alert."""
        return await self.send_alert("info", title, message, fields)


# Global instance
alert_webhook = AlertWebhook()
