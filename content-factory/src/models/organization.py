from sqlalchemy import Column, String, DateTime, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID
from src.core.database import Base
import uuid
from datetime import datetime


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    plan = Column(String(20), nullable=False, default="free")
    status = Column(String(20), nullable=False, default="active")
    
    stripe_customer_id = Column(String(100), unique=True, nullable=True)
    stripe_subscription_id = Column(String(100), unique=True, nullable=True)
    subscription_status = Column(String(20), nullable=True)
    subscription_expires_at = Column(DateTime, nullable=True)
    
    max_accounts = Column(Integer, default=5)
    max_posts_per_month = Column(Integer, default=100)
    max_users = Column(Integer, default=3)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    trial_ends_at = Column(DateTime, nullable=True)
    
    is_active = Column(Boolean, default=True)
    
    @property
    def is_trial(self) -> bool:
        if self.trial_ends_at:
            return datetime.utcnow() < self.trial_ends_at
        return False
    
    @property
    def can_use_platform(self) -> bool:
        if not self.is_active:
            return False
        if self.status == "cancelled":
            return False
        return True
