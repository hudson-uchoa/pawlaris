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
from app.services import common, family


async def create_pet(session: AsyncSession, user: AppUser, body: PetCreate) -> Pet:
    return await common.create_owned(
        session, Pet, body.id, user, body.model_dump(exclude_unset=True)
    )


async def patch_pet(
    session: AsyncSession, user: AppUser, id: UUID, body: PetPatch
) -> Pet:
    return await common.patch_owned(session, Pet, id, user, body)


async def archive_pet(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> Pet:
    row = await common.get_owned(session, Pet, id, user, include_deleted=False)
    await family._locked_leader(session, user)
    if row.archived_at is None:
        row.archived_at = clock.now()
    return row


async def unarchive_pet(session: AsyncSession, user: AppUser, id: UUID) -> Pet:
    row = await common.get_owned(session, Pet, id, user, include_deleted=False)
    await family._locked_leader(session, user)
    row.archived_at = None
    return row


async def create_weight(
    session: AsyncSession, user: AppUser, body: WeightCreate
) -> WeightEntry:
    return await common.create_owned(
        session,
        WeightEntry,
        body.id,
        user,
        body.model_dump(exclude_unset=True),
        references=((Pet, body.pet_id),),
    )


async def delete_weight(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> WeightEntry:
    return await common.soft_delete(session, WeightEntry, id, user, clock)


async def create_health(
    session: AsyncSession, user: AppUser, body: HealthEventCreate
) -> HealthEvent:
    return await common.create_owned(
        session,
        HealthEvent,
        body.id,
        user,
        body.model_dump(exclude_unset=True),
        references=((Pet, body.pet_id),),
    )


async def patch_health(
    session: AsyncSession, user: AppUser, id: UUID, body: HealthEventPatch
) -> HealthEvent:
    return await common.patch_owned(session, HealthEvent, id, user, body)


async def delete_health(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> HealthEvent:
    return await common.soft_delete(session, HealthEvent, id, user, clock)
