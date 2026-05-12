import uuid
from datetime import datetime

from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from src.core.database import Base


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # draft | ready | pending | running | completed | failed | cancelling | cancelled
    status = Column(String(20), nullable=False, default="draft", index=True)
    execution_mode = Column(String(32), nullable=False, default="scene_based", index=True)
    progress = Column(Integer, nullable=False, default=0)
    input_payload = Column(JSONB, nullable=False, default=dict)
    # Per pipeline step: pending | running | cancelling | cancelled | completed (cooperative cancel UX)
    step_control = Column(JSONB, nullable=False, default=dict)
    output_url = Column(Text, nullable=True)
    logs = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    steps = relationship(
        "GenerationStep",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="GenerationStep.step_order",
    )
    scenes = relationship(
        "GenerationScene",
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="GenerationScene.scene_index",
    )


class GenerationStep(Base):
    __tablename__ = "generation_steps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    step_name = Column(String(64), nullable=False)
    step_order = Column(Integer, nullable=False, default=0)
    # pending | running | completed | failed | cancelled
    status = Column(String(20), nullable=False, default="pending", index=True)
    progress = Column(Integer, nullable=False, default=0)
    step_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    job = relationship("GenerationJob", back_populates="steps")


class GenerationScene(Base):
    __tablename__ = "generation_scenes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), ForeignKey("generation_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    scene_index = Column(Integer, nullable=False)
    prompt = Column(Text, nullable=False)
    duration = Column(Integer, nullable=False)
    scene_role = Column(String(32), nullable=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    start_image_url = Column(Text, nullable=True)
    end_image_url = Column(Text, nullable=True)
    video_url = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    scene_metadata = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    job = relationship("GenerationJob", back_populates="scenes")
