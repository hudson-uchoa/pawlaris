from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.storage.base import StorageAdapter


async def run_maintenance(
    session: AsyncSession, clock: Clock, storage: StorageAdapter
) -> None:
    raise NotImplementedError


async def _prune_refresh_tokens(session: AsyncSession, clock: Clock) -> None:
    # Q-19: detach retained children before pruning their expired parents.
    raise NotImplementedError
