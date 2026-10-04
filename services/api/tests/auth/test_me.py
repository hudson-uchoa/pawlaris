import logging
import secrets
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update

from app.clock import FrozenClock
from app.models import AppUser, RefreshToken
from tests.auth.conftest import LoginAccount
from tests.conftest import ClientFor
from tests.factories import MakeFamily


async def test_r1_6_me_get_and_patch_persist_only_callers_display_name(
    account: LoginAccount,
    client_for: ClientFor,
    app: FastAPI,
) -> None:
    client = client_for(account.user)
    response = await client.get("/api/v1/me")
    assert response.status_code == 200
    assert set(response.json()) == {
        "id",
        "email",
        "display_name",
        "role",
        "color",
        "family_id",
    }
    assert response.json()["id"] == str(account.user.id)
    patched = await client.patch("/api/v1/me", json={"display_name": "Changed name"})
    assert patched.status_code == 200
    assert patched.json() == {**response.json(), "display_name": "Changed name"}
    async with app.state.session_factory() as session:
        users = list(
            (
                await session.scalars(
                    select(AppUser).where(AppUser.family_id == account.family.id)
                )
            ).all()
        )
        assert (
            next(u for u in users if u.id == account.user.id).display_name
            == "Changed name"
        )
        assert (
            next(u for u in users if u.id != account.user.id).display_name == "Member 1"
        )


async def test_r1_6_current_user_reloads_role_instead_of_trusting_claim(
    account: LoginAccount,
    client_for: ClientFor,
    app: FastAPI,
) -> None:
    client = client_for(account.user)
    async with app.state.session_factory() as session:
        await session.execute(
            update(AppUser).where(AppUser.id == account.user.id).values(role="member")
        )
        await session.commit()
    response = await client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["role"] == "member"


@pytest.mark.parametrize(
    "fault", ["missing", "malformed", "expired", "disabled", "unknown", "family"]
)
async def test_r1_6_me_rejects_invalid_or_disabled_access(
    account: LoginAccount,
    client_for: ClientFor,
    client: AsyncClient,
    app: FastAPI,
    frozen_clock: FrozenClock,
    fault: str,
) -> None:
    actor = account.user
    if fault == "unknown":
        actor = AppUser(id=uuid4(), family_id=actor.family_id, role="leader")
    elif fault == "family":
        actor = AppUser(id=actor.id, family_id=uuid4(), role="leader")
    authorized = client_for(actor)
    if fault == "missing":
        authorized = client
    elif fault == "malformed":
        authorized.headers["Authorization"] = f"Bearer {secrets.token_urlsafe(24)}"
    elif fault == "expired":
        frozen_clock.advance(timedelta(minutes=15))
    elif fault == "disabled":
        async with app.state.session_factory() as session:
            await session.execute(
                update(AppUser)
                .where(AppUser.id == account.user.id)
                .values(disabled_at=frozen_clock.now())
            )
            await session.commit()
    for method, path, body in [
        ("GET", "/api/v1/me", None),
        ("PATCH", "/api/v1/me", {"display_name": "Changed"}),
        (
            "POST",
            "/api/v1/me/password",
            {
                "current_password": account.credential,
                "new_password": secrets.token_urlsafe(24),
            },
        ),
    ]:
        response = await authorized.request(method, path, json=body)
        assert response.status_code == 401
        assert response.json()["code"] == "token_invalid"


async def test_r1_12_password_change_revokes_all_own_chains_and_allows_new_login(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    client_for: ClientFor,
    app: FastAPI,
    frozen_clock: FrozenClock,
    make_family: MakeFamily,
) -> None:
    second = await client.post("/api/v1/auth/login", json=account.body())
    assert second.status_code == 200
    # An unrelated chain must survive the password change.
    other = (await make_family()).users[0]
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=uuid4(),
                user_id=other.id,
                chain_id=uuid4(),
                token_hash=secrets.token_hex(32),
                expires_at=frozen_clock.now() + timedelta(days=30),
            )
        )
        await session.commit()
    credential = secrets.token_urlsafe(24)
    response = await client_for(account.user).post(
        "/api/v1/me/password",
        json={
            "current_password": account.credential,
            "new_password": credential,
        },
    )
    assert response.status_code == 204 and response.content == b""
    async with app.state.session_factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(RefreshToken).where(
                        RefreshToken.user_id.in_([account.user.id, other.id])
                    )
                )
            ).all()
        )
        assert sum(r.revoked_at == frozen_clock.now() for r in rows) == 2
        assert next(r for r in rows if r.user_id == other.id).revoked_at is None
    for token in [logged_in["refresh_token"], second.json()["refresh_token"]]:
        refreshed = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": token}
        )
        assert refreshed.status_code == 401
    assert (
        await client.post("/api/v1/auth/login", json=account.body())
    ).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"email": account.user.email, "password": credential},
        )
    ).status_code == 200


async def test_r1_12_wrong_current_password_changes_nothing(
    account: LoginAccount,
    client_for: ClientFor,
    client: AsyncClient,
    logged_in: dict[str, str],
    app: FastAPI,
) -> None:
    response = await client_for(account.user).post(
        "/api/v1/me/password",
        json={
            "current_password": secrets.token_urlsafe(24),
            "new_password": secrets.token_urlsafe(24),
        },
    )
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"
    async with app.state.session_factory() as session:
        assert all(
            r.revoked_at is None
            for r in (
                await session.scalars(
                    select(RefreshToken).where(RefreshToken.user_id == account.user.id)
                )
            ).all()
        )
    assert (
        await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": logged_in["refresh_token"]}
        )
    ).status_code == 200
    assert (
        await client.post("/api/v1/auth/login", json=account.body())
    ).status_code == 200


@pytest.mark.parametrize("length", [0, 7, 129])
async def test_r1_12_password_length_rejected_without_echoing_input(
    account: LoginAccount,
    client_for: ClientFor,
    length: int,
) -> None:
    credential = secrets.token_hex(65)[:length]
    response = await client_for(account.user).post(
        "/api/v1/me/password",
        json={
            "current_password": account.credential,
            "new_password": credential,
        },
    )
    assert response.status_code == 422
    if credential:
        assert bool(credential not in response.text)


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": ""},
        {"display_name": "x" * 41},
        {"display_name": None},
        {"role": "leader"},
    ],
)
async def test_r1_6_me_patch_rejects_invalid_names_and_extra_fields(
    account: LoginAccount,
    client_for: ClientFor,
    body: dict[str, object],
) -> None:
    assert (
        await client_for(account.user).patch("/api/v1/me", json=body)
    ).status_code == 422


async def test_id1_auth_requests_do_not_log_credentials_or_bodies(
    client: AsyncClient,
    account: LoginAccount,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="pawlaris.request")
    logged = await client.post("/api/v1/auth/login", json=account.body())
    assert logged.status_code == 200
    tokens = logged.json()
    await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    await client.post(
        "/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}
    )
    assert bool(account.credential not in caplog.text)
    assert bool(account.user.email not in caplog.text)
    assert all(
        tokens[key] not in caplog.text for key in ["access_token", "refresh_token"]
    )
