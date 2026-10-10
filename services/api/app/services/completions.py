from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.errors import ApiError
from app.models import AppUser, TaskCompletion, TaskTemplate
from app.schemas.completions import CompletionCreate
from app.services.common import get_owned

type CompletionOutcome = Literal["created", "existing", "lost"]


async def create_completion(
    session: AsyncSession, user: AppUser, body: CompletionCreate, clock: Clock
) -> tuple[TaskCompletion, CompletionOutcome]:
    task = await get_owned(session, TaskTemplate, body.task_id, user)
    if (task.completion_mode == "per_pet" and body.pet_id not in task.pet_ids) or (
        task.completion_mode == "together" and body.pet_id is not None
    ):
        raise RequestValidationError(
            [
                {
                    "loc": ("body", "pet_id"),
                    "msg": "Pet must match the template's completion mode and pets.",
                    "type": "value_error",
                }
            ]
        )
    completed_at = min(body.completed_at, clock.now() + timedelta(minutes=5))
    values = body.model_dump()
    values.update(
        family_id=user.family_id,
        completed_by=user.id,
        completed_at=completed_at,
        title_snapshot=task.title,
    )
    for _ in range(3):
        row = await session.scalar(
            insert(TaskCompletion)
            .values(**values)
            .on_conflict_do_nothing()
            .returning(TaskCompletion)
        )
        if row is not None:
            return row, "created"
        row = await session.scalar(
            select(TaskCompletion)
            .where(
                TaskCompletion.id == body.id,
                TaskCompletion.family_id == user.family_id,
            )
            .execution_options(populate_existing=True)
        )
        if row is not None:
            return row, "existing"
        row = await session.scalar(
            select(TaskCompletion)
            .where(
                TaskCompletion.task_id == body.task_id,
                TaskCompletion.occurrence_key == body.occurrence_key,
                TaskCompletion.pet_id.is_not_distinct_from(body.pet_id),
                TaskCompletion.undone_at.is_(None),
            )
            .execution_options(populate_existing=True)
        )
        if row is not None:
            return row, "lost"
        # The winner was undone between INSERT and SELECT; try again.
    foreign_id = await session.scalar(
        select(TaskCompletion.id).where(
            TaskCompletion.id == body.id,
            TaskCompletion.family_id != user.family_id,
        )
    )
    if foreign_id is not None:
        raise ApiError(404, "not_found", "Completion not found.")
    raise ApiError(500, "internal_error", "Internal server error.")


async def undo_completion(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskCompletion:
    row = await session.scalar(
        update(TaskCompletion)
        .where(
            TaskCompletion.id == id,
            TaskCompletion.family_id == user.family_id,
            TaskCompletion.undone_at.is_(None),
        )
        .values(undone_at=clock.now(), undone_by=user.id)
        .returning(TaskCompletion)
        .execution_options(populate_existing=True)
    )
    if row is not None:
        return row
    row = await session.scalar(
        select(TaskCompletion)
        .where(TaskCompletion.id == id, TaskCompletion.family_id == user.family_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        raise ApiError(404, "not_found", "Completion not found.")
    return row
