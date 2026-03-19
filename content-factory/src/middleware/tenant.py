from fastapi import Request, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime
import uuid

from src.core.database import get_db
from src.models.organization import Organization
from src.models.user import User


class TenantContext:
    """Stores current tenant information for the request."""
    
    def __init__(
        self,
        organization_id: uuid.UUID,
        organization: Organization,
        user_id: uuid.UUID,
        role: str
    ):
        self.organization_id = organization_id
        self.organization = organization
        self.user_id = user_id
        self.role = role
    
    def can_access_feature(self, feature: str) -> bool:
        """Check if the organization can access a specific feature."""
        plan_features = {
            "free": ["basic_content"],
            "starter": ["basic_content", "scheduling"],
            "growth": ["basic_content", "scheduling", "analytics", "ai_images"],
            "scale": ["basic_content", "scheduling", "analytics", "ai_images", "api_access", "white_label"],
        }
        
        allowed = plan_features.get(self.organization.plan, [])
        return feature in allowed
    
    def can_create_resource(self, resource_type: str) -> bool:
        """Check if the organization can create a new resource based on limits."""
        if resource_type == "account":
            current = getattr(self.organization, 'current_accounts', 0)
            return current < self.organization.max_accounts
        elif resource_type == "post":
            return True
        return True
    
    def get_remaining_quota(self, resource_type: str) -> int:
        """Get remaining quota for a resource type."""
        if resource_type == "accounts":
            return max(0, self.organization.max_accounts - getattr(self.organization, 'current_accounts', 0))
        elif resource_type == "posts":
            return max(0, self.organization.max_posts_per_month - getattr(self.organization, 'current_posts', 0))
        return 0


async def get_tenant_context(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> TenantContext:
    """Extract and validate tenant context from JWT token."""
    
    organization_id = getattr(request.state, 'organization_id', None)
    user_id = getattr(request.state, 'user_id', None)
    role = getattr(request.state, 'role', 'viewer')
    
    if not organization_id or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication context"
        )
    
    result = await db.execute(
        select(Organization).where(Organization.id == organization_id)
    )
    organization = result.scalar_one_or_none()
    
    if not organization:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    if not organization.can_use_platform:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization is not active"
        )
    
    return TenantContext(
        organization_id=organization_id,
        organization=organization,
        user_id=user_id,
        role=role
    )


def require_feature(feature: str):
    """Dependency to require a specific feature."""
    async def checker(tenant: TenantContext = Depends(get_tenant_context)):
        if not tenant.can_access_feature(feature):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Feature '{feature}' not available on your plan"
            )
        return tenant
    return checker


def require_plan(plans: list[str]):
    """Dependency to require a specific plan or higher."""
    async def checker(tenant: TenantContext = Depends(get_tenant_context)):
        plan_hierarchy = ["free", "starter", "growth", "scale"]
        
        user_plan_level = plan_hierarchy.index(tenant.organization.plan) if tenant.organization.plan in plan_hierarchy else 0
        required_level = min([plan_hierarchy.index(p) for p in plans if p in plan_hierarchy])
        
        if user_plan_level < required_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This feature requires a {plans[0]} plan or higher"
            )
        return tenant
    return checker
