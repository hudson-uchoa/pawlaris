from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import RequestClock
from app.schemas.pets import (
    HealthEventCreate,
    HealthEventPatch,
    PetCreate,
    PetPatch,
    WeightCreate,
)
from app.schemas.rows import HealthEvent, Pet, WeightEntry
from app.services import pets

router = APIRouter()
PetMutation = Annotated[IdempotentMutation, Depends(idempotent("pets"))]
WeightMutation = Annotated[IdempotentMutation, Depends(idempotent("weight_entries"))]
HealthMutation = Annotated[IdempotentMutation, Depends(idempotent("health_events"))]


@router.post("/pets", response_model=Pet)
async def create_pet(body: PetCreate, mutation: PetMutation) -> Pet:
    return cast(
        Pet,
        await mutation(lambda: pets.create_pet(mutation.session, mutation.user, body)),
    )


@router.patch("/pets/{id}", response_model=Pet)
async def patch_pet(id: UUID, body: PetPatch, mutation: PetMutation) -> Pet:
    return cast(
        Pet,
        await mutation(
            lambda: pets.patch_pet(mutation.session, mutation.user, id, body)
        ),
    )


@router.post("/pets/{id}/archive", response_model=Pet)
async def archive_pet(id: UUID, mutation: PetMutation, clock: RequestClock) -> Pet:
    return cast(
        Pet,
        await mutation(
            lambda: pets.archive_pet(mutation.session, mutation.user, id, clock)
        ),
    )


@router.post("/pets/{id}/unarchive", response_model=Pet)
async def unarchive_pet(id: UUID, mutation: PetMutation) -> Pet:
    return cast(
        Pet,
        await mutation(lambda: pets.unarchive_pet(mutation.session, mutation.user, id)),
    )


@router.post("/weights", response_model=WeightEntry)
async def create_weight(body: WeightCreate, mutation: WeightMutation) -> WeightEntry:
    return cast(
        WeightEntry,
        await mutation(
            lambda: pets.create_weight(mutation.session, mutation.user, body)
        ),
    )


@router.delete("/weights/{id}", response_model=WeightEntry)
async def delete_weight(
    id: UUID, mutation: WeightMutation, clock: RequestClock
) -> WeightEntry:
    return cast(
        WeightEntry,
        await mutation(
            lambda: pets.delete_weight(mutation.session, mutation.user, id, clock)
        ),
    )


@router.post("/health-events", response_model=HealthEvent)
async def create_health(
    body: HealthEventCreate, mutation: HealthMutation
) -> HealthEvent:
    return cast(
        HealthEvent,
        await mutation(
            lambda: pets.create_health(mutation.session, mutation.user, body)
        ),
    )


@router.patch("/health-events/{id}", response_model=HealthEvent)
async def patch_health(
    id: UUID, body: HealthEventPatch, mutation: HealthMutation
) -> HealthEvent:
    return cast(
        HealthEvent,
        await mutation(
            lambda: pets.patch_health(mutation.session, mutation.user, id, body)
        ),
    )


@router.delete("/health-events/{id}", response_model=HealthEvent)
async def delete_health(
    id: UUID, mutation: HealthMutation, clock: RequestClock
) -> HealthEvent:
    return cast(
        HealthEvent,
        await mutation(
            lambda: pets.delete_health(mutation.session, mutation.user, id, clock)
        ),
    )
