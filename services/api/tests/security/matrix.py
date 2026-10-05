"""Implemented permission cases from the API contract, with valid requests."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from app.models import AppUser
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
    raise NotImplementedError("not implemented")


async def patch_me(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    raise NotImplementedError("not implemented")


async def change_password(fam: TestFamily, actor: AppUser) -> MatrixRequest:
    raise NotImplementedError("not implemented")


PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/logout"),
        ("POST", "/api/v1/auth/redeem"),
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
