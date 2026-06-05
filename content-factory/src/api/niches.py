import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.niche_service import NicheService

router = APIRouter()


class NicheBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    hashtags: list[str] = []
    posting_times: list[int] = []
    topic_examples: list[str] = Field(default_factory=list, max_length=20)


class NicheCreate(NicheBase):
    pass


class NicheUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    hashtags: Optional[list[str]] = None
    posting_times: Optional[list[int]] = None
    topic_examples: Optional[list[str]] = None


class NicheResponse(NicheBase):
    id: uuid.UUID
    model_config = ConfigDict(from_attributes=True)


@router.get("", response_model=List[NicheResponse])
async def list_niches(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    svc = NicheService(db)
    return await svc.get_all(skip=skip, limit=limit)


@router.get("/{niche_id}", response_model=NicheResponse)
async def get_niche(niche_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = NicheService(db)
    niche = await svc.get_by_id(niche_id)
    if not niche:
        raise HTTPException(status_code=404, detail="Niche not found")
    return niche


@router.post("", response_model=NicheResponse, status_code=status.HTTP_201_CREATED)
async def create_niche(body: NicheCreate, db: AsyncSession = Depends(get_db)):
    svc = NicheService(db)
    existing = await svc.get_by_name(body.name.strip().lower())
    if existing:
        raise HTTPException(status_code=409, detail="Niche name already exists")
    return await svc.create(
        name=body.name.strip().lower(),
        description=body.description,
        hashtags=body.hashtags,
        posting_times=body.posting_times,
        topic_examples=body.topic_examples,
    )


@router.put("/{niche_id}", response_model=NicheResponse)
async def update_niche(niche_id: uuid.UUID, body: NicheUpdate, db: AsyncSession = Depends(get_db)):
    svc = NicheService(db)
    niche = await svc.get_by_id(niche_id)
    if not niche:
        raise HTTPException(status_code=404, detail="Niche not found")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        data["name"] = data["name"].strip().lower()
        other = await svc.get_by_name(data["name"])
        if other and other.id != niche_id:
            raise HTTPException(status_code=409, detail="Niche name already exists")
    return await svc.update(niche, **data)


@router.delete("/{niche_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_niche(niche_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = NicheService(db)
    niche = await svc.get_by_id(niche_id)
    if not niche:
        raise HTTPException(status_code=404, detail="Niche not found")
    await svc.delete(niche)
    return None
