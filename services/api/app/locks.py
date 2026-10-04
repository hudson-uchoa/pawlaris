from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


async def lock_family(session: AsyncSession, family_id: UUID) -> None:
    raise NotImplementedError("not implemented")
