from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from app.clock import FrozenClock
from app.models import AppliedMutation, FamilyRevision, TaskTemplate, TaskTimer
from app.schemas.rows import Timer
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily

type Idem = Callable[[], dict[str, str]]


async def stored_task(app: FastAPI, family: TestFamily) -> TaskTemplate:
    async with app.state.session_factory() as session:
        row = TaskTemplate(**await family.row_values(session, "task_template"))
        session.add(row)
        await session.commit()
        return row


async def stored_timer(
    app: FastAPI, family: TestFamily, clock: FrozenClock
) -> TaskTimer:
    async with app.state.session_factory() as session:
        values = await family.row_values(session, "task_timer")
        values.update(
            pet_id=family.pets[0].id,
            started_at=clock.now(),
            ends_at=clock.now() + timedelta(minutes=5),
        )
        row = TaskTimer(**values)
        session.add(row)
        await session.commit()
        return row


def body_for(
    task: TaskTemplate, clock: FrozenClock, **overrides: object
) -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "task_id": str(task.id),
        "occurrence_key": "2026-09-14T08:00",
        "started_at": clock.now().isoformat(),
        "ends_at": (clock.now() + timedelta(minutes=5)).isoformat(),
        **overrides,
    }


async def revision(app: FastAPI, family: TestFamily) -> int:
    async with app.state.session_factory() as session:
        return (
            await session.execute(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
        ).scalar_one()


async def timer_rows(app: FastAPI, family: TestFamily) -> list[TaskTimer]:
    async with app.state.session_factory() as session:
        return list(
            await session.scalars(
                select(TaskTimer).where(TaskTimer.family_id == family.id)
            )
        )


async def assert_rejected_write_is_unchanged(
    app: FastAPI, family: TestFamily, before: int
) -> None:
    assert await timer_rows(app, family) == []
    assert await revision(app, family) == before
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppliedMutation)
                .where(AppliedMutation.family_id == family.id)
            )
            == 0
        )


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize("pet", ["omitted", "null", "linked"])
async def test_tm1_rb1_create_persists_client_times_and_actual_starter(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    role: str,
    pet: str,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    actor = next(user for user in family.users if user.role == role)
    started_at = frozen_clock.now() - timedelta(days=3)
    ends_at = started_at + timedelta(seconds=1)
    body = body_for(
        task,
        frozen_clock,
        started_at=started_at.isoformat(),
        ends_at=ends_at.isoformat(),
    )
    if pet != "omitted":
        body["pet_id"] = str(family.pets[0].id) if pet == "linked" else None
    response = await client_for(actor).post("/api/v1/timers", json=body, headers=idem())
    assert response.status_code == 200
    row = response.json()
    assert set(row) == set(Timer.model_fields)
    assert row["id"] == body["id"] and row["task_id"] == str(task.id)
    assert row["occurrence_key"] == body["occurrence_key"]
    assert row["pet_id"] == body.get("pet_id")
    assert row["started_by"] == str(actor.id) and row["cancelled_at"] is None
    assert row["started_at"] == started_at.isoformat().replace("+00:00", "Z")
    assert row["ends_at"] == ends_at.isoformat().replace("+00:00", "Z")
    stored = await timer_rows(app, family)
    assert len(stored) == 1
    assert Timer.model_validate(stored[0]).model_dump(mode="json") == row
    assert stored[0].family_id == family.id
    before = await revision(app, family)
    frozen_clock.advance(timedelta(days=3))
    sync = await client_for(family.users[1]).get("/api/v1/sync?since=0")
    assert sync.status_code == 200
    assert {"entity": "task_timers", "row": row} in sync.json()["changes"]
    assert await revision(app, family) == before


@pytest.mark.parametrize(
    "seconds,expected",
    [(-1, 422), (0, 422), (1, 200), (86400, 200), (86401, 422)],
)
async def test_tm1_duration_bounds_on_both_sides(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    seconds: int,
    expected: int,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers",
        json=body_for(
            task,
            frozen_clock,
            ends_at=(frozen_clock.now() + timedelta(seconds=seconds)).isoformat(),
        ),
        headers=idem(),
    )
    assert response.status_code == expected
    if expected == 422:
        assert response.json()["code"] == "validation_error"
        await assert_rejected_write_is_unchanged(app, family, before)
    else:
        rows = await timer_rows(app, family)
        assert len(rows) == 1
        assert rows[0].ends_at - rows[0].started_at == timedelta(seconds=seconds)


@pytest.mark.parametrize(
    "key",
    [
        "",
        "not-an-occurrence",
        "2026-09-14T8:00",
        "2026-09-14T08:00:00",
        "2026-09-14 08:00",
        "2026-09-14\n",
        "2026-09-14T08:00\n",
    ],
)
async def test_tm1_malformed_occurrence_key_is_422_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    key: str,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers",
        json=body_for(task, frozen_clock, occurrence_key=key),
        headers=idem(),
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    await assert_rejected_write_is_unchanged(app, family, before)


@pytest.mark.parametrize(
    "key", ["2026-09-14", "2026-09-14T00:00", "2026-09-14T23:59", "2026-13-45T99:99"]
)
async def test_tm1_occurrence_key_shape_is_accepted_without_schedule_evaluation(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    key: str,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers",
        json=body_for(task, frozen_clock, occurrence_key=key),
        headers=idem(),
    )
    assert response.status_code == 200 and response.json()["occurrence_key"] == key


@pytest.mark.parametrize(
    "changes",
    [
        {"id": str(uuid1())},
        {"started_at": "2026-09-14T10:30:00"},
        {"ends_at": "2026-09-14T10:35:00"},
        {"started_by": str(uuid4())},
        {"cancelled_at": "2026-09-14T10:30:00Z"},
        {"revision": 1},
        {"family_id": str(uuid4())},
    ],
)
async def test_tm1_invalid_timer_body_is_422_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    changes: dict[str, object],
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers", json=body_for(task, frozen_clock, **changes), headers=idem()
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    await assert_rejected_write_is_unchanged(app, family, before)


@pytest.mark.parametrize("field", ["task_id", "pet_id"])
@pytest.mark.parametrize("target", ["unknown", "foreign"])
async def test_rb1_timer_scalar_references_must_belong_to_callers_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    field: str,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    task, foreign_task = await stored_task(app, family), await stored_task(app, other)
    reference = foreign_task.id if field == "task_id" else other.pets[0].id
    before, foreign_before = await revision(app, family), await revision(app, other)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers",
        json=body_for(
            task,
            frozen_clock,
            **{field: str(uuid4()) if target == "unknown" else str(reference)},
        ),
        headers=idem(),
    )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    await assert_rejected_write_is_unchanged(app, family, before)
    await assert_rejected_write_is_unchanged(app, other, foreign_before)


async def test_rb1_create_with_foreign_timer_id_reveals_nothing_and_writes_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family, other = await make_family(), await make_family()
    foreign = await stored_timer(app, other, frozen_clock)
    foreign_row = Timer.model_validate(foreign).model_dump(mode="json")
    task = await stored_task(app, family)
    before, foreign_before = await revision(app, family), await revision(app, other)
    response = await client_for(family.users[1]).post(
        "/api/v1/timers",
        json=body_for(task, frozen_clock, id=str(foreign.id)),
        headers=idem(),
    )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert (
        str(foreign.id) not in response.text
        and str(foreign.task_id) not in response.text
    )
    await assert_rejected_write_is_unchanged(app, family, before)
    assert await revision(app, other) == foreign_before
    assert (
        Timer.model_validate((await timer_rows(app, other))[0]).model_dump(mode="json")
        == foreign_row
    )


@pytest.mark.parametrize("target", ["unknown", "foreign"])
async def test_rb1_cancel_requires_timer_in_callers_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    foreign = await stored_timer(app, other, frozen_clock)
    foreign_row = Timer.model_validate(foreign).model_dump(mode="json")
    before, foreign_before = await revision(app, family), await revision(app, other)
    target_id = uuid4() if target == "unknown" else foreign.id
    response = await client_for(family.users[1]).post(
        f"/api/v1/timers/{target_id}/cancel", headers=idem()
    )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert (
        str(foreign.id) not in response.text
        and str(foreign.task_id) not in response.text
    )
    await assert_rejected_write_is_unchanged(app, family, before)
    assert await revision(app, other) == foreign_before
    assert (
        Timer.model_validate((await timer_rows(app, other))[0]).model_dump(mode="json")
        == foreign_row
    )


async def test_tm1_id2_member_cancels_leaders_timer_twice_without_new_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    timer = await stored_timer(app, family, frozen_clock)
    original = Timer.model_validate(timer).model_dump(mode="json")
    before = await revision(app, family)
    headers = idem()
    path = f"/api/v1/timers/{timer.id}/cancel"
    frozen_clock.advance(timedelta(minutes=1))
    first = await client_for(family.users[1]).post(path, headers=headers)
    assert first.status_code == 200
    cancelled = first.json()
    assert cancelled["cancelled_at"] == frozen_clock.now().isoformat().replace(
        "+00:00", "Z"
    )
    for field in set(Timer.model_fields) - {"cancelled_at", "revision", "updated_at"}:
        assert cancelled[field] == original[field]
    assert cancelled["revision"] == before + 1
    assert await revision(app, family) == cancelled["revision"]
    frozen_clock.advance(timedelta(minutes=1))
    second = await client_for(family.users[0]).post(path, headers=idem())
    replay = await client_for(family.users[1]).post(path, headers=headers)
    assert second.status_code == replay.status_code == 200
    assert second.content == replay.content == first.content
    assert await revision(app, family) == cancelled["revision"]
    rows = await timer_rows(app, family)
    assert len(rows) == 1
    assert Timer.model_validate(rows[0]).model_dump(mode="json") == cancelled


async def test_tm1_create_and_cancel_both_reach_incremental_sync(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    reader, writer = client_for(family.users[0]), client_for(family.users[1])
    cursor = (await reader.get("/api/v1/sync?since=0")).json()["revision"]
    created = await writer.post(
        "/api/v1/timers", json=body_for(task, frozen_clock), headers=idem()
    )
    assert created.status_code == 200
    page = await reader.get(f"/api/v1/sync?since={cursor}")
    assert page.status_code == 200
    assert page.json()["changes"] == [{"entity": "task_timers", "row": created.json()}]
    frozen_clock.advance(timedelta(minutes=1))
    cancelled = await reader.post(
        f"/api/v1/timers/{created.json()['id']}/cancel", headers=idem()
    )
    assert cancelled.status_code == 200 and cancelled.json()["cancelled_at"] is not None
    page = await writer.get(f"/api/v1/sync?since={page.json()['revision']}")
    assert page.status_code == 200
    assert page.json()["changes"] == [
        {"entity": "task_timers", "row": cancelled.json()}
    ]


async def test_tm1_same_occurrence_can_have_multiple_timers(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    bodies = [body_for(task, frozen_clock) for _ in range(3)]
    responses = [
        await client_for(family.users[i % 2]).post(
            "/api/v1/timers", json=body, headers=idem()
        )
        for i, body in enumerate(bodies)
    ]
    assert [response.status_code for response in responses] == [200] * 3
    assert {response.json()["id"] for response in responses} == {
        body["id"] for body in bodies
    }
    assert len(await timer_rows(app, family)) == 3


async def test_id2_timer_replay_returns_current_row_and_same_id_ignores_new_intent(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    task = await stored_task(app, family)
    body, headers = body_for(task, frozen_clock), idem()
    first = await client_for(family.users[1]).post(
        "/api/v1/timers", json=body, headers=headers
    )
    assert first.status_code == 200
    before = await revision(app, family)
    repeated = await client_for(family.users[0]).post(
        "/api/v1/timers", json=body, headers=headers
    )
    assert repeated.status_code == 200 and repeated.content == first.content
    assert await revision(app, family) == before
    cancelled = await client_for(family.users[0]).post(
        f"/api/v1/timers/{body['id']}/cancel", headers=idem()
    )
    assert cancelled.status_code == 200
    before = await revision(app, family)
    changed = {
        **body,
        "task_id": str(uuid4()),
        "pet_id": str(uuid4()),
        "ends_at": (frozen_clock.now() + timedelta(hours=1)).isoformat(),
    }
    for key in (headers, idem()):
        current = await client_for(family.users[1]).post(
            "/api/v1/timers", json=changed, headers=key
        )
        assert current.status_code == 200 and current.content == cancelled.content
        assert await revision(app, family) == before
    assert len(await timer_rows(app, family)) == 1
    async with app.state.session_factory() as session:
        marker = await session.get(AppliedMutation, UUID(headers["Idempotency-Key"]))
        assert marker is not None
        assert marker.entity == "task_timers" and marker.entity_id == UUID(
            str(body["id"])
        )
