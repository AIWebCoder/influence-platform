import uuid
from typing import Any, List, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.content import Template


def apply_template_to_payload(payload: dict[str, Any], template: Template) -> dict[str, Any]:
    """Merge template caption/visual/hashtag hints into a generation job payload."""
    out = dict(payload)
    niche = str(payload.get("niche") or "your niche")
    topic = str(payload.get("topic") or niche)

    if template.caption_template:
        hint = (
            template.caption_template.replace("{{niche}}", niche).replace("{{topic}}", topic)
        )
        out["template_caption_hint"] = hint.strip()

    if template.visual_prompt:
        visual = template.visual_prompt.replace("{{niche}}", niche).replace("{{topic}}", topic)
        out["template_visual_hint"] = visual.strip()

    groups = template.hashtag_groups or []
    if groups:
        flat: list[str] = []
        for item in groups:
            if isinstance(item, str):
                flat.append(item)
            elif isinstance(item, list):
                flat.extend(str(x) for x in item)
        if flat:
            out["template_hashtags"] = flat

    out["template_id"] = str(template.id)
    out["template_name"] = template.name
    return out


async def resolve_template_payload(db: AsyncSession, payload: dict[str, Any]) -> dict[str, Any]:
    raw_id = payload.get("template_id")
    if not raw_id:
        return payload
    try:
        template_id = uuid.UUID(str(raw_id))
    except (TypeError, ValueError):
        return payload
    svc = TemplateService(db)
    template = await svc.get_by_id(template_id)
    if not template or not template.is_active:
        return payload
    return apply_template_to_payload(payload, template)


class TemplateService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        niche_id: Optional[uuid.UUID] = None,
        active_only: bool = False,
    ) -> List[Template]:
        query = select(Template)
        if niche_id is not None:
            # Niche-specific templates plus global templates (niche_id unset).
            query = query.where(or_(Template.niche_id == niche_id, Template.niche_id.is_(None)))
        if active_only:
            query = query.where(Template.is_active.is_(True))
        query = query.order_by(Template.name.asc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

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
