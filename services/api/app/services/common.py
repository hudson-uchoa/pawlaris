from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, HealthEvent, Pet, WeightEntry

type OwnedModel = Pet | WeightEntry | HealthEvent


async def get_owned[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    *,
    include_deleted: bool = True,
) -> Model:
    raise NotImplementedError


async def create_owned[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    values: dict[str, object],
    *,
    references: tuple[tuple[type[OwnedModel], UUID], ...] = (),
) -> Model:
    raise NotImplementedError


async def patch_owned[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    body: BaseModel,
) -> Model:
    raise NotImplementedError


async def soft_delete[Model: OwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    user: AppUser,
    clock: Clock,
) -> Model:
    raise NotImplementedError
