from collections.abc import Awaitable, Callable
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.errors import ApiError
from app.models import (
    AppUser,
    HealthEvent,
    Pet,
    TaskTemplate,
    TaskTimer,
    WalkSession,
    WeightEntry,
)

type SoftDeletableModel = (
    AppUser | Pet | WeightEntry | HealthEvent | TaskTemplate | WalkSession
)
type OwnedModel = SoftDeletableModel | TaskTimer


async def get_owned[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    *,
    include_deleted: bool = True,
) -> Model:
    row = await _find_owned(session, model, id, user)
    if row is None or (
        not include_deleted
        and not isinstance(row, TaskTimer)
        and row.deleted_at is not None
    ):
        raise ApiError(404, "not_found", "Row not found.")
    return row


async def create_owned[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    values: dict[str, object],
    *,
    references: tuple[tuple[type[OwnedModel], UUID], ...] = (),
    validate: Callable[[], Awaitable[None]] | None = None,
) -> Model:
    existing = await _find_owned(session, model, id, user)
    if existing is not None:
        return existing
    for reference_model, reference_id in references:
        await get_owned(session, reference_model, reference_id, user)
    if validate is not None:
        await validate()
    if model is TaskTimer:
        actor_column = "started_by"
    elif model is WalkSession:
        actor_column = "user_id"
    else:
        actor_column = "created_by"
    row = await session.scalar(
        insert(model)
        .values(**values, family_id=user.family_id, **{actor_column: user.id})
        .on_conflict_do_nothing(index_elements=[model.id])
        .returning(model)
    )
    # A globally occupied id can belong to another family. The scoped lookup
    # returns 404 in that case, without revealing who owns it.
    return row if row is not None else await get_owned(session, model, id, user)


async def patch_owned[Model: SoftDeletableModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    body: BaseModel,
    *,
    validate: Callable[[Model], Awaitable[None]] | None = None,
) -> Model:
    row = await get_owned(session, model, id, user, include_deleted=False)
    if validate is not None:
        await validate(row)
    for field in body.model_fields_set:
        setattr(row, field, getattr(body, field))
    return row


async def soft_delete[Model: SoftDeletableModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    clock: Clock,
    *,
    validate: Callable[[Model], Awaitable[None]] | None = None,
) -> Model:
    row = await get_owned(session, model, id, user)
    if validate is not None:
        await validate(row)
    # Q-15: a later delete returns the original tombstone without an update.
    if row.deleted_at is None:
        row.deleted_at = clock.now()
    return row


async def validate_owned_list[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    ids: list[UUID],
    user: AppUser,
    field: str,
) -> None:
    unique_ids = set(ids)
    if len(unique_ids) != len(ids):
        raise RequestValidationError(
            [
                {
                    "loc": ("body", field),
                    "msg": "References must be unique.",
                    "type": "value_error",
                }
            ]
        )
    found = set(
        await session.scalars(
            select(model.id).where(
                model.family_id == user.family_id, model.id.in_(unique_ids)
            )
        )
    )
    if found != unique_ids:
        raise RequestValidationError(
            [
                {
                    "loc": ("body", field),
                    "msg": "Every reference must belong to the family.",
                    "type": "value_error",
                }
            ]
        )


async def _find_owned[Model: OwnedModel](
    session: AsyncSession, model: type[Model], id: UUID, user: AppUser
) -> Model | None:
    return await session.scalar(
        select(model)
        .where(model.family_id == user.family_id, model.id == id)
        .execution_options(populate_existing=True)
    )
