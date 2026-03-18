import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.database import get_db
from src.services.template_service import TemplateService

router = APIRouter()

class TemplateBase(BaseModel):
    name: str
    caption_template: str
    visual_prompt: str | None = None
    hashtag_groups: list[str] = []
    is_active: bool = True
    niche_id: uuid.UUID | None = None

class TemplateCreate(TemplateBase):
    pass

class TemplateUpdate(BaseModel):
    name: str | None = None
    caption_template: str | None = None
    visual_prompt: str | None = None
    hashtag_groups: list[str] | None = None
    is_active: bool | None = None

class TemplateResponse(TemplateBase):
    id: uuid.UUID
    
    model_config = ConfigDict(from_attributes=True)

@router.get("/", response_model=List[TemplateResponse])
async def list_templates(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    svc = TemplateService(db)
    return await svc.get_all(skip=skip, limit=limit)

@router.get("/{template_id}", response_model=TemplateResponse)
async def get_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = TemplateService(db)
    template = await svc.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template

@router.post("/", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(request: TemplateCreate, db: AsyncSession = Depends(get_db)):
    svc = TemplateService(db)
    return await svc.create(**request.model_dump())

@router.put("/{template_id}", response_model=TemplateResponse)
async def update_template(template_id: uuid.UUID, request: TemplateUpdate, db: AsyncSession = Depends(get_db)):
    svc = TemplateService(db)
    template = await svc.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return await svc.update(template, **request.model_dump(exclude_unset=True))

@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = TemplateService(db)
    template = await svc.get_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await svc.delete(template)
    return None
