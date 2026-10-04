import asyncio
import hashlib
import secrets
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select, update

from app.clock import FrozenClock
from app.models import AppUser, PushDevice, RefreshToken
from tests.auth.conftest import LoginAccount


async def exchange(client: AsyncClient, token: str) -> Response:
    return await client.post("/api/v1/auth/refresh", json={"refresh_token": token})


async def chain_rows(app: FastAPI, account: LoginAccount) -> list[RefreshToken]:
    async with app.state.session_factory() as session:
        return list(
            (
                await session.scalars(
                    select(RefreshToken).where(RefreshToken.user_id == account.user.id)
                )
            ).all()
        )


async def test_r1_8_lost_response_replay_has_no_grace_timeout(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    app: FastAPI,
    frozen_clock: FrozenClock,
) -> None:
    original = logged_in["refresh_token"]
    first = await exchange(client, original)
    assert first.status_code == 200
    frozen_clock.advance(timedelta(days=20))
    second = await exchange(client, original)
    third = await exchange(client, original)
    assert [second.status_code, third.status_code] == [200, 200]
    assert len({r.json()["refresh_token"] for r in [first, second, third]}) == 3
    rows = await chain_rows(app, account)
    parent = next(row for row in rows if row.parent_id is None)
    assert parent.rotated_at == frozen_clock.now() - timedelta(days=20)
    assert len(rows) == 4
    assert {row.chain_id for row in rows} == {parent.chain_id}
    children = [row for row in rows if row.parent_id is not None]
    assert {row.parent_id for row in children} == {parent.id}
    assert all(row.rotated_at is None and row.revoked_at is None for row in children)
    for response in [second, third]:
        digest = hashlib.sha256(response.json()["refresh_token"].encode()).hexdigest()
        child = next(row for row in children if row.token_hash == digest)
        assert child.expires_at == frozen_clock.now() + timedelta(days=30)


async def test_r1_8_used_successor_revokes_entire_chain_before_401(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    app: FastAPI,
    frozen_clock: FrozenClock,
) -> None:
    independent = await client.post("/api/v1/auth/login", json=account.body())
    assert independent.status_code == 200
    first = await exchange(client, logged_in["refresh_token"])
    assert first.status_code == 200
    sibling = await exchange(client, logged_in["refresh_token"])
    assert sibling.status_code == 200
    second = await exchange(client, first.json()["refresh_token"])
    assert second.status_code == 200
    response = await exchange(client, logged_in["refresh_token"])
    assert response.status_code == 401
    assert response.json()["code"] == "token_invalid"
    rows = await chain_rows(app, account)
    original_digest = hashlib.sha256(logged_in["refresh_token"].encode()).hexdigest()
    chain = next(row.chain_id for row in rows if row.token_hash == original_digest)
    revoked = [row for row in rows if row.chain_id == chain]
    assert len(revoked) == 4
    assert all(row.revoked_at == frozen_clock.now() for row in revoked)
    assert all(row.revoked_at is None for row in rows if row.chain_id != chain)
    for token in [first, sibling, second]:
        assert (
            await exchange(client, token.json()["refresh_token"])
        ).status_code == 401
    assert (
        await exchange(client, independent.json()["refresh_token"])
    ).status_code == 200


@pytest.mark.parametrize("fault", ["unknown", "expired", "revoked", "disabled"])
async def test_r1_6_invalid_refresh_is_rejected(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    app: FastAPI,
    frozen_clock: FrozenClock,
    fault: str,
) -> None:
    token = logged_in["refresh_token"]
    if fault == "unknown":
        token = secrets.token_urlsafe(32)
    elif fault == "expired":
        frozen_clock.advance(timedelta(days=30))
    else:
        async with app.state.session_factory() as session:
            if fault == "revoked":
                await session.execute(
                    update(RefreshToken)
                    .where(RefreshToken.user_id == account.user.id)
                    .values(revoked_at=frozen_clock.now())
                )
            else:
                await session.execute(
                    update(AppUser)
                    .where(AppUser.id == account.user.id)
                    .values(disabled_at=frozen_clock.now())
                )
            await session.commit()
    response = await exchange(client, token)
    assert response.status_code == 401
    assert response.json()["code"] == "token_invalid"
    assert len(await chain_rows(app, account)) == 1


async def test_r1_8_concurrent_original_replays_create_distinct_successors(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    app: FastAPI,
) -> None:
    responses = await asyncio.gather(
        *[exchange(client, logged_in["refresh_token"]) for _ in range(4)]
    )
    assert [r.status_code for r in responses] == [200] * 4
    assert len({r.json()["refresh_token"] for r in responses}) == 4
    rows = await chain_rows(app, account)
    parent = next(row for row in rows if row.parent_id is None)
    assert len(rows) == 5
    assert all(row.parent_id == parent.id for row in rows if row.id != parent.id)


async def test_r1_11_logout_revokes_only_presented_chain_and_keeps_push_device(
    client: AsyncClient,
    account: LoginAccount,
    logged_in: dict[str, str],
    app: FastAPI,
    frozen_clock: FrozenClock,
) -> None:
    other = await client.post("/api/v1/auth/login", json=account.body())
    assert other.status_code == 200
    successor = await exchange(client, logged_in["refresh_token"])
    assert successor.status_code == 200
    push = secrets.token_urlsafe(24)
    async with app.state.session_factory() as session:
        session.add(PushDevice(token=push, user_id=account.user.id))
        await session.commit()
    for token in [
        logged_in["refresh_token"],
        logged_in["refresh_token"],
        secrets.token_urlsafe(32),
    ]:
        response = await client.post(
            "/api/v1/auth/logout", json={"refresh_token": token}
        )
        assert response.status_code == 204 and response.content == b""
    rows = await chain_rows(app, account)
    assert sum(row.revoked_at == frozen_clock.now() for row in rows) == 2
    assert (
        await exchange(client, successor.json()["refresh_token"])
    ).status_code == 401
    assert (await exchange(client, other.json()["refresh_token"])).status_code == 200
    async with app.state.session_factory() as session:
        assert await session.get(PushDevice, push) is not None
