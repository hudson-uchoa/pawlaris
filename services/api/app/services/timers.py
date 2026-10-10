from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, Pet, TaskTemplate, TaskTimer
from app.schemas.timers import TimerCreate
from app.services import common


async def create_timer(
    session: AsyncSession, user: AppUser, body: TimerCreate
) -> TaskTimer:
    references: tuple[tuple[type[common.OwnedModel], UUID], ...] = (
        (TaskTemplate, body.task_id),
    )
    if body.pet_id is not None:
        references += ((Pet, body.pet_id),)
    return await common.create_owned(
        session,
        TaskTimer,
        body.id,
        user,
        body.model_dump(exclude_unset=True),
        references=references,
    )


async def cancel_timer(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskTimer:
    row = await common.get_owned(session, TaskTimer, id, user)
    if row.cancelled_at is None:
        row.cancelled_at = clock.now()
    return row
