from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timedelta
from typing import Optional
import uuid
import stripe
import os

from src.core.config import settings
from src.core.database import get_db
from src.models.organization import Organization
from src.models.user import User
from src.models.billing import Subscription, UsageRecord
from src.core.security import verify_password, create_access_token, hash_password, get_current_user

router = APIRouter()

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

PLANS = {
    "free": {
        "name": "Free",
        "price_monthly": 0,
        "max_accounts": 5,
        "max_posts_per_month": 100,
        "max_users": 1,
        "features": ["basic_content", "scheduling"],
        "stripe_price_id": None,
    },
    "starter": {
        "name": "Starter",
        "price_monthly": 4900,
        "max_accounts": 10,
        "max_posts_per_month": 500,
        "max_users": 3,
        "features": ["basic_content", "scheduling", "analytics"],
        "stripe_price_id": os.getenv("STRIPE_STARTER_PRICE_ID", "price_starter"),
    },
    "growth": {
        "name": "Growth",
        "price_monthly": 14900,
        "max_accounts": 50,
        "max_posts_per_month": 2000,
        "max_users": 10,
        "features": ["basic_content", "scheduling", "analytics", "ai_images", "api_access"],
        "stripe_price_id": os.getenv("STRIPE_GROWTH_PRICE_ID", "price_growth"),
    },
    "scale": {
        "name": "Scale",
        "price_monthly": 49900,
        "max_accounts": 200,
        "max_posts_per_month": 10000,
        "max_users": 50,
        "features": ["basic_content", "scheduling", "analytics", "ai_images", "api_access", "white_label", "priority_support"],
        "stripe_price_id": os.getenv("STRIPE_SCALE_PRICE_ID", "price_scale"),
    },
}


class CreateOrganizationRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(..., min_length=3, max_length=100, pattern=r'^[a-z0-9-]+$')
    plan: str = Field(default="free")


class CreateSubscriptionRequest(BaseModel):
    plan: str
    stripe_payment_method_id: Optional[str] = None


class WebhookEvent(BaseModel):
    type: str
    data: dict


@router.post("/organizations")
async def create_organization(
    request: CreateOrganizationRequest,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Create a new organization."""
    
    result = await db.execute(
        select(Organization).where(Organization.slug == request.slug)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Organization slug already exists"
        )
    
    plan_info = PLANS.get(request.plan, PLANS["free"])
    
    trial_ends = None
    if request.plan != "free":
        trial_ends = datetime.utcnow() + timedelta(days=14)
    
    org = Organization(
        name=request.name,
        slug=request.slug,
        plan=request.plan,
        max_accounts=plan_info["max_accounts"],
        max_posts_per_month=plan_info["max_posts_per_month"],
        max_users=plan_info["max_users"],
        trial_ends_at=trial_ends,
        status="active" if request.plan == "free" else "trial"
    )
    
    db.add(org)
    await db.commit()
    await db.refresh(org)
    
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "plan": org.plan,
        "status": org.status,
        "trial_ends_at": org.trial_ends_at,
    }


@router.post("/organizations/{org_id}/subscription")
async def create_subscription(
    org_id: str,
    request: CreateSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Create or update a subscription."""
    
    result = await db.execute(
        select(Organization).where(Organization.id == uuid.UUID(org_id))
    )
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    if request.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    plan_info = PLANS[request.plan]
    
    if stripe.api_key and request.stripe_payment_method_id:
        try:
            if not org.stripe_customer_id:
                customer = stripe.Customer.create(
                    email=f"{org.slug}@{os.getenv('DEFAULT_DOMAIN', 'influenceplatform.io')}",
                    metadata={"organization_id": str(org.id)}
                )
                org.stripe_customer_id = customer.id
            
            subscription = stripe.Subscription.create(
                customer=org.stripe_customer_id,
                items=[{"price": plan_info["stripe_price_id"], "quantity": 1}],
                default_payment_method=request.stripe_payment_method_id,
                trial_period_days=14 if request.plan != "free" else 0,
            )
            
            org.stripe_subscription_id = subscription.id
            org.subscription_status = subscription.status
            org.plan = request.plan
            org.status = "active"
            
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        org.plan = request.plan
        org.status = "active"
    
    org.max_accounts = plan_info["max_accounts"]
    org.max_posts_per_month = plan_info["max_posts_per_month"]
    org.max_users = plan_info["max_users"]
    
    await db.commit()
    
    return {
        "status": "success",
        "plan": org.plan,
        "subscription_status": org.subscription_status,
    }


@router.post("/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Handle Stripe webhooks."""
    
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    
    try:
        if webhook_secret and sig_header:
            event = stripe.Webhook.construct_event(
                payload, sig_header, webhook_secret
            )
        else:
            import json
            event = json.loads(payload)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")
    
    event_type = event.get("type")
    data = event.get("data", {}).get("object", {})
    
    if event_type == "customer.subscription.updated":
        await handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        await handle_subscription_cancelled(data, db)
    elif event_type == "invoice.payment_succeeded":
        await handle_payment_success(data, db)
    elif event_type == "invoice.payment_failed":
        await handle_payment_failed(data, db)
    
    return {"status": "success"}


async def handle_subscription_updated(data: dict, db: AsyncSession):
    subscription_id = data.get("id")
    
    result = await db.execute(
        select(Organization).where(
            Organization.stripe_subscription_id == subscription_id
        )
    )
    org = result.scalar_one_or_none()
    
    if org:
        org.subscription_status = data.get("status")
        await db.commit()


async def handle_subscription_cancelled(data: dict, db: AsyncSession):
    subscription_id = data.get("id")
    
    result = await db.execute(
        select(Organization).where(
            Organization.stripe_subscription_id == subscription_id
        )
    )
    org = result.scalar_one_or_none()
    
    if org:
        org.status = "cancelled"
        org.plan = "free"
        org.subscription_status = "canceled"
        await db.commit()


async def handle_payment_success(data: dict, db: AsyncSession):
    customer_id = data.get("customer")
    
    result = await db.execute(
        select(Organization).where(
            Organization.stripe_customer_id == customer_id
        )
    )
    org = result.scalar_one_or_none()
    
    if org:
        org.status = "active"
        await db.commit()


async def handle_payment_failed(data: dict, db: AsyncSession):
    customer_id = data.get("customer")
    
    result = await db.execute(
        select(Organization).where(
            Organization.stripe_customer_id == customer_id
        )
    )
    org = result.scalar_one_or_none()
    
    if org:
        org.status = "payment_failed"
        await db.commit()


@router.get("/plans")
async def get_plans():
    """Get available plans."""
    return PLANS


@router.get("/organizations/{org_id}/usage")
async def get_usage(
    org_id: str,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Get current usage for an organization."""
    
    result = await db.execute(
        select(Organization).where(Organization.id == uuid.UUID(org_id))
    )
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    now = datetime.utcnow()
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    period_end = now
    
    usage_result = await db.execute(
        select(UsageRecord).where(
            and_(
                UsageRecord.organization_id == uuid.UUID(org_id),
                UsageRecord.period_start >= period_start,
                UsageRecord.period_end <= period_end
            )
        )
    )
    usage_records = usage_result.scalars().all()
    
    total_posts = sum(r.count for r in usage_records if r.resource_type == "post")
    
    return {
        "organization_id": org_id,
        "plan": org.plan,
        "max_accounts": org.max_accounts,
        "max_posts_per_month": org.max_posts_per_month,
        "current_accounts": 0,
        "current_posts": total_posts,
        "remaining_accounts": org.max_accounts,
        "remaining_posts": max(0, org.max_posts_per_month - total_posts),
    }


@router.post("/organizations/{org_id}/usage/track")
async def track_usage(
    org_id: str,
    resource_type: str,
    count: int = 1,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Track resource usage."""
    
    now = datetime.utcnow()
    period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        period_end = datetime(now.year + 1, 1, 1) - timedelta(seconds=1)
    else:
        period_end = datetime(now.year, now.month + 1, 1) - timedelta(seconds=1)
    
    usage = UsageRecord(
        organization_id=uuid.UUID(org_id),
        resource_type=resource_type,
        count=count,
        period_start=period_start,
        period_end=period_end,
    )
    
    db.add(usage)
    await db.commit()
    
    return {"status": "tracked"}
