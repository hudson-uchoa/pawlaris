from typing import cast
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.idempotency import ENTITY_REGISTRY, FamilyOwnedModel
from app.models import Family
from app.schemas.sync import Change, SyncPage

CHANGE_ADAPTER: TypeAdapter[Change] = TypeAdapter(Change)


async def collect_changes(
    session: AsyncSession, family_id: UUID, since: int, limit: int, hi: int
) -> SyncPage:
    changes: list[Change] = []
    for entity, entry in ENTITY_REGISTRY.items():
        model = entry.model
        family_column = (
            Family.id
            if model is Family
            else cast(type[FamilyOwnedModel], model).family_id
        )
        query = (
            select(model)
            .where(
                family_column == family_id,
                model.revision > since,
                model.revision <= hi,
            )
            .order_by(model.revision)
            .limit(limit + 1)
            .execution_options(populate_existing=True)
        )
        for row in await session.scalars(query):
            changes.append(
                CHANGE_ADAPTER.validate_python(
                    {"entity": entity, "row": entry.schema.model_validate(row)}
                )
            )
    changes.sort(key=lambda change: change.row.revision)
    has_more = len(changes) > limit
    kept = changes[:limit]
    return SyncPage(
        revision=kept[-1].row.revision if has_more else hi,
        has_more=has_more,
        changes=kept,
    )
