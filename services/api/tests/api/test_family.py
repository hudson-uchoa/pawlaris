import asyncio
import secrets
from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import idempotency
from app.clock import FrozenClock
from app.models import (
    AppUser,
    Family,
    FamilyRevision,
    PushDevice,
    RefreshToken,
    TaskCompletion,
    TaskTemplate,
)
from app.security.tokens import new_refresh_token
from tests.conftest import ClientFor
from tests.factories import MakeFamily

type Idem = Callable[[], dict[str, str]]


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
async def test_fm1_sole_leader_cannot_demote_or_remove_self(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    method: str,
) -> None:
    family = await make_family()
    leader = family.users[0]
    async with app.state.session_factory() as session:
        before = await session.scalar(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
        )
    response = await client_for(leader).request(
        method,
        f"/api/v1/family/members/{leader.id}",
        json={"role": "member"} if method == "PATCH" else None,
        headers=idem(),
    )
    assert response.status_code == 409
    assert response.json()["code"] == "last_leader"
    async with app.state.session_factory() as session:
        user = await session.get(AppUser, leader.id)
        assert user is not None and user.role == "leader" and user.disabled_at is None
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == before
        )


@pytest.mark.parametrize("targets", ["self", "other"])
async def test_fm1_two_leaders_race_and_keep_one_enabled_leader(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    monkeypatch: pytest.MonkeyPatch,
    targets: str,
) -> None:
    family = await make_family()
    async with app.state.session_factory() as session:
        await session.execute(
            update(AppUser)
            .where(AppUser.id == family.users[1].id)
            .values(role="leader")
        )
        await session.commit()
    original = idempotency.lock_family
    arrived, both = 0, asyncio.Event()

    async def rendezvous(session: AsyncSession, family_id: UUID) -> None:
        nonlocal arrived
        arrived += 1
        if arrived == 2:
            both.set()
        await asyncio.wait_for(both.wait(), timeout=5)
        await original(session, family_id)

    monkeypatch.setattr(idempotency, "lock_family", rendezvous)
    responses = await asyncio.wait_for(
        asyncio.gather(
            *[
                client_for(actor).patch(
                    "/api/v1/family/members/"
                    f"{family.users[i if targets == 'self' else 1 - i].id}",
                    json={"role": "member"},
                    headers=idem(),
                )
                for i, actor in enumerate(family.users)
            ]
        ),
        timeout=10,
    )
    assert arrived == 2
    assert sorted(r.status_code for r in responses) == (
        [200, 409] if targets == "self" else [200, 403]
    )
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppUser)
                .where(
                    AppUser.family_id == family.id,
                    AppUser.role == "leader",
                    AppUser.disabled_at.is_(None),
                )
            )
            == 1
        )


async def test_fm1_removal_is_atomic_and_preserves_history(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    leader, member = family.users
    tokens = [new_refresh_token() for _ in range(3)]
    async with app.state.session_factory() as session:
        rows = await family.make_rows(session)
        task = rows["task_template"]
        completion = rows["task_completion"]
        assert isinstance(task, TaskTemplate) and isinstance(completion, TaskCompletion)
        task.assigned_to = member.id
        completion.completed_by = member.id
        await session.execute(
            update(TaskTemplate)
            .where(TaskTemplate.family_id == family.id)
            .values(assigned_to=member.id)
        )
        session.add(PushDevice(token=secrets.token_urlsafe(24), user_id=member.id))
        session.add(PushDevice(token=secrets.token_urlsafe(24), user_id=leader.id))
        for i, (_, digest) in enumerate(tokens):
            session.add(
                RefreshToken(
                    id=uuid4(),
                    user_id=member.id if i < 2 else leader.id,
                    chain_id=uuid4(),
                    token_hash=digest,
                    expires_at=frozen_clock.now() + timedelta(days=30),
                )
            )
        await session.commit()
        old_completion = {
            column.name: getattr(completion, column.name)
            for column in TaskCompletion.__table__.columns
        }
        old_name, old_color = member.display_name, member.color
    removed_client = client_for(member)
    response = await client_for(leader).delete(
        f"/api/v1/family/members/{member.id}", headers=idem()
    )
    assert response.status_code == 200
    assert response.json()["disabled_at"] == frozen_clock.now().isoformat().replace(
        "+00:00", "Z"
    )
    assert response.json()["display_name"] == old_name
    async with app.state.session_factory() as session:
        disabled = await session.get(AppUser, member.id)
        assert disabled is not None
        assert disabled.disabled_at == frozen_clock.now()
        assert disabled.email == f"removed+{member.id}@pawlaris.invalid"
        assert (
            disabled.deleted_at is None
            and disabled.display_name == old_name
            and disabled.color == old_color
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(TaskTemplate)
                .where(
                    TaskTemplate.family_id == family.id,
                    TaskTemplate.assigned_to.is_not(None),
                )
            )
            == 0
        )
        for token in (
            await session.scalars(
                select(RefreshToken).where(
                    RefreshToken.user_id.in_([member.id, leader.id])
                )
            )
        ).all():
            assert token.revoked_at == (
                frozen_clock.now() if token.user_id == member.id else None
            )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(PushDevice)
                .where(PushDevice.user_id == member.id)
            )
            == 0
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(PushDevice)
                .where(PushDevice.user_id == leader.id)
            )
            == 1
        )
        saved = await session.get(TaskCompletion, completion.id)
        assert saved is not None
        assert {
            column.name: getattr(saved, column.name)
            for column in TaskCompletion.__table__.columns
        } == old_completion
    assert (await removed_client.get("/api/v1/me")).status_code == 401
    assert (
        await removed_client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens[0][0]}
        )
    ).status_code == 401
    second = await client_for(leader).delete(
        f"/api/v1/family/members/{member.id}", headers=idem()
    )
    assert second.status_code == 200 and second.json() == response.json()
    assert (
        await client_for(leader).patch(
            f"/api/v1/family/members/{member.id}",
            headers=idem(),
            json={"role": "leader"},
        )
    ).status_code == 404
    sync = (await client_for(leader).get("/api/v1/sync?since=0")).json()
    assert response.json() in sync["changes"]["members"]
    invite = await client_for(leader).post("/api/v1/invites", json={"role": "member"})
    joined = await client_for(leader).post(
        "/api/v1/auth/redeem",
        json={
            "code": invite.json()["code"],
            "email": member.email,
            "password": secrets.token_urlsafe(24),
            "display_name": "Returning member",
        },
    )
    assert joined.status_code == 200
    assert joined.json()["user"]["email"] == member.email
    assert joined.json()["user"]["id"] != str(member.id)


@pytest.mark.parametrize(
    "timezone,expected",
    [
        ("Europe/Lisbon", 200),
        ("America/Sao_Paulo", 200),
        ("Invalid/Zone", 422),
        ("", 422),
        ("/etc/localtime", 422),
    ],
)
async def test_fm1_family_timezone_validation(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    timezone: str,
    expected: int,
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).patch(
        "/api/v1/family",
        json={"timezone": timezone, "name": "Renamed family"},
        headers=idem(),
    )
    assert response.status_code == expected
    async with app.state.session_factory() as session:
        row = await session.get(Family, family.id)
        assert row is not None
        assert row.timezone == (timezone if expected == 200 else family.family.timezone)
        assert row.name == ("Renamed family" if expected == 200 else family.family.name)


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
@pytest.mark.parametrize("target", ["unknown", "other_family"])
async def test_fm1_member_target_must_belong_to_family(
    make_family: MakeFamily, client_for: ClientFor, idem: Idem, method: str, target: str
) -> None:
    family, other = await make_family(), await make_family()
    user_id = uuid4() if target == "unknown" else other.users[1].id
    response = await client_for(family.users[0]).request(
        method,
        f"/api/v1/family/members/{user_id}",
        headers=idem(),
        json={"role": "leader"} if method == "PATCH" else None,
    )
    assert response.status_code == 404


async def test_fm1_leader_can_promote_and_remove_self_when_another_leads(
    make_family: MakeFamily, client_for: ClientFor, idem: Idem
) -> None:
    family = await make_family()
    leader = client_for(family.users[0])
    promoted = await leader.patch(
        f"/api/v1/family/members/{family.users[1].id}",
        json={"role": "leader"},
        headers=idem(),
    )
    assert promoted.status_code == 200 and promoted.json()["role"] == "leader"
    removed = await leader.delete(
        f"/api/v1/family/members/{family.users[0].id}", headers=idem()
    )
    assert removed.status_code == 200 and removed.json()["disabled_at"] is not None
