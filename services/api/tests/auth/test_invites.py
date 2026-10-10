import asyncio
import secrets
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select, update
from sqlalchemy.engine import ScalarResult
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.cli import IDENTITY_KEYS
from app.clock import FrozenClock
from app.models import AppUser, FamilyRevision, InviteCode, RefreshToken
from app.security.passwords import verify_password
from app.services import family as service
from tests.conftest import ClientFor
from tests.factories import MakeFamily


def redeem_body(code: str) -> dict[str, str]:
    return {
        "code": code,
        "email": f"{uuid4().hex}@example.invalid",
        "password": secrets.token_urlsafe(24),
        "display_name": "Invited member",
    }


@pytest.mark.parametrize(
    "email",
    [
        "",
        " ",
        "no-at-sign",
        "@example.invalid",
        "name@",
        "a b@example.invalid",
        "a\t@example.invalid",
        "a\n@example.invalid",
        "x" * 243 + "@example.org",
        "removed+member@pawlaris.invalid",
        "name@PAWLARIS.INVALID",
    ],
)
async def test_r1_3_invalid_email_leaves_invite_unused(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    email: str,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    body = redeem_body(invite["code"])
    body["email"] = email
    response = await client.post("/api/v1/auth/redeem", json=body)
    assert response.status_code == 422
    async with app.state.session_factory() as session:
        row = await session.get(InviteCode, invite["code"])
        assert row is not None and row.used_at is None and row.used_by is None


async def create_invite(client: AsyncClient) -> dict[str, str]:
    response = await client.post("/api/v1/invites", json={"role": "member"})
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("fault", ["hash", "commit"])
async def test_r1_3_failure_after_claim_rolls_back_all_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    fault: str,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    body = redeem_body(invite["code"])
    async with app.state.session_factory() as session:
        before = await session.scalar(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
        )
        token_count = await session.scalar(
            select(func.count()).select_from(RefreshToken)
        )
    original_hash, original_commit = service.hash_password, AsyncSession.commit

    async def fail_hash(value: str) -> str:
        raise RuntimeError("Injected hashing failure")

    async def fail_commit(session: AsyncSession) -> None:
        raise RuntimeError("Injected commit failure")

    if fault == "hash":
        monkeypatch.setattr(service, "hash_password", fail_hash)
    else:
        monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    assert (await client.post("/api/v1/auth/redeem", json=body)).status_code == 500
    async with app.state.session_factory() as session:
        invite_row = await session.get(InviteCode, invite["code"])
        assert (
            invite_row is not None
            and invite_row.used_at is None
            and invite_row.used_by is None
        )
        assert (
            await session.scalar(
                select(AppUser.id).where(AppUser.email == body["email"])
            )
            is None
        )
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == before
        )
        assert (
            await session.scalar(select(func.count()).select_from(RefreshToken))
            == token_count
        )
    monkeypatch.setattr(service, "hash_password", original_hash)
    monkeypatch.setattr(AsyncSession, "commit", original_commit)
    assert (await client.post("/api/v1/auth/redeem", json=body)).status_code == 200


@pytest.mark.parametrize(
    "occupied,expected",
    [(IDENTITY_KEYS[:7], IDENTITY_KEYS[7]), (IDENTITY_KEYS, IDENTITY_KEYS[0])],
)
async def test_r1_3_identity_uses_first_available_key_then_wraps(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    occupied: tuple[str, ...],
    expected: str,
) -> None:
    family = await make_family(members=len(occupied))
    async with app.state.session_factory() as session:
        for user, color in zip(family.users, occupied, strict=True):
            await session.execute(
                update(AppUser).where(AppUser.id == user.id).values(color=color)
            )
        await session.commit()
    invite = await create_invite(client_for(family.users[0]))
    response = await client.post(
        "/api/v1/auth/redeem", json=redeem_body(invite["code"])
    )
    assert response.status_code == 200 and response.json()["user"]["color"] == expected


async def test_r1_3_ninth_and_tenth_users_spread_identity_keys(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family(members=8)
    async with app.state.session_factory() as session:
        for index, user in enumerate(family.users):
            await session.execute(
                update(AppUser)
                .where(AppUser.id == user.id)
                .values(
                    color=IDENTITY_KEYS[index],
                    disabled_at=None if index == 0 else frozen_clock.now(),
                )
            )
        await session.commit()
    for expected in IDENTITY_KEYS[:2]:
        invite = await create_invite(client_for(family.users[0]))
        response = await client.post(
            "/api/v1/auth/redeem", json=redeem_body(invite["code"])
        )
        assert response.status_code == 200
        assert response.json()["user"]["color"] == expected


@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r1_3_invite_redeem_records_role_identity_and_used_by(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    frozen_clock: FrozenClock,
    role: str,
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).post(
        "/api/v1/invites", json={"role": role}
    )
    unused = await create_invite(client_for(family.users[0]))
    assert response.status_code == 200
    invite = response.json()
    assert set(invite) == {"code", "role", "expires_at"}
    assert len(invite["code"]) == 10 and set(invite["code"]) <= set(
        "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    )
    assert invite["expires_at"] == (
        frozen_clock.now() + timedelta(hours=24)
    ).isoformat().replace("+00:00", "Z")
    body = redeem_body(invite["code"])
    redeemed = await client.post("/api/v1/auth/redeem", json=body)
    assert redeemed.status_code == 200
    result = redeemed.json()
    assert set(result) == {"access_token", "refresh_token", "access_expires_at", "user"}
    user = result["user"]
    assert user["family_id"] == str(family.id) and user["role"] == role
    assert user["display_name"] == body["display_name"] and user["color"] == "#B15B6B"
    async with app.state.session_factory() as session:
        stored = await session.get(InviteCode, invite["code"])
        assert stored is not None
        assert (
            stored.used_by == UUID(user["id"]) and stored.used_at == frozen_clock.now()
        )
        assert stored.created_by == family.users[0].id and stored.role == role
        untouched = await session.get(InviteCode, unused["code"])
        assert untouched is not None and untouched.used_by is None
        account = await session.get(AppUser, UUID(user["id"]))
        assert account is not None
        assert await verify_password(body["password"], account.password_hash)
        assert (
            await session.scalar(
                select(func.count())
                .select_from(RefreshToken)
                .where(RefreshToken.user_id == account.id)
            )
            == 1
        )
    me = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {result['access_token']}"}
    )
    assert me.status_code == 200 and me.json() == user
    assert (
        await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": result["refresh_token"]}
        )
    ).status_code == 200
    again = await client.post("/api/v1/auth/redeem", json=redeem_body(invite["code"]))
    assert again.status_code == 410 and again.json()["code"] == "invite_invalid"


async def test_r1_3_member_cannot_invite(
    make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    assert (
        await client_for(family.users[1]).post(
            "/api/v1/invites", json={"role": "leader"}
        )
    ).status_code == 403


@pytest.mark.parametrize("invalid", ["unknown", "expired", "used"])
async def test_r1_3_invalid_invite_costs_no_hash(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    invalid: str,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    code = invite["code"]
    async with app.state.session_factory() as session:
        if invalid == "expired":
            await session.execute(
                update(InviteCode)
                .where(InviteCode.code == code)
                .values(expires_at=frozen_clock.now())
            )
        elif invalid == "used":
            await session.execute(
                update(InviteCode)
                .where(InviteCode.code == code)
                .values(used_at=frozen_clock.now(), used_by=family.users[1].id)
            )
        await session.commit()

    async def forbidden_hash(value: str) -> str:
        raise AssertionError("Invalid invites must not hash passwords")

    monkeypatch.setattr(service, "hash_password", forbidden_hash)
    response = await client.post(
        "/api/v1/auth/redeem",
        json=redeem_body("UNKNOWN000" if invalid == "unknown" else code),
    )
    assert response.status_code == 410 and response.json()["code"] == "invite_invalid"


async def test_r1_3_simultaneous_redeems_claim_before_hash_and_family_lock(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    code = invite["code"]
    # Hold the winning hash until both HTTP requests have reached the claim SQL.
    from sqlalchemy import event

    claims, both, hashes = 0, asyncio.Event(), 0

    def observe_claim(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        nonlocal claims
        if statement.startswith("UPDATE invite_code SET used_at="):
            claims += 1
            if claims == 2:
                both.set()

    from app.security.passwords import hash_password

    async def held_hash(value: str) -> str:
        nonlocal hashes
        hashes += 1
        await asyncio.wait_for(both.wait(), timeout=5)
        async with app.state.session_factory() as observer:
            await observer.execute(
                select(FamilyRevision)
                .where(FamilyRevision.family_id == family.id)
                .with_for_update(nowait=True)
            )
            # The invite claim already holds its row lock while hashing.
            with pytest.raises(DBAPIError) as caught:
                await observer.execute(
                    select(InviteCode)
                    .where(InviteCode.code == code)
                    .with_for_update(nowait=True)
                )
            assert getattr(caught.value.orig, "sqlstate", None) == "55P03"
            await observer.rollback()
        return await hash_password(value)

    event.listen(app.state.engine.sync_engine, "before_cursor_execute", observe_claim)
    monkeypatch.setattr(service, "hash_password", held_hash)
    bodies = [redeem_body(code), redeem_body(code)]
    try:
        responses = await asyncio.wait_for(
            asyncio.gather(
                *[client.post("/api/v1/auth/redeem", json=body) for body in bodies]
            ),
            timeout=15,
        )
    finally:
        event.remove(
            app.state.engine.sync_engine, "before_cursor_execute", observe_claim
        )
    assert claims == 2 and hashes == 1
    assert sorted(response.status_code for response in responses) == [200, 410]
    assert (
        next(response for response in responses if response.status_code == 410).json()[
            "code"
        ]
        == "invite_invalid"
    )
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppUser)
                .where(AppUser.email.in_([body["email"] for body in bodies]))
            )
            == 1
        )
        stored = await session.get(InviteCode, code)
        assert stored is not None
        assert (
            str(stored.used_by)
            == next(r for r in responses if r.status_code == 200).json()["user"]["id"]
        )


async def test_r1_3_email_taken_rolls_back_claim_and_invite_can_be_reused(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, client: AsyncClient
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    body = redeem_body(invite["code"])
    body["email"] = family.users[1].email.upper()
    failed = await client.post("/api/v1/auth/redeem", json=body)
    assert failed.status_code == 409 and failed.json()["code"] == "email_taken"
    async with app.state.session_factory() as session:
        stored = await session.get(InviteCode, invite["code"])
        assert stored is not None and stored.used_at is None and stored.used_by is None
    assert (
        await client.post("/api/v1/auth/redeem", json=redeem_body(invite["code"]))
    ).status_code == 200


@pytest.mark.parametrize(
    "field,value",
    [
        ("password", "short"),
        ("password", "x" * 129),
        ("display_name", ""),
        ("display_name", "x" * 41),
        ("unknown", "field"),
    ],
)
async def test_r1_3_redeem_validates_body(
    client: AsyncClient, field: str, value: str
) -> None:
    body = redeem_body("UNKNOWN000")
    body[field] = value
    assert (await client.post("/api/v1/auth/redeem", json=body)).status_code == 422


@pytest.mark.parametrize("length,expected", [(7, 422), (8, 200)])
async def test_r1_3_password_minimum_boundary(
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    length: int,
    expected: int,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    body = redeem_body(invite["code"])
    body["password"] = secrets.token_urlsafe(24)[:length]
    assert (await client.post("/api/v1/auth/redeem", json=body)).status_code == expected


async def test_r1_3_code_excludes_i_deterministically(
    make_family: MakeFamily,
    client_for: ClientFor,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()

    def choose(alphabet: str) -> str:
        return "I" if "I" in alphabet else alphabet[0]

    monkeypatch.setattr(service.secrets, "choice", choose)
    invite = await create_invite(client_for(family.users[0]))
    assert len(invite["code"]) == 10
    assert set(invite["code"]) <= set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")


async def test_r1_3_family_lock_is_held_before_identity_selection(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    invite = await create_invite(client_for(family.users[0]))
    original = service.lock_family
    checked = False

    async def check_lock(session: AsyncSession, family_id: UUID) -> None:
        nonlocal checked
        await original(session, family_id)
        async with app.state.session_factory() as observer:
            with pytest.raises(DBAPIError) as caught:
                await observer.execute(
                    select(FamilyRevision)
                    .where(FamilyRevision.family_id == family_id)
                    .with_for_update(nowait=True)
                )
            assert getattr(caught.value.orig, "sqlstate", None) == "55P03"
        checked = True

    monkeypatch.setattr(service, "lock_family", check_lock)
    response = await client.post(
        "/api/v1/auth/redeem", json=redeem_body(invite["code"])
    )
    assert response.status_code == 200 and checked


async def test_r1_3_two_invites_redeemed_together_get_different_keys(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    leader = client_for(family.users[0])
    invites = [await create_invite(leader), await create_invite(leader)]
    original = AsyncSession.scalars
    selections = 0

    async def checked_selection(
        session: AsyncSession,
        statement: Select[tuple[str]],
    ) -> ScalarResult[str]:
        nonlocal selections
        if str(statement).startswith("SELECT app_user.color"):
            # Observe the lock at selection itself, even when scheduling
            # happens to produce distinct keys without serialization.
            async with app.state.session_factory() as observer:
                with pytest.raises(DBAPIError) as caught:
                    await observer.execute(
                        select(FamilyRevision)
                        .where(FamilyRevision.family_id == family.id)
                        .with_for_update(nowait=True)
                    )
                assert getattr(caught.value.orig, "sqlstate", None) == "55P03"
            selections += 1
        return await original(session, statement)

    monkeypatch.setattr(AsyncSession, "scalars", checked_selection)
    responses = await asyncio.gather(
        *[
            client.post("/api/v1/auth/redeem", json=redeem_body(invite["code"]))
            for invite in invites
        ]
    )
    assert [response.status_code for response in responses] == [200, 200]
    assert len({response.json()["user"]["color"] for response in responses}) == 2
    assert selections == 2
