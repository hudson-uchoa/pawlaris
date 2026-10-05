"""Implemented permission cases from the API contract, with valid requests."""

import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import AppUser
from app.security.passwords import hash_password
from tests.factories import TestFamily


@dataclass(frozen=True)
class MatrixRequest:
    json: dict[str, object] | None = None
    headers: dict[str, str] = field(default_factory=dict)


type RequestBuilder = Callable[[TestFamily, AppUser], Awaitable[MatrixRequest]]


@dataclass(frozen=True)
class PermissionCase:
    row: int
    request: RequestBuilder
    expected: dict[str, int]


async def read_me(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest()


async def patch_me(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    return MatrixRequest(json={"display_name": "Matrix member"})


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
        json={"current_password": current, "new_password": replacement}
    )


PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/logout"),
    }
)

PERMISSION_MATRIX: dict[tuple[str, str], PermissionCase] = {
    ("GET", "/api/v1/me"): PermissionCase(2, read_me, {"member": 200, "leader": 200}),
    ("PATCH", "/api/v1/me"): PermissionCase(
        2, patch_me, {"member": 200, "leader": 200}
    ),
    ("POST", "/api/v1/me/password"): PermissionCase(
        2, change_password, {"member": 204, "leader": 204}
    ),
}

# Test-only probe until production sync mutations arrive.
PROBE_PERMISSION_MATRIX: dict[tuple[str, str], dict[str, int]] = {
    ("POST", "/probe/pet"): {"member": 200, "leader": 200},
}
IDEMPOTENT_ROUTES: dict[tuple[str, str], str] = {("POST", "/probe/pet"): "pets"}
