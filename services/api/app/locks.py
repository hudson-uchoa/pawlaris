from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FamilyRevision


async def lock_family(session: AsyncSession, family_id: UUID) -> None:
    await session.execute(
        select(FamilyRevision.value)
        .where(FamilyRevision.family_id == family_id)
        .with_for_update()
    )
