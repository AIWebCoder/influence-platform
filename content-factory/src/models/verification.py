from sqlalchemy import Column, String, Integer, DateTime, Boolean
from sqlalchemy.dialects.postgresql import UUID
from src.core.database import Base
import uuid
from datetime import datetime, timedelta


class VerificationSession(Base):
    __tablename__ = "verification_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone_number = Column(String(20), nullable=False, index=True)
    code = Column(String(6), nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending, verified, expired, failed
    attempts = Column(Integer, default=0)
    cooldown_until = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)

    @property
    def is_expired(self) -> bool:
        return datetime.utcnow() > self.expires_at

    @property
    def is_on_cooldown(self) -> bool:
        return self.cooldown_until and datetime.utcnow() < self.cooldown_until
