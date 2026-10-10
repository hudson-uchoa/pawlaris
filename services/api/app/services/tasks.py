from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, TaskTemplate
from app.schemas.tasks import TaskCreate, TaskPatch


async def create_task(
    session: AsyncSession, user: AppUser, body: TaskCreate
) -> TaskTemplate:
    raise NotImplementedError


async def patch_task(
    session: AsyncSession, user: AppUser, id: UUID, body: TaskPatch
) -> TaskTemplate:
    raise NotImplementedError


async def delete_task(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskTemplate:
    raise NotImplementedError
