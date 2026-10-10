"""Implemented permission cases from the API contract, with valid requests."""

import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from uuid import uuid4

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import AppUser, HealthEvent, Pet, WeightEntry
from app.security.passwords import hash_password
from tests.factories import TestFamily


@dataclass(frozen=True)
class MatrixRequest:
    url: str
    json: dict[str, object] | None = None
    headers: dict[str, str] = field(default_factory=dict)


type RequestBuilder = Callable[[TestFamily, AppUser], Awaitable[MatrixRequest]]


@dataclass(frozen=True)
class PermissionCase:
    row: int
    method: str
    template: str
    request: RequestBuilder
    expected: dict[str, int]


async def read_me(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(url="/api/v1/me")


async def read_sync(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(url="/api/v1/sync?since=0")


async def patch_me(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(url="/api/v1/me", json={"display_name": "Matrix member"})


async def patch_family(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        "/api/v1/family", {"name": "Renamed family"}, {"Idempotency-Key": str(uuid4())}
    )


async def invite(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest("/api/v1/invites", {"role": "member"})


async def patch_member(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        f"/api/v1/family/members/{fam.users[1].id}",
        {"role": "leader"},
        {"Idempotency-Key": str(uuid4())},
    )


async def remove_member(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        f"/api/v1/family/members/{fam.users[1].id}",
        headers={"Idempotency-Key": str(uuid4())},
    )


async def change_password(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    current, replacement = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    encoded = await hash_password(current)
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                update(AppUser)
                .where(AppUser.id == actor.id, AppUser.family_id == fam.id)
                .values(password_hash=encoded)
            )
            await session.commit()
    finally:
        await engine.dispose()
    return MatrixRequest(
        url="/api/v1/me/password",
        json={"current_password": current, "new_password": replacement},
    )


async def create_pet(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        "/api/v1/pets",
        {"id": str(uuid4()), "name": "New pet", "species": "cat"},
        {"Idempotency-Key": str(uuid4())},
    )


async def patch_pet(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        f"/api/v1/pets/{fam.pets[0].id}",
        {"name": "Renamed pet"},
        {"Idempotency-Key": str(uuid4())},
    )


async def archive_pet(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        f"/api/v1/pets/{fam.pets[0].id}/archive",
        headers={"Idempotency-Key": str(uuid4())},
    )


async def unarchive_pet(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    from tests.factories import INSTANT

    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                update(Pet)
                .where(Pet.family_id == fam.id, Pet.id == fam.pets[0].id)
                .values(archived_at=INSTANT)
            )
            await session.commit()
    finally:
        await engine.dispose()
    return MatrixRequest(
        f"/api/v1/pets/{fam.pets[0].id}/unarchive",
        headers={"Idempotency-Key": str(uuid4())},
    )


async def create_weight(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        "/api/v1/weights",
        {
            "id": str(uuid4()),
            "pet_id": str(fam.pets[0].id),
            "weight_kg": 4.25,
            "measured_at": "2026-09-14T10:30:00Z",
        },
        {"Idempotency-Key": str(uuid4())},
    )


async def create_health(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(
        "/api/v1/health-events",
        {
            "id": str(uuid4()),
            "pet_id": str(fam.pets[0].id),
            "type": "vaccine",
            "title": "Vaccine",
            "occurred_at": "2026-09-14T10:30:00Z",
        },
        {"Idempotency-Key": str(uuid4())},
    )


async def health_target(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return await _target(fam, HealthEvent, {"title": "New title"})


async def weight_target(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return await _target(fam, WeightEntry, None)


async def _target(
    fam: TestFamily,
    model: type[HealthEvent] | type[WeightEntry],
    body: dict[str, object] | None,
) -> MatrixRequest:
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            row = model(**await fam.row_values(session, model.__tablename__))
            session.add(row)
            await session.commit()
            row_id = row.id
    finally:
        await engine.dispose()
    resource = "weights" if model is WeightEntry else "health-events"
    return MatrixRequest(
        f"/api/v1/{resource}/{row_id}", body, {"Idempotency-Key": str(uuid4())}
    )


PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/logout"),
        ("POST", "/api/v1/auth/redeem"),
    }
)

PERMISSION_MATRIX: list[PermissionCase] = [
    PermissionCase(1, "GET", "/api/v1/sync", read_sync, {"member": 200, "leader": 200}),
    PermissionCase(2, "GET", "/api/v1/me", read_me, {"member": 200, "leader": 200}),
    PermissionCase(2, "PATCH", "/api/v1/me", patch_me, {"member": 200, "leader": 200}),
    PermissionCase(
        2,
        "POST",
        "/api/v1/me/password",
        change_password,
        {"member": 204, "leader": 204},
    ),
    PermissionCase(
        3, "PATCH", "/api/v1/family", patch_family, {"member": 403, "leader": 200}
    ),
    PermissionCase(
        4, "POST", "/api/v1/invites", invite, {"member": 403, "leader": 200}
    ),
    PermissionCase(
        5,
        "PATCH",
        "/api/v1/family/members/{user_id}",
        patch_member,
        {"member": 403, "leader": 200},
    ),
    PermissionCase(
        6,
        "DELETE",
        "/api/v1/family/members/{user_id}",
        remove_member,
        {"member": 403, "leader": 200},
    ),
    PermissionCase(
        7, "POST", "/api/v1/pets", create_pet, {"member": 200, "leader": 200}
    ),
    PermissionCase(
        7, "PATCH", "/api/v1/pets/{id}", patch_pet, {"member": 200, "leader": 200}
    ),
    PermissionCase(
        8,
        "POST",
        "/api/v1/pets/{id}/archive",
        archive_pet,
        {"member": 403, "leader": 200},
    ),
    PermissionCase(
        8,
        "POST",
        "/api/v1/pets/{id}/unarchive",
        unarchive_pet,
        {"member": 403, "leader": 200},
    ),
    PermissionCase(
        9, "POST", "/api/v1/weights", create_weight, {"member": 200, "leader": 200}
    ),
    PermissionCase(
        9,
        "DELETE",
        "/api/v1/weights/{id}",
        weight_target,
        {"member": 200, "leader": 200},
    ),
    PermissionCase(
        10,
        "POST",
        "/api/v1/health-events",
        create_health,
        {"member": 200, "leader": 200},
    ),
    PermissionCase(
        10,
        "PATCH",
        "/api/v1/health-events/{id}",
        health_target,
        {"member": 200, "leader": 200},
    ),
    PermissionCase(
        10,
        "DELETE",
        "/api/v1/health-events/{id}",
        health_target,
        {"member": 200, "leader": 200},
    ),
]

# Test-only probe until production sync mutations arrive.
PROBE_PERMISSION_MATRIX: dict[tuple[str, str], dict[str, int]] = {
    ("POST", "/probe/pet"): {"member": 200, "leader": 200},
}
IDEMPOTENT_ROUTES: dict[tuple[str, str], str] = {
    ("POST", "/probe/pet"): "pets",
    ("PATCH", "/api/v1/family"): "family",
    ("PATCH", "/api/v1/family/members/{user_id}"): "members",
    ("DELETE", "/api/v1/family/members/{user_id}"): "members",
    ("POST", "/api/v1/pets"): "pets",
    ("PATCH", "/api/v1/pets/{id}"): "pets",
    ("POST", "/api/v1/pets/{id}/archive"): "pets",
    ("POST", "/api/v1/pets/{id}/unarchive"): "pets",
    ("POST", "/api/v1/weights"): "weight_entries",
    ("DELETE", "/api/v1/weights/{id}"): "weight_entries",
    ("POST", "/api/v1/health-events"): "health_events",
    ("PATCH", "/api/v1/health-events/{id}"): "health_events",
    ("DELETE", "/api/v1/health-events/{id}"): "health_events",
}
