import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from src.core.database import Base


class Niche(Base):
    __tablename__ = "niches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text)
    hashtags = Column(JSONB, default=list)
    posting_times = Column(JSONB, default=list)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    templates = relationship("Template", back_populates="niche")


class Template(Base):
    __tablename__ = "templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    niche_id = Column(UUID(as_uuid=True), ForeignKey("niches.id"))
    name = Column(String(200), nullable=False)
    caption_template = Column(Text, nullable=False)
    visual_prompt = Column(Text)
    hashtag_groups = Column(JSONB, default=list)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    niche = relationship("Niche", back_populates="templates")
    contents = relationship("ContentPacket", back_populates="template")


class ContentPacket(Base):
    __tablename__ = "content_packets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String(20), nullable=False)
    caption = Column(Text)
    visual_url = Column(Text)
    visual_urls = Column(JSONB, default=list)
    hashtags = Column(JSONB, default=list)
    target_accounts = Column(JSONB, default=list)
    scheduled_at = Column(DateTime(timezone=True), index=True)
    niche = Column(String(100), index=True)
    status = Column(String(20), default="pending", index=True)
    metadata_json = Column("metadata", JSONB, default=dict)
    variant = Column(String(5), nullable=True)
    template_id = Column(UUID(as_uuid=True), ForeignKey("templates.id"))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    template = relationship("Template", back_populates="contents")
