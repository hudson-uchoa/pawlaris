from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.errors import ApiError
from app.models import AppUser, Pet, TaskTemplate
from app.schemas.tasks import TaskCreate, TaskPatch
from app.services import common


async def create_task(
    session: AsyncSession, user: AppUser, body: TaskCreate
) -> TaskTemplate:
    values = body.model_dump(exclude_unset=True)
    # Only the recurrence JSON uses JSON-mode serialization; column dates and
    # UUIDs remain typed. No recurrence is evaluated on the server.
    values["recurrence"] = body.recurrence.model_dump(mode="json")

    async def validate() -> None:
        await common.validate_owned_list(session, Pet, body.pet_ids, user, "pet_ids")
        previous = (
            await common.get_owned(session, TaskTemplate, body.replaces_task_id, user)
            if body.replaces_task_id is not None
            else None
        )
        assignee = await _normalize_assignee(session, user, body.assigned_to)
        if "assigned_to" in body.model_fields_set:
            values["assigned_to"] = assignee
        _require_assignment(user, assignee, previous)

    return await common.create_owned(
        session, TaskTemplate, body.id, user, values, validate=validate
    )


async def patch_task(
    session: AsyncSession, user: AppUser, id: UUID, body: TaskPatch
) -> TaskTemplate:

    async def validate(row: TaskTemplate) -> None:
        if "assigned_to" in body.model_fields_set:
            body.assigned_to = await _normalize_assignee(
                session, user, body.assigned_to
            )
        _require_edit(user, row)
        if "assigned_to" in body.model_fields_set:
            _require_assignment(user, body.assigned_to)

    return await common.patch_owned(
        session, TaskTemplate, id, user, body, validate=validate
    )


async def delete_task(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskTemplate:

    async def validate(row: TaskTemplate) -> None:
        _require_edit(user, row)

    return await common.soft_delete(
        session, TaskTemplate, id, user, clock, validate=validate
    )


async def _normalize_assignee(
    session: AsyncSession, user: AppUser, assigned_to: UUID | None
) -> UUID | None:
    if assigned_to is None:
        return None
    member = await common.get_owned(session, AppUser, assigned_to, user)
    # Q-16 owner decision: normalize before applying assignment permissions.
    return None if member.disabled_at is not None else member.id


def _require_edit(user: AppUser, row: TaskTemplate) -> None:
    if user.role != "leader" and row.created_by != user.id:
        raise ApiError(
            403, "forbidden", "Only the creator or a leader may edit a task."
        )


def _require_assignment(
    user: AppUser, assigned_to: UUID | None, previous: TaskTemplate | None = None
) -> None:
    if user.role == "leader" or assigned_to is None or assigned_to == user.id:
        return
    if (
        previous is not None
        and previous.created_by == user.id
        and previous.assigned_to == assigned_to
    ):
        return
    raise ApiError(403, "forbidden", "Only a leader may assign a task to someone else.")
