from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.sync import SyncPage


async def collect_changes(
    session: AsyncSession, family_id: UUID, since: int, limit: int, hi: int
) -> SyncPage:
    raise NotImplementedError
