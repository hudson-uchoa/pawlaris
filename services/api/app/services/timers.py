from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, TaskTimer
from app.schemas.timers import TimerCreate


async def create_timer(
    session: AsyncSession, user: AppUser, body: TimerCreate
) -> TaskTimer:
    raise NotImplementedError


async def cancel_timer(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskTimer:
    raise NotImplementedError
