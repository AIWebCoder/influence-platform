from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy import text
from src.core.database import AsyncSessionLocal
import logging

logger = logging.getLogger(__name__)


class AuditLogger:
    """Audit logging for tracking user actions."""
    
    ACTION_TYPES = {
        # Authentication
        "login": "auth.login",
        "logout": "auth.logout",
        "login_failed": "auth.login_failed",
        "refresh_token": "auth.refresh_token",
        
        # User management
        "user_create": "users.create",
        "user_update": "users.update",
        "user_delete": "users.delete",
        "user_role_change": "users.role_change",
        
        # Account management
        "account_create": "accounts.create",
        "account_update": "accounts.update",
        "account_delete": "accounts.delete",
        "account_status_change": "accounts.status_change",
        
        # Content
        "content_generate": "content.generate",
        "content_update": "content.update",
        "content_delete": "content.delete",
        
        # Publishing
        "publish_start": "publishing.start",
        "publish_success": "publishing.success",
        "publish_failure": "publishing.failure",
        
        # Settings
        "settings_update": "settings.update",
        "api_key_update": "settings.api_key_update",
    }
    
    @staticmethod
    async def log(
        user_id: Optional[str],
        action: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
    ):
        """Log an audit event."""
        try:
            async with AsyncSessionLocal() as session:
                await session.execute(
                    text("""
                        INSERT INTO audit_logs 
                        (user_id, action, resource_type, resource_id, details, ip_address, created_at)
                        VALUES (:user_id, :action, :resource_type, :resource_id, :details, :ip_address, NOW())
                    """),
                    {
                        "user_id": user_id,
                        "action": action,
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                        "details": str(details) if details else None,
                        "ip_address": ip_address,
                    }
                )
                await session.commit()
                
        except Exception as e:
            logger.error(f"Failed to log audit event: {e}")
    
    @staticmethod
    async def log_login(user_id: str, success: bool, ip_address: str = None):
        """Log a login attempt."""
        action = "login" if success else "login_failed"
        await AuditLogger.log(
            user_id=user_id if success else None,
            action=action,
            resource_type="auth",
            details={"method": "password"},
            ip_address=ip_address,
        )
    
    @staticmethod
    async def log_user_action(
        user_id: str,
        action: str,
        target_user_id: str = None,
        details: Dict[str, Any] = None,
        ip_address: str = None,
    ):
        """Log a user management action."""
        await AuditLogger.log(
            user_id=user_id,
            action=action,
            resource_type="users",
            resource_id=target_user_id,
            details=details,
            ip_address=ip_address,
        )
    
    @staticmethod
    async def log_content_action(
        user_id: str,
        action: str,
        content_id: str = None,
        details: Dict[str, Any] = None,
        ip_address: str = None,
    ):
        """Log a content management action."""
        await AuditLogger.log(
            user_id=user_id,
            action=action,
            resource_type="content",
            resource_id=content_id,
            details=details,
            ip_address=ip_address,
        )
    
    @staticmethod
    async def log_account_action(
        user_id: str,
        action: str,
        account_id: str = None,
        details: Dict[str, Any] = None,
        ip_address: str = None,
    ):
        """Log an account management action."""
        await AuditLogger.log(
            user_id=user_id,
            action=action,
            resource_type="accounts",
            resource_id=account_id,
            details=details,
            ip_address=ip_address,
        )
