import asyncio
import hashlib
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import idempotency
from app.clock import FrozenClock
from app.locks import lock_family
from app.models import AppUser, Base
from app.services import auth
from app.services import family as family_service
from tests.conftest import ClientFor
from tests.factories import MakeFamily
from tests.security.matrix import PERMISSION_MATRIX, PermissionCase


async def _database_digest(session: AsyncSession) -> str:
    digest = hashlib.sha256()
    for table in Base.metadata.sorted_tables:
        rows = (await session.execute(select(table))).all()
        digest.update(repr(sorted(repr(tuple(row)) for row in rows)).encode())
    return digest.hexdigest()


@pytest.mark.parametrize(
    "case,change",
    [
        (case, change)
        for case in PERMISSION_MATRIX
        if case.method != "GET"
        for change in ("removed", "demoted")
        if change == "removed" or case.expected["member"] == 403
    ],
)
async def test_rb3_waiting_mutation_uses_locked_actor_and_writes_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    case: PermissionCase,
    change: str,
) -> None:
    family = await make_family()
    actor = family.users[0]
    request = await case.request(family, actor)
    arrived = asyncio.Event()
    waiter_pid: int | None = None

    async def observed_lock(session: AsyncSession, family_id: UUID) -> None:
        nonlocal waiter_pid
        waiter_pid = await session.scalar(text("SELECT pg_backend_pid()"))
        arrived.set()
        await lock_family(session, family_id)

    monkeypatch.setattr(idempotency, "lock_family", observed_lock)
    monkeypatch.setattr(family_service, "lock_family", observed_lock)
    monkeypatch.setattr(auth, "lock_family", observed_lock)
    async with app.state.session_factory() as blocker:
        await lock_family(blocker, family.id)
        pending = asyncio.create_task(
            client_for(actor).request(
                case.method,
                request.url,
                json=request.json,
                content=request.content,
                headers=request.headers,
            )
        )
        try:
            await asyncio.wait_for(arrived.wait(), timeout=5)

            async def wait_until_blocked() -> None:
                # PostgreSQL lock waits have no asyncio event to subscribe to.
                while not await blocker.scalar(  # noqa: ASYNC110
                    text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"),
                    {"pid": waiter_pid},
                ):
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(wait_until_blocked(), timeout=5)
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
            before = await _database_digest(blocker)
            await blocker.commit()
            response = await asyncio.wait_for(pending, timeout=10)
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    assert response.status_code == (403 if change == "demoted" else 401), (
        case.row,
        case.template,
        change,
        response.status_code,
    )
    async with app.state.session_factory() as session:
        assert await _database_digest(session) == before


async def test_rb1_runs_two_cases_for_one_parameterized_route(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
) -> None:
    from app.models import AppUser
    from tests.factories import TestFamily
    from tests.security.matrix import MatrixRequest, PermissionCase

    assert isinstance(PERMISSION_MATRIX, list), "RB-1 requires a list of cases"
    seen: list[tuple[str, str]] = []

    async def probe(item_id: str, body: dict[str, str]) -> dict[str, str]:
        seen.append((item_id, body["case"]))
        return body

    app.add_api_route("/matrix/probe/{item_id}", probe, methods=["POST"])

    async def first(fam: TestFamily, actor: AppUser) -> MatrixRequest:
        return MatrixRequest(url=f"/matrix/probe/{actor.id}", json={"case": "first"})

    async def second(fam: TestFamily, actor: AppUser) -> MatrixRequest:
        return MatrixRequest(url=f"/matrix/probe/{fam.id}", json={"case": "second"})

    cases = [
        PermissionCase(
            11, "POST", "/matrix/probe/{item_id}", first, {"member": 200, "leader": 200}
        ),
        PermissionCase(
            12,
            "POST",
            "/matrix/probe/{item_id}",
            second,
            {"member": 200, "leader": 200},
        ),
    ]
    for role in ("member", "leader"):
        for case in cases:
            await test_rb1_permission_row_returns_expected_status(
                make_family, client_for, role, case
            )
    assert len(seen) == 4
    assert [label for _, label in seen] == ["first", "second", "first", "second"]
    assert all("{" not in item_id for item_id, _ in seen)


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize("case", PERMISSION_MATRIX)
async def test_rb1_permission_row_returns_expected_status(
    make_family: MakeFamily,
    client_for: ClientFor,
    role: str,
    case: PermissionCase,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    request = await case.request(family, actor)
    response = await client_for(actor).request(
        case.method,
        request.url,
        json=request.json,
        content=request.content,
        headers=request.headers,
    )
    assert response.status_code == case.expected[role], (
        case.row,
        case.template,
        role,
        response.status_code,
    )


async def test_rb2_member_is_forbidden_on_every_implemented_leader_only_case(
    make_family: MakeFamily,
    client_for: ClientFor,
) -> None:
    for case in PERMISSION_MATRIX:
        assert set(case.expected) == {"member", "leader"}
        if case.expected["member"] != 403:
            continue
        family = await make_family()
        actor = next(user for user in family.users if user.role == "member")
        request = await case.request(family, actor)
        client: AsyncClient = client_for(actor)
        response = await client.request(
            case.method,
            request.url,
            json=request.json,
            content=request.content,
            headers=request.headers,
        )
        assert response.status_code == 403, (
            case.row,
            case.template,
            response.status_code,
        )
