from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, HealthEvent, Pet, WeightEntry
from app.schemas.pets import (
    HealthEventCreate,
    HealthEventPatch,
    PetCreate,
    PetPatch,
    WeightCreate,
)


async def create_pet(session: AsyncSession, user: AppUser, body: PetCreate) -> Pet:
    raise NotImplementedError


async def patch_pet(
    session: AsyncSession, user: AppUser, id: UUID, body: PetPatch
) -> Pet:
    raise NotImplementedError


async def archive_pet(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> Pet:
    raise NotImplementedError


async def unarchive_pet(session: AsyncSession, user: AppUser, id: UUID) -> Pet:
    raise NotImplementedError


async def create_weight(
    session: AsyncSession, user: AppUser, body: WeightCreate
) -> WeightEntry:
    raise NotImplementedError


async def delete_weight(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> WeightEntry:
    raise NotImplementedError


async def create_health(
    session: AsyncSession, user: AppUser, body: HealthEventCreate
) -> HealthEvent:
    raise NotImplementedError


async def patch_health(
    session: AsyncSession, user: AppUser, id: UUID, body: HealthEventPatch
) -> HealthEvent:
    raise NotImplementedError


async def delete_health(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> HealthEvent:
    raise NotImplementedError
