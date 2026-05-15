import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import Niche


class NicheService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, skip: int = 0, limit: int = 100) -> List[Niche]:
        result = await self.db.execute(
            select(Niche).order_by(Niche.name.asc()).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

    async def get_by_id(self, niche_id: uuid.UUID) -> Optional[Niche]:
        result = await self.db.execute(select(Niche).where(Niche.id == niche_id))
        return result.scalars().first()

    async def get_by_name(self, name: str) -> Optional[Niche]:
        result = await self.db.execute(select(Niche).where(Niche.name == name))
        return result.scalars().first()

    async def create(self, **kwargs) -> Niche:
        niche = Niche(**kwargs)
        self.db.add(niche)
        await self.db.commit()
        await self.db.refresh(niche)
        return niche

    async def update(self, niche: Niche, **kwargs) -> Niche:
        for key, value in kwargs.items():
            if value is not None:
                setattr(niche, key, value)
        await self.db.commit()
        await self.db.refresh(niche)
        return niche

    async def delete(self, niche: Niche) -> None:
        await self.db.delete(niche)
        await self.db.commit()
