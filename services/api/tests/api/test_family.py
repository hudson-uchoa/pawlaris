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
from app.errors import ApiError
from app.idempotency import IdempotentMutation, SyncModel
from app.locks import lock_family
from app.models import (
    AppUser,
    Family,
    FamilyRevision,
    InviteCode,
    PushDevice,
    RefreshToken,
    TaskCompletion,
    TaskTemplate,
)
from app.schemas.rows import Row
from app.security.tokens import new_refresh_token
from app.services import family as service
from tests.conftest import ClientFor
from tests.factories import MakeFamily

type Idem = Callable[[], dict[str, str]]


@pytest.mark.parametrize("route", ["family", "role", "remove", "invite"])
@pytest.mark.parametrize("change", ["demoted", "removed"])
async def test_fm1_each_leader_write_rechecks_actor_after_waiting_for_lock(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    route: str,
    change: str,
) -> None:
    family = await make_family(members=3)
    actor, target = family.users[:2]
    arrived = asyncio.Event()

    async def observed_lock(session: AsyncSession, family_id: UUID) -> None:
        arrived.set()
        await lock_family(session, family_id)

    monkeypatch.setattr(idempotency, "lock_family", observed_lock)
    monkeypatch.setattr(service, "lock_family", observed_lock)
    method, path, body = {
        "family": ("PATCH", "/family", {"name": "Forbidden rename"}),
        "role": ("PATCH", f"/family/members/{target.id}", {"role": "leader"}),
        "remove": ("DELETE", f"/family/members/{target.id}", None),
        "invite": ("POST", "/invites", {"role": "leader"}),
    }[route]
    http = client_for(actor)
    async with app.state.session_factory() as blocker:
        await lock_family(blocker, family.id)
        pending = asyncio.create_task(
            http.request(
                method,
                f"/api/v1{path}",
                json=body,
                headers=idem(),
            )
        )
        try:
            await asyncio.wait_for(arrived.wait(), timeout=5)
            await blocker.execute(
                update(AppUser)
                .where(AppUser.id == actor.id)
                .values(
                    **(
                        {"role": "member"}
                        if change == "demoted"
                        else {"disabled_at": frozen_clock.now()}
                    )
                )
            )
            await blocker.commit()
            before = await blocker.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            response = await asyncio.wait_for(pending, timeout=5)
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    assert response.status_code == (403 if change == "demoted" else 401)
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == before
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(InviteCode)
                .where(InviteCode.family_id == family.id)
            )
            == 0
        )
        saved = await session.get(AppUser, target.id)
        assert (
            saved is not None and saved.role == "member" and saved.disabled_at is None
        )


@pytest.mark.parametrize("fault", ["after_write", "commit"])
async def test_fm1_failed_removal_rolls_back_every_effect(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    fault: str,
) -> None:
    from collections.abc import Awaitable

    family = await make_family()
    leader, member = family.users
    async with app.state.session_factory() as session:
        task = TaskTemplate(**await family.row_values(session, "task_template"))
        task.assigned_to = member.id
        session.add(task)
        session.add(PushDevice(token=secrets.token_urlsafe(24), user_id=member.id))
        _, digest = new_refresh_token()
        session.add(
            RefreshToken(
                id=uuid4(),
                user_id=member.id,
                chain_id=uuid4(),
                token_hash=digest,
                expires_at=frozen_clock.now() + timedelta(days=30),
            )
        )
        await session.commit()
        task_revision = task.revision
        revision = await session.scalar(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
        )
    original_call, original_commit = IdempotentMutation.__call__, AsyncSession.commit

    async def fail_after_write(
        mutation: IdempotentMutation, handler: Callable[[], Awaitable[SyncModel]]
    ) -> Row:
        async def failed() -> SyncModel:
            await handler()
            raise ApiError(409, "last_leader", "Injected failure after removal writes.")

        return await original_call(mutation, failed)

    async def fail_commit(session: AsyncSession) -> None:
        raise RuntimeError("Injected removal commit failure")

    if fault == "after_write":
        monkeypatch.setattr(IdempotentMutation, "__call__", fail_after_write)
    else:
        monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    headers = idem()
    response = await client_for(leader).delete(
        f"/api/v1/family/members/{member.id}", headers=headers
    )
    assert response.status_code == (409 if fault == "after_write" else 500)
    async with app.state.session_factory() as session:
        saved = await session.get(AppUser, member.id)
        assert saved is not None
        assert saved.disabled_at is None and saved.email == member.email
        assert saved.revision == member.revision
        saved_task = await session.get(TaskTemplate, task.id)
        assert (
            saved_task is not None
            and saved_task.assigned_to == member.id
            and saved_task.revision == task_revision
        )
        assert (
            await session.scalar(
                select(RefreshToken.revoked_at).where(RefreshToken.user_id == member.id)
            )
            is None
        )
        assert (
            await session.scalar(
                select(func.count())
                .select_from(PushDevice)
                .where(PushDevice.user_id == member.id)
            )
            == 1
        )
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == revision
        )
    monkeypatch.setattr(IdempotentMutation, "__call__", original_call)
    monkeypatch.setattr(AsyncSession, "commit", original_commit)
    assert (
        await client_for(leader).delete(
            f"/api/v1/family/members/{member.id}", headers=headers
        )
    ).status_code == 200


@pytest.mark.parametrize("disabled_leader", [False, True])
@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
async def test_fm1_sole_leader_cannot_demote_or_remove_self(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    method: str,
    disabled_leader: bool,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    leader = family.users[0]
    async with app.state.session_factory() as session:
        if disabled_leader:
            await session.execute(
                update(AppUser)
                .where(AppUser.id == family.users[1].id)
                .values(role="leader", disabled_at=frozen_clock.now())
            )
            await session.commit()
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
        other_task = TaskTemplate(**await family.row_values(session, "task_template"))
        other_task.assigned_to = leader.id
        session.add(other_task)
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
                    TaskTemplate.assigned_to == member.id,
                )
            )
            == 0
        )
        preserved = await session.get(TaskTemplate, other_task.id)
        assert preserved is not None and preserved.assigned_to == leader.id
        before_repeat = await session.scalar(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
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
    frozen_clock.advance(timedelta(minutes=1))
    second = await client_for(leader).delete(
        f"/api/v1/family/members/{member.id}", headers=idem()
    )
    assert second.status_code == 200 and second.json() == response.json()
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == before_repeat
        )
    assert (
        await client_for(leader).patch(
            f"/api/v1/family/members/{member.id}",
            headers=idem(),
            json={"role": "leader"},
        )
    ).status_code == 404
    sync = (await client_for(leader).get("/api/v1/sync?since=0")).json()
    assert {"entity": "members", "row": response.json()} in sync["changes"]
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


@pytest.mark.parametrize("length,expected", [(0, 422), (1, 200), (60, 200), (61, 422)])
async def test_fm1_family_name_boundaries(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    length: int,
    expected: int,
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).patch(
        "/api/v1/family",
        json={"name": "x" * length},
        headers=idem(),
    )
    assert response.status_code == expected
