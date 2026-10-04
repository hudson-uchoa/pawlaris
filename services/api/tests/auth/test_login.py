import hashlib
import secrets
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update

from app.clock import FrozenClock
from app.models import AppUser, RefreshToken
from app.security.tokens import decode_access
from app.settings import Settings
from tests.auth.conftest import LoginAccount


async def test_r1_6_login_returns_session_and_stores_only_refresh_digest(
    client: AsyncClient,
    account: LoginAccount,
    app: FastAPI,
    frozen_clock: FrozenClock,
    settings: Settings,
) -> None:
    response = await client.post("/api/v1/auth/login", json=account.body())
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"access_token", "refresh_token", "access_expires_at", "user"}
    assert body["access_expires_at"] == (
        frozen_clock.now() + timedelta(minutes=15)
    ).isoformat().replace("+00:00", "Z")
    assert body["user"] == {
        "id": str(account.user.id),
        "email": account.user.email,
        "display_name": account.user.display_name,
        "role": account.user.role,
        "color": account.user.color,
        "family_id": str(account.user.family_id),
    }
    claims = decode_access(body["access_token"], frozen_clock, settings)
    assert claims.sub == account.user.id
    async with app.state.session_factory() as session:
        row = (
            await session.scalars(
                select(RefreshToken).where(RefreshToken.user_id == account.user.id)
            )
        ).one()
        assert bool(
            row.token_hash == hashlib.sha256(body["refresh_token"].encode()).hexdigest()
        )
        assert row.parent_id is None
        assert row.rotated_at is None and row.revoked_at is None
        assert row.expires_at == frozen_clock.now() + timedelta(days=30)
        assert bool(account.credential not in response.text)


@pytest.mark.parametrize("fault", ["wrong_password", "unknown_email", "disabled"])
async def test_r1_5_login_rejects_bad_credentials_identically(
    client: AsyncClient,
    account: LoginAccount,
    app: FastAPI,
    frozen_clock: FrozenClock,
    fault: str,
) -> None:
    body = account.body()
    if fault == "wrong_password":
        body["password"] = secrets.token_urlsafe(24)
    elif fault == "unknown_email":
        body["email"] = f"{secrets.token_hex(12)}@example.invalid"
    else:
        async with app.state.session_factory() as session:
            await session.execute(
                update(AppUser)
                .where(AppUser.id == account.user.id)
                .values(disabled_at=frozen_clock.now())
            )
            await session.commit()
    response = await client.post("/api/v1/auth/login", json=body)
    assert response.status_code == 401
    assert response.json() == {
        "type": "about:blank",
        "title": "Unauthorized",
        "status": 401,
        "code": "invalid_credentials",
        "detail": "Invalid email or password.",
    }
    async with app.state.session_factory() as session:
        assert not (
            await session.scalars(
                select(RefreshToken).where(RefreshToken.user_id == account.user.id)
            )
        ).all()


async def test_r1_5_login_email_is_case_insensitive(
    client: AsyncClient,
    account: LoginAccount,
) -> None:
    body = account.body()
    body["email"] = body["email"].upper()
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 200


async def test_id1_auth_bodies_reject_unknown_fields_without_echoing_secrets(
    client: AsyncClient,
    account: LoginAccount,
) -> None:
    body = {**account.body(), "unexpected": secrets.token_hex(8)}
    response = await client.post("/api/v1/auth/login", json=body)
    assert response.status_code == 422
    assert all(value not in response.text for value in body.values())
