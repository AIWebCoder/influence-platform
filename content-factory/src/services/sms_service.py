import os
import logging
import random
import string
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import httpx
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

from src.services.otp_metrics import (
    otp_requests_total,
    otp_send_duration_seconds,
    provider_failures_total,
    sms_providers_available
)

logger = logging.getLogger(__name__)


class SMSProvider(ABC):
    """Abstract base class for SMS providers."""
    
    @abstractmethod
    async def send_sms(self, to: str, message: str) -> Dict[str, Any]:
        """Send SMS and return result with success status."""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging."""
        pass


class TwilioProvider(SMSProvider):
    """Twilio SMS provider."""
    
    def __init__(self, account_sid: str, auth_token: str, from_number: str):
        self.client = TwilioClient(account_sid, auth_token)
        self.from_number = from_number
    
    @property
    def name(self) -> str:
        return "twilio"
    
    async def send_sms(self, to: str, message: str) -> Dict[str, Any]:
        try:
            twilio_message = self.client.messages.create(
                body=message,
                from_=self.from_number,
                to=to
            )
            return {
                "success": True,
                "provider": self.name,
                "message_id": twilio_message.sid,
                "status": twilio_message.status
            }
        except TwilioRestException as e:
            logger.error(f"Twilio error: {e}")
            return {
                "success": False,
                "provider": self.name,
                "error": str(e)
            }


class MessageBirdProvider(SMSProvider):
    """MessageBird SMS provider."""
    
    def __init__(self, api_key: str, originator: str):
        self.api_key = api_key
        self.originator = originator
    
    @property
    def name(self) -> str:
        return "messagebird"
    
    async def send_sms(self, to: str, message: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://rest.messagebird.com/messages",
                    headers={
                        "Authorization": f"AccessKey {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "recipients": [to],
                        "originator": self.originator,
                        "body": message
                    }
                )
                data = response.json()
                
                if response.status_code == 201 and data.get("id"):
                    return {
                        "success": True,
                        "provider": self.name,
                        "message_id": data.get("id"),
                        "status": "sent"
                    }
                return {
                    "success": False,
                    "provider": self.name,
                    "error": data.get("description", "Unknown error")
                }
        except Exception as e:
            logger.error(f"MessageBird error: {e}")
            return {
                "success": False,
                "provider": self.name,
                "error": str(e)
            }


class VonageProvider(SMSProvider):
    """Vonage (Nexmo) SMS provider."""
    
    def __init__(self, api_key: str, api_secret: str, from_number: str):
        self.api_key = api_key
        self.api_secret = api_secret
        self.from_number = from_number
    
    @property
    def name(self) -> str:
        return "vonage"
    
    async def send_sms(self, to: str, message: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://rest.nexmo.com/sms/json",
                    json={
                        "api_key": self.api_key,
                        "api_secret": self.api_secret,
                        "from": self.from_number,
                        "to": to,
                        "text": message
                    }
                )
                data = response.json()
                
                messages = data.get("messages", [])
                if messages and messages[0].get("status") == "0":
                    return {
                        "success": True,
                        "provider": self.name,
                        "message_id": messages[0].get("message-id"),
                        "status": "sent"
                    }
                error_msg = messages[0].get("error-title", "Unknown error") if messages else "No response"
                return {
                    "success": False,
                    "provider": self.name,
                    "error": error_msg
                }
        except Exception as e:
            logger.error(f"Vonage error: {e}")
            return {
                "success": False,
                "provider": self.name,
                "error": str(e)
            }


class SMSService:
    """SMS service with provider failover."""
    
    def __init__(self):
        self.providers: list[SMSProvider] = []
        self._initialize_providers()
    
    def _initialize_providers(self):
        """Initialize available SMS providers based on configuration."""
        # Twilio
        twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
        twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
        twilio_from = os.getenv("TWILIO_FROM_NUMBER")
        
        if twilio_sid and twilio_token and twilio_from:
            self.providers.append(TwilioProvider(twilio_sid, twilio_token, twilio_from))
            logger.info("Twilio SMS provider initialized")
        
        # MessageBird
        messagebird_key = os.getenv("MESSAGEBIRD_API_KEY")
        messagebird_originator = os.getenv("MESSAGEBIRD_ORIGINATOR")
        
        if messagebird_key and messagebird_originator:
            self.providers.append(MessageBirdProvider(messagebird_key, messagebird_originator))
            logger.info("MessageBird SMS provider initialized")
        
        # Vonage
        vonage_key = os.getenv("VONAGE_API_KEY")
        vonage_secret = os.getenv("VONAGE_API_SECRET")
        vonage_from = os.getenv("VONAGE_FROM_NUMBER")
        
        if vonage_key and vonage_secret and vonage_from:
            self.providers.append(VonageProvider(vonage_key, vonage_secret, vonage_from))
            logger.info("Vonage SMS provider initialized")
        
        if not self.providers:
            logger.warning("No SMS providers configured!")
    
    async def send_otp(self, to: str, code: str) -> Dict[str, Any]:
        """Send OTP code with provider failover."""
        if not self.providers:
            sms_providers_available.set(0)
            return {
                "success": False,
                "error": "No SMS providers configured"
            }
        
        sms_providers_available.set(len(self.providers))
        
        message = f"Your verification code is: {code}. Valid for 10 minutes."
        last_error = None
        
        for provider in self.providers:
            start_time = time.time()
            try:
                result = await provider.send_sms(to, message)
                duration = time.time() - start_time
                
                otp_send_duration_seconds.labels(provider=provider.name).observe(duration)
                
                if result["success"]:
                    otp_requests_total.labels(status="success", provider=provider.name).inc()
                    logger.info(f"OTP sent successfully via {provider.name}, message_id: {result.get('message_id')}")
                    return result
                
                otp_requests_total.labels(status="failed", provider=provider.name).inc()
                provider_failures_total.labels(provider=provider.name, error_type="send_failed").inc()
                
                last_error = result.get("error")
                logger.warning(f"Provider {provider.name} failed, trying next provider: {last_error}")
                
            except Exception as e:
                logger.error(f"Exception sending via {provider.name}: {e}")
                provider_failures_total.labels(provider=provider.name, error_type="exception").inc()
                last_error = str(e)
                continue
        
        otp_requests_total.labels(status="all_failed", provider="none").inc()
        logger.error(f"All SMS providers failed. Last error: {last_error}")
        return {
            "success": False,
            "error": f"All providers failed: {last_error}"
        }


def generate_otp(length: int = 6) -> str:
    """Generate a random numeric OTP code."""
    return ''.join(random.choices(string.digits, k=length))


sms_service = SMSService()
