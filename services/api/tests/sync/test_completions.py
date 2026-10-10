import asyncio
from collections import Counter
from collections.abc import Callable
from datetime import date, timedelta
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from httpx import Response
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import idempotency
from app.clock import Clock, FrozenClock
from app.locks import lock_family
from app.models import (
    AppliedMutation,
    AppUser,
    FamilyRevision,
    TaskCompletion,
    TaskTemplate,
)
from app.schemas.completions import CompletionCreate
from app.schemas.rows import Completion
from app.services import completions
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily

type Idem = Callable[[], dict[str, str]]


async def make_task(
    app: FastAPI, family: TestFamily, mode: str = "together"
) -> TaskTemplate:
    async with app.state.session_factory() as session:
        values = await family.row_values(session, "task_template")
        values.update(
            completion_mode=mode,
            assigned_to=family.users[0].id,
            pet_ids=[family.pets[0].id],
        )
        task = TaskTemplate(**values)
        session.add(task)
        await session.commit()
        return task


def body_for(
    task: TaskTemplate, clock: Clock, **overrides: object
) -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "task_id": str(task.id),
        "occurrence_key": "2026-09-14T08:00",
        "pet_id": str(task.pet_ids[0]) if task.completion_mode == "per_pet" else None,
        "completed_at": clock.now().isoformat(),
        **overrides,
    }


async def task_rows(app: FastAPI, task: TaskTemplate) -> list[TaskCompletion]:
    async with app.state.session_factory() as session:
        return list(
            await session.scalars(
                select(TaskCompletion).where(TaskCompletion.task_id == task.id)
            )
        )


@pytest.mark.parametrize("mode", ["together", "per_pet"])
async def test_cp1_ten_overlapping_requests_return_one_winner_and_lost_outcomes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    bodies = [body_for(task, frozen_clock) for _ in range(10)]
    two_arrived = asyncio.Event()
    waiter_pids: list[int] = []
    outcomes: dict[UUID, completions.CompletionOutcome] = {}
    original_create = completions.create_completion

    async def observed_create(
        session: AsyncSession, user: AppUser, body: CompletionCreate, clock: Clock
    ) -> tuple[TaskCompletion, completions.CompletionOutcome]:
        row, outcome = await original_create(session, user, body, clock)
        outcomes[body.id] = outcome
        return row, outcome

    async def observed_lock(session: AsyncSession, family_id: UUID) -> None:
        pid = await session.scalar(text("SELECT pg_backend_pid()"))
        assert pid is not None
        waiter_pids.append(pid)
        if len(waiter_pids) >= 2:
            two_arrived.set()
        await lock_family(session, family_id)

    monkeypatch.setattr(completions, "create_completion", observed_create)
    monkeypatch.setattr(idempotency, "lock_family", observed_lock)

    async def send_all() -> list[Response]:
        return await asyncio.gather(
            *[
                client_for(family.users[i % 2]).post(
                    "/api/v1/completions", json=body, headers=idem()
                )
                for i, body in enumerate(bodies)
            ]
        )

    async with app.state.session_factory() as blocker:
        await lock_family(blocker, family.id)
        pending = asyncio.create_task(send_all())
        waiting = asyncio.create_task(two_arrived.wait())
        try:
            await asyncio.wait(
                {pending, waiting}, timeout=10, return_when=asyncio.FIRST_COMPLETED
            )
            if pending.done():
                assert [r.status_code for r in pending.result()] == [200] * 10
            assert two_arrived.is_set(), "CP-1 requires overlapping lock contenders"

            async def wait_for_two_database_waiters() -> None:
                # PostgreSQL lock waits have no asyncio event to subscribe to.
                while True:  # noqa: ASYNC110
                    blocked = [
                        await blocker.scalar(
                            text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"),
                            {"pid": pid},
                        )
                        for pid in waiter_pids[:2]
                    ]
                    if all(blocked):
                        return
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(wait_for_two_database_waiters(), timeout=5)
            assert not pending.done()
            await blocker.commit()
            responses = await asyncio.wait_for(pending, timeout=15)
        finally:
            await blocker.rollback()
            for running in (pending, waiting):
                if not running.done():
                    running.cancel()
            await asyncio.gather(pending, waiting, return_exceptions=True)

    assert [response.status_code for response in responses] == [200] * 10
    assert len({response.content for response in responses}) == 1
    winner = responses[0].json()
    assert set(winner) == set(Completion.model_fields)
    assert Counter(outcomes.values()) == {"created": 1, "lost": 9}
    winner_index = next(
        i for i, body in enumerate(bodies) if body["id"] == winner["id"]
    )
    assert outcomes[UUID(winner["id"])] == "created"
    assert winner["completed_by"] == str(family.users[winner_index % 2].id)
    rows = await task_rows(app, task)
    assert len(rows) == 1 and rows[0].undone_at is None
    async with app.state.session_factory() as session:
        mutations = list(
            await session.scalars(
                select(AppliedMutation).where(AppliedMutation.family_id == family.id)
            )
        )
        assert len(mutations) == 10
        assert {row.entity_id for row in mutations} == {UUID(winner["id"])}


@pytest.mark.parametrize("mode", ["together", "per_pet"])
async def test_cp2_five_replays_write_one_row_and_no_new_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    body, headers = body_for(task, frozen_clock), idem()
    http = client_for(family.users[1])
    first = await http.post("/api/v1/completions", json=body, headers=headers)
    assert first.status_code == 200
    async with app.state.session_factory() as session:
        before = await session.get(FamilyRevision, family.id)
        assert before is not None
        revision = before.value
    frozen_clock.advance(timedelta(hours=1))
    responses = [first] + [
        await client_for(family.users[1]).post(
            "/api/v1/completions", json=body, headers=headers
        )
        for _ in range(4)
    ]
    assert [r.status_code for r in responses] == [200] * 5
    assert len({r.content for r in responses}) == 1
    assert len(await task_rows(app, task)) == 1
    async with app.state.session_factory() as session:
        after = await session.get(FamilyRevision, family.id)
        assert after is not None and after.value == revision
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppliedMutation)
                .where(AppliedMutation.family_id == family.id)
            )
            == 1
        )


@pytest.mark.parametrize("mode", ["together", "per_pet"])
async def test_cp2_same_id_with_new_key_returns_existing_internal_outcome(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    body = body_for(task, frozen_clock, note="Original note")
    first = await client_for(family.users[0]).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert first.status_code == 200
    async with app.state.session_factory() as session:

        async def write() -> TaskCompletion:
            row, outcome = await completions.create_completion(
                session,
                family.users[1],
                CompletionCreate.model_validate({**body, "note": "Changed note"}),
                frozen_clock,
            )
            assert outcome == "existing"
            return row

        row = await idempotency.IdempotentMutation(
            session, family.users[1], str(uuid4()), "task_completions"
        )(write)
    assert row.model_dump(mode="json") == first.json()
    assert len(await task_rows(app, task)) == 1


@pytest.mark.parametrize("mode", ["together", "per_pet"])
@pytest.mark.parametrize("creator_index", [0, 1])
async def test_cp3_cp4_any_member_undoes_tombstone_twice_and_recompletes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
    creator_index: int,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    creator, undoer = family.users[creator_index], family.users[1 - creator_index]
    body = body_for(task, frozen_clock)
    made = await client_for(creator).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert made.status_code == 200
    path = f"/api/v1/completions/{made.json()['id']}/undo"
    frozen_clock.advance(timedelta(minutes=1))
    undone = await client_for(undoer).post(path, headers=idem())
    assert undone.status_code == 200
    tombstone = undone.json()
    assert tombstone["undone_at"] == frozen_clock.now().isoformat().replace(
        "+00:00", "Z"
    )
    assert tombstone["undone_by"] == str(undoer.id)
    assert tombstone["completed_by"] == str(creator.id)
    for field in set(Completion.model_fields) - {
        "undone_at",
        "undone_by",
        "revision",
        "updated_at",
    }:
        assert tombstone[field] == made.json()[field]
    rows = await task_rows(app, task)
    assert len(rows) == 1 and rows[0].undone_at is not None
    async with app.state.session_factory() as session:
        before_repeat = await session.scalar(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
        )
    frozen_clock.advance(timedelta(minutes=1))
    repeated = await client_for(creator).post(path, headers=idem())
    assert repeated.status_code == 200 and repeated.content == undone.content
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
            == before_repeat
        )
    again = await client_for(undoer).post(
        "/api/v1/completions", json=body_for(task, frozen_clock), headers=idem()
    )
    assert again.status_code == 200 and again.json()["id"] != made.json()["id"]
    assert again.json()["undone_at"] is None and again.json()["undone_by"] is None
    assert again.json()["completed_by"] == str(undoer.id)
    rows = await task_rows(app, task)
    assert len(rows) == 2 and sum(row.undone_at is None for row in rows) == 1
    # The original id stays a tombstone even under a new idempotency key.
    old = await client_for(creator).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert old.status_code == 200 and old.json() == tombstone
    sync = await client_for(creator).get("/api/v1/sync?since=0")
    assert {"entity": "task_completions", "row": tombstone} in sync.json()["changes"]
    assert {"entity": "task_completions", "row": again.json()} in sync.json()["changes"]


@pytest.mark.parametrize(
    "mode,pet",
    [
        ("per_pet", "missing"),
        ("per_pet", "unlinked"),
        ("per_pet", "unknown"),
        ("per_pet", "foreign"),
        ("together", "linked"),
    ],
)
async def test_cp5_completion_pet_matches_template_mode(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
    pet: str,
) -> None:
    family = await make_family(pets=2)
    other = await make_family()
    task = await make_task(app, family, mode)
    pet_id = {
        "missing": None,
        "unlinked": str(family.pets[1].id),
        "unknown": str(uuid4()),
        "foreign": str(other.pets[0].id),
        "linked": str(family.pets[0].id),
    }[pet]
    response = await client_for(family.users[1]).post(
        "/api/v1/completions",
        json=body_for(task, frozen_clock, pet_id=pet_id),
        headers=idem(),
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await task_rows(app, task) == []
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppliedMutation)
                .where(AppliedMutation.family_id == family.id)
            )
            == 0
        )


@pytest.mark.parametrize(
    "offset",
    [
        timedelta(days=-90),
        timedelta(minutes=4, seconds=59, microseconds=999999),
        timedelta(minutes=5),
        timedelta(minutes=5, microseconds=1),
        timedelta(minutes=6),
    ],
)
async def test_cp2_completed_at_is_clamped_at_exact_injected_five_minute_limit(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    offset: timedelta,
) -> None:
    family = await make_family()
    task = await make_task(app, family)
    frozen_clock.advance(timedelta(days=7, hours=2))
    tapped_at = frozen_clock.now() + offset
    expected = min(tapped_at, frozen_clock.now() + timedelta(minutes=5))
    response = await client_for(family.users[1]).post(
        "/api/v1/completions",
        json=body_for(task, frozen_clock, completed_at=tapped_at.isoformat()),
        headers=idem(),
    )
    assert response.status_code == 200
    assert response.json()["completed_at"] == expected.isoformat().replace(
        "+00:00", "Z"
    )
    rows = await task_rows(app, task)
    assert rows[0].completed_at == expected


@pytest.mark.parametrize("lifecycle", ["ended", "deleted"])
async def test_cp3_history_accepts_ended_and_deleted_templates(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    lifecycle: str,
) -> None:
    family = await make_family()
    task = await make_task(app, family)
    async with app.state.session_factory() as session:
        await session.execute(
            update(TaskTemplate)
            .where(TaskTemplate.id == task.id)
            .values(
                **(
                    {"ends_on": date(2026, 9, 1)}
                    if lifecycle == "ended"
                    else {"deleted_at": frozen_clock.now()}
                )
            )
        )
        await session.commit()
    response = await client_for(family.users[1]).post(
        "/api/v1/completions", json=body_for(task, frozen_clock), headers=idem()
    )
    assert response.status_code == 200
    assert response.json()["title_snapshot"] == task.title


@pytest.mark.parametrize("target", ["unknown", "foreign"])
async def test_cp5_task_must_exist_in_callers_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    task = await make_task(app, other)
    response = await client_for(family.users[0]).post(
        "/api/v1/completions",
        json=body_for(
            task,
            frozen_clock,
            task_id=str(uuid4()) if target == "unknown" else str(task.id),
        ),
        headers=idem(),
    )
    assert response.status_code == 404
    assert await task_rows(app, task) == []


@pytest.mark.parametrize("target", ["unknown", "foreign"])
async def test_cp3_undo_must_target_a_completion_in_callers_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    task = await make_task(app, other)
    made = await client_for(other.users[0]).post(
        "/api/v1/completions", json=body_for(task, frozen_clock), headers=idem()
    )
    assert made.status_code == 200
    target_id = str(uuid4()) if target == "unknown" else made.json()["id"]
    response = await client_for(family.users[0]).post(
        f"/api/v1/completions/{target_id}/undo", headers=idem()
    )
    assert response.status_code == 404
    rows = await task_rows(app, task)
    assert len(rows) == 1 and rows[0].undone_at is None


async def test_cp2_server_snapshots_title_and_preserves_pending_photo_and_note(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    task = await make_task(app, family)
    photo_id = str(uuid4())
    http = client_for(family.users[1])
    async with app.state.session_factory() as session:
        await session.execute(
            update(TaskTemplate)
            .where(TaskTemplate.id == task.id)
            .values(title="Current title", requires_photo=True)
        )
        await session.commit()
    first = await http.post(
        "/api/v1/completions",
        headers=idem(),
        json=body_for(
            task, frozen_clock, photo_asset_id=photo_id, note="Photo pending"
        ),
    )
    assert first.status_code == 200
    assert first.json()["title_snapshot"] == "Current title"
    assert first.json()["photo_asset_id"] == photo_id
    assert first.json()["note"] == "Photo pending"
    assert first.json()["completed_by"] == str(family.users[1].id)
    assert set(first.json()) == set(Completion.model_fields)
    async with app.state.session_factory() as session:
        await session.execute(
            update(TaskTemplate)
            .where(TaskTemplate.id == task.id)
            .values(title="Later title")
        )
        await session.commit()
    second = await http.post(
        "/api/v1/completions",
        headers=idem(),
        json=body_for(task, frozen_clock, occurrence_key="2026-09-13"),
    )
    assert (
        second.status_code == 200 and second.json()["title_snapshot"] == "Later title"
    )
    rows = await task_rows(app, task)
    assert (
        next(row for row in rows if str(row.id) == first.json()["id"]).title_snapshot
        == "Current title"
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"id": str(uuid1())},
        {"occurrence_key": "not-an-occurrence"},
        {"occurrence_key": "2026-09-14T8:00"},
        {"occurrence_key": "2026-09-14\n"},
        {"completed_at": "2026-09-14T10:30:00"},
        {"completed_by": str(uuid4())},
        {"title_snapshot": "Forged title"},
        {"note": "Invalid\x00note"},
        {"undone_at": "2026-09-14T10:30:00Z"},
    ],
)
async def test_cp5_invalid_completion_body_is_422(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    changes: dict[str, object],
) -> None:
    family = await make_family()
    task = await make_task(app, family)
    response = await client_for(family.users[0]).post(
        "/api/v1/completions",
        headers=idem(),
        json=body_for(task, frozen_clock, **changes),
    )
    assert response.status_code == 422
    assert await task_rows(app, task) == []
