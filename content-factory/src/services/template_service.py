import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.models.content import Template

class TemplateService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self, skip: int = 0, limit: int = 100) -> List[Template]:
        query = select(Template).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_by_id(self, template_id: uuid.UUID) -> Optional[Template]:
        query = select(Template).where(Template.id == template_id)
        result = await self.db.execute(query)
        return result.scalars().first()

    async def create(self, **kwargs) -> Template:
        template = Template(**kwargs)
        self.db.add(template)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def update(self, template: Template, **kwargs) -> Template:
        for key, value in kwargs.items():
            if value is not None:
                setattr(template, key, value)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def delete(self, template: Template) -> None:
        await self.db.delete(template)
        await self.db.commit()
