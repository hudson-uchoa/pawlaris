from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, WalkRoute, WalkSession
from app.schemas.walks import WalkCreate, WalkFinish


async def create_walk(
    session: AsyncSession, user: AppUser, body: WalkCreate
) -> WalkSession:
    raise NotImplementedError("Walk start is not implemented.")


async def finish_walk(
    session: AsyncSession, user: AppUser, id: UUID, body: WalkFinish
) -> WalkSession:
    raise NotImplementedError("Walk finish is not implemented.")


async def discard_walk(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> WalkSession:
    raise NotImplementedError("Walk discard is not implemented.")


async def get_walk_route(session: AsyncSession, user: AppUser, id: UUID) -> WalkRoute:
    raise NotImplementedError("Walk route retrieval is not implemented.")
