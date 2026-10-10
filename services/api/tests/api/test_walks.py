from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.clock import FrozenClock
from app.models import AppliedMutation, AppUser, FamilyRevision, WalkRoute, WalkSession
from app.schemas.rows import Walk
from app.schemas.walks import WalkFinish
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily

type Idem = Callable[[], dict[str, str]]


def start_body(
    family: TestFamily, clock: FrozenClock, **overrides: object
) -> dict[str, object]:
    return {
        "id": str(uuid4()),
        "pet_id": str(family.pets[0].id),
        "started_at": (clock.now() - timedelta(minutes=31)).isoformat(),
        **overrides,
    }


def finish_body(
    family: TestFamily, clock: FrozenClock, **overrides: object
) -> dict[str, object]:
    started_at = clock.now() - timedelta(minutes=31)
    first_ms = int(started_at.timestamp() * 1000)
    return {
        "pet_id": str(family.pets[0].id),
        "started_at": started_at.isoformat(),
        "ended_at": clock.now().isoformat(),
        "paused_ms": 60_000,
        "distance_m": 2140.5,
        "duration_s": 1800,
        "avg_pace_s_per_km": 841,
        "note": "Evening walk",
        "route": [
            [-23.5505, -46.6333, first_ms, 6.5],
            [-23.5510, -46.6320, first_ms + 3000, 6.0],
            [-23.5520, -46.6300, first_ms + 6000, 5.5],
        ],
        "preview": [[-23.5505, -46.6333], [-23.5520, -46.6300]],
        **overrides,
    }


async def stored_walk(
    app: FastAPI,
    family: TestFamily,
    clock: FrozenClock,
    *,
    owner: AppUser | None = None,
    status: str = "active",
) -> WalkSession:
    body = WalkFinish.model_validate(finish_body(family, clock))
    async with app.state.session_factory() as session:
        row = WalkSession(
            id=uuid4(),
            family_id=family.id,
            pet_id=body.pet_id,
            user_id=(owner or family.users[1]).id,
            started_at=body.started_at,
            status=status,
        )
        if status != "active":
            row.ended_at = body.ended_at
            row.paused_ms = body.paused_ms
            row.distance_m = body.distance_m
            row.duration_s = body.duration_s
            row.avg_pace_s_per_km = body.avg_pace_s_per_km
            row.note = body.note
            row.preview = [list(point) for point in body.preview]
            row.point_count = len(body.route)
            row.has_route = bool(body.route)
        if status == "discarded":
            row.deleted_at = clock.now()
        session.add(row)
        await session.flush()
        if row.has_route:
            session.add(
                WalkRoute(
                    walk_id=row.id,
                    points=[list(point) for point in body.route],
                    created_at=clock.now(),
                )
            )
        await session.commit()
        return row


async def revision(app: FastAPI, family: TestFamily) -> int:
    async with app.state.session_factory() as session:
        return (
            await session.execute(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
        ).scalar_one()


async def database_state(app: FastAPI, family: TestFamily) -> dict[str, object]:
    async with app.state.session_factory() as session:
        walks = list(
            await session.scalars(
                select(WalkSession)
                .where(WalkSession.family_id == family.id)
                .order_by(WalkSession.id)
            )
        )
        routes = list(
            await session.scalars(
                select(WalkRoute)
                .join(WalkSession)
                .where(WalkSession.family_id == family.id)
                .order_by(WalkRoute.walk_id)
            )
        )
        mutations = list(
            await session.scalars(
                select(AppliedMutation)
                .where(AppliedMutation.family_id == family.id)
                .order_by(AppliedMutation.client_mutation_id)
            )
        )
        return {
            "revision": await revision(app, family),
            "walks": [
                Walk.model_validate(row).model_dump(mode="json") for row in walks
            ],
            "routes": [(row.walk_id, row.points, row.created_at) for row in routes],
            "mutations": [
                (
                    row.client_mutation_id,
                    row.user_id,
                    row.entity,
                    row.entity_id,
                    row.created_at,
                )
                for row in mutations
            ],
        }


async def assert_finished_is_stored(
    app: FastAPI,
    family: TestFamily,
    owner: AppUser,
    id: UUID,
    body: dict[str, object],
    row: dict[str, object],
) -> None:
    assert set(row) == set(Walk.model_fields)
    assert row["id"] == str(id)
    assert row["pet_id"] == body["pet_id"]
    assert row["user_id"] == str(owner.id)
    assert row["status"] == "finished" and row["deleted_at"] is None
    for field in (
        "paused_ms",
        "distance_m",
        "duration_s",
        "avg_pace_s_per_km",
        "note",
        "preview",
    ):
        assert row[field] == body[field], field
    assert isinstance(row["distance_m"], int | float)
    parsed = WalkFinish.model_validate(body)
    assert row["started_at"] == parsed.started_at.isoformat().replace("+00:00", "Z")
    assert row["ended_at"] == parsed.ended_at.isoformat().replace("+00:00", "Z")
    assert row["point_count"] == len(parsed.route)
    assert row["has_route"] is bool(parsed.route)
    async with app.state.session_factory() as session:
        stored = await session.scalar(
            select(WalkSession).where(
                WalkSession.family_id == family.id, WalkSession.id == id
            )
        )
        assert stored is not None and stored.family_id == family.id
        assert Walk.model_validate(stored).model_dump(mode="json") == row
        route = await session.get(WalkRoute, id)
        if parsed.route:
            assert route is not None and route.points == body["route"]
        else:
            assert route is None or route.points == []


@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r4_17_rb1_start_persists_active_walk_and_syncs_to_other_member(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    started_at = frozen_clock.now() - timedelta(days=3)
    body = start_body(family, frozen_clock, started_at=started_at.isoformat())
    response = await client_for(actor).post("/api/v1/walks", json=body, headers=idem())
    assert response.status_code == 200
    row = response.json()
    assert set(row) == set(Walk.model_fields)
    assert row["id"] == body["id"] and row["pet_id"] == body["pet_id"]
    assert row["user_id"] == str(actor.id) and row["status"] == "active"
    assert row["started_at"] == started_at.isoformat().replace("+00:00", "Z")
    for field in ("ended_at", "avg_pace_s_per_km", "note", "deleted_at"):
        assert row[field] is None
    for field in ("paused_ms", "distance_m", "duration_s", "point_count"):
        assert row[field] == 0
    assert row["preview"] == [] and row["has_route"] is False
    state = await database_state(app, family)
    assert state["walks"] == [row] and state["routes"] == []
    other = next(user for user in family.users if user.id != actor.id)
    sync = await client_for(other).get("/api/v1/sync?since=0")
    assert sync.status_code == 200
    assert {"entity": "walk_sessions", "row": row} in sync.json()["changes"]


@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r4_14_finish_without_start_upserts_complete_walk_from_body(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    id = uuid4()
    body = finish_body(family, frozen_clock)
    response = await client_for(actor).post(
        f"/api/v1/walks/{id}/finish", json=body, headers=idem()
    )
    assert response.status_code == 200
    await assert_finished_is_stored(app, family, actor, id, body, response.json())
    assert len((await database_state(app, family))["walks"]) == 1


async def test_r4_14_finish_stores_metrics_route_and_preview_in_separate_tables(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    actor = family.users[1]
    walk = await stored_walk(app, family, frozen_clock, owner=actor)
    before = await revision(app, family)
    body = finish_body(family, frozen_clock)
    response = await client_for(actor).post(
        f"/api/v1/walks/{walk.id}/finish", json=body, headers=idem()
    )
    assert response.status_code == 200
    await assert_finished_is_stored(app, family, actor, walk.id, body, response.json())
    assert await revision(app, family) > before
    assert len((await database_state(app, family))["walks"]) == 1


@pytest.mark.parametrize("route_count,preview_count", [(0, 0), (0, 2), (3, 0), (3, 2)])
async def test_r4_14_route_controls_has_route_and_point_count_independently_of_preview(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    route_count: int,
    preview_count: int,
) -> None:
    family = await make_family()
    walk = await stored_walk(app, family, frozen_clock)
    parsed = WalkFinish.model_validate(finish_body(family, frozen_clock))
    body = finish_body(
        family,
        frozen_clock,
        route=[list(point) for point in parsed.route[:route_count]],
        preview=[list(point) for point in parsed.preview[:preview_count]],
        avg_pace_s_per_km=None,
        note=None,
    )
    response = await client_for(family.users[1]).post(
        f"/api/v1/walks/{walk.id}/finish", json=body, headers=idem()
    )
    assert response.status_code == 200
    await assert_finished_is_stored(
        app, family, family.users[1], walk.id, body, response.json()
    )
    route = await client_for(family.users[0]).get(f"/api/v1/walks/{walk.id}/route")
    assert route.status_code == (200 if route_count else 404)
    if route_count:
        assert route.json() == {"points": body["route"]}
    else:
        assert route.json()["code"] == "not_found"


async def test_r4_14_id2_finish_twice_keeps_row_route_and_revision_unchanged(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    walk = await stored_walk(app, family, frozen_clock)
    body, headers = finish_body(family, frozen_clock), idem()
    path = f"/api/v1/walks/{walk.id}/finish"
    client = client_for(family.users[1])
    first = await client.post(path, json=body, headers=headers)
    assert first.status_code == 200
    before = await database_state(app, family)
    frozen_clock.advance(timedelta(hours=1))
    client = client_for(family.users[1])
    changed = finish_body(
        family, frozen_clock, distance_m=12, duration_s=3, note="Changed intent"
    )
    second = await client.post(path, json=changed, headers=idem())
    replay = await client.post(path, json=body, headers=headers)
    assert second.status_code == replay.status_code == 200
    assert second.content == replay.content == first.content
    after = await database_state(app, family)
    for field in ("revision", "walks", "routes"):
        assert after[field] == before[field], field


@pytest.mark.parametrize("status", ["finished", "discarded"])
@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r4_14_finish_terminal_walk_preserves_every_field_and_saved_route(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    status: str,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    walk = await stored_walk(app, family, frozen_clock, owner=actor, status=status)
    original = Walk.model_validate(walk).model_dump(mode="json")
    before = await database_state(app, family)
    frozen_clock.advance(timedelta(hours=1))
    response = await client_for(actor).post(
        f"/api/v1/walks/{walk.id}/finish",
        json=finish_body(
            family, frozen_clock, distance_m=0, duration_s=0, route=[], preview=[]
        ),
        headers=idem(),
    )
    assert response.status_code == 200 and response.json() == original
    after = await database_state(app, family)
    for field in ("revision", "walks", "routes"):
        assert after[field] == before[field], field


@pytest.mark.parametrize("different_walkers", [False, True])
async def test_adr029_r4_7_two_active_walks_for_one_pet_are_both_accepted(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    different_walkers: bool,
) -> None:
    family = await make_family()
    first_body, second_body = (
        start_body(family, frozen_clock),
        start_body(family, frozen_clock),
    )
    first = await client_for(family.users[1]).post(
        "/api/v1/walks", json=first_body, headers=idem()
    )
    second = await client_for(
        family.users[0] if different_walkers else family.users[1]
    ).post("/api/v1/walks", json=second_body, headers=idem())
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == first_body["id"]
    assert second.json()["id"] == second_body["id"]
    assert first.json()["status"] == second.json()["status"] == "active"
    assert first.json()["pet_id"] == second.json()["pet_id"]
    assert len((await database_state(app, family))["walks"]) == 2


@pytest.mark.parametrize("status", ["active", "finished", "discarded"])
@pytest.mark.parametrize("operation", ["finish", "discard"])
@pytest.mark.parametrize("role", ["member", "leader"])
async def test_rb1_rb2_r4_18_other_walk_requires_leader_for_finish_or_discard(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    status: str,
    operation: str,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    owner = next(user for user in family.users if user.id != actor.id)
    walk = await stored_walk(app, family, frozen_clock, owner=owner, status=status)
    before = await database_state(app, family)
    response = await client_for(actor).post(
        f"/api/v1/walks/{walk.id}/{operation}",
        json=finish_body(family, frozen_clock) if operation == "finish" else None,
        headers=idem(),
    )
    assert response.status_code == (403 if role == "member" else 200)
    if role == "member":
        assert response.json()["code"] == "forbidden"
        assert await database_state(app, family) == before
    else:
        row = response.json()
        assert row["user_id"] == str(owner.id)
        expected_status = (
            "discarded"
            if operation == "discard" or status == "discarded"
            else "finished"
        )
        assert row["status"] == expected_status
        if operation == "finish":
            if status == "active":
                await assert_finished_is_stored(
                    app, family, owner, walk.id, finish_body(family, frozen_clock), row
                )
            else:
                assert row == Walk.model_validate(walk).model_dump(mode="json")
                assert await revision(app, family) == before["revision"]
        else:
            assert row["deleted_at"] is not None


@pytest.mark.parametrize("status", ["active", "finished"])
@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r4_18_id2_walker_discards_and_repeat_keeps_original_tombstone(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    status: str,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    walk = await stored_walk(app, family, frozen_clock, owner=actor, status=status)
    original = Walk.model_validate(walk).model_dump(mode="json")
    path, headers = f"/api/v1/walks/{walk.id}/discard", idem()
    client = client_for(actor)
    first = await client.post(path, headers=headers)
    assert first.status_code == 200
    discarded = first.json()
    assert discarded["status"] == "discarded"
    assert discarded["deleted_at"] == frozen_clock.now().isoformat().replace(
        "+00:00", "Z"
    )
    for field in set(Walk.model_fields) - {
        "status",
        "deleted_at",
        "revision",
        "updated_at",
    }:
        assert discarded[field] == original[field], field
    before = await database_state(app, family)
    frozen_clock.advance(timedelta(hours=1))
    client = client_for(actor)
    second = await client.post(path, headers=idem())
    replay = await client.post(path, headers=headers)
    assert second.status_code == replay.status_code == 200
    assert second.content == replay.content == first.content
    after = await database_state(app, family)
    for field in ("revision", "walks", "routes"):
        assert after[field] == before[field], field
    sync = await client_for(family.users[0]).get("/api/v1/sync?since=0")
    assert sync.status_code == 200
    assert {"entity": "walk_sessions", "row": discarded} in sync.json()["changes"]


async def test_r4_14_r4_17_sync_carries_preview_and_never_carries_full_route(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    walk = await stored_walk(app, family, frozen_clock)
    writer, reader = client_for(family.users[1]), client_for(family.users[0])
    before = (await reader.get("/api/v1/sync?since=0")).json()["revision"]
    body = finish_body(family, frozen_clock)
    finished = await writer.post(
        f"/api/v1/walks/{walk.id}/finish", json=body, headers=idem()
    )
    assert finished.status_code == 200
    for path in ("/api/v1/sync?since=0", f"/api/v1/sync?since={before}"):
        page = await reader.get(path)
        assert page.status_code == 200
        changes = [
            change
            for change in page.json()["changes"]
            if change["entity"] == "walk_sessions"
        ]
        assert changes == [{"entity": "walk_sessions", "row": finished.json()}]
        assert changes[0]["row"]["preview"] == body["preview"]
        assert set(changes[0]["row"]) == set(Walk.model_fields)
        assert "route" not in changes[0]["row"] and "points" not in changes[0]["row"]
        assert all(
            change["entity"] != "walk_routes" for change in page.json()["changes"]
        )
    before_read = await database_state(app, family)
    route = await reader.get(f"/api/v1/walks/{walk.id}/route")
    assert route.status_code == 200 and route.json() == {"points": body["route"]}
    assert await database_state(app, family) == before_read


@pytest.mark.parametrize("has_stored_points", [False, True])
async def test_r4_14_route_is_404_when_has_route_is_false_even_if_points_exist(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    has_stored_points: bool,
) -> None:
    family = await make_family()
    walk = await stored_walk(app, family, frozen_clock)
    if has_stored_points:
        async with app.state.session_factory() as session:
            session.add(
                WalkRoute(
                    walk_id=walk.id,
                    points=[[-23.55, -46.63, 1757845800000, 6.5]],
                    created_at=frozen_clock.now(),
                )
            )
            await session.commit()
    before = await database_state(app, family)
    response = await client_for(family.users[0]).get(f"/api/v1/walks/{walk.id}/route")
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert await database_state(app, family) == before


@pytest.mark.parametrize(
    "field,value,expected",
    [
        ("route", 5000, 200),
        ("route", 5001, 422),
        ("preview", 32, 200),
        ("preview", 33, 422),
        ("distance_m", -0.01, 422),
        ("distance_m", 0, 200),
        ("distance_m", 200_000, 200),
        ("distance_m", 200_000.01, 422),
        ("duration_s", -1, 422),
        ("duration_s", 0, 200),
        ("duration_s", 86_400, 200),
        ("duration_s", 86_401, 422),
    ],
)
async def test_r4_14_finish_limits_accept_edges_and_reject_values_beyond_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    field: str,
    value: int | float,
    expected: int,
) -> None:
    family = await make_family()
    walk = await stored_walk(app, family, frozen_clock)
    before = await database_state(app, family)
    changed: object = value
    if field == "route":
        changed = [
            [-23.5505, -46.6333, 1757845800000 + index * 3000, 6.5]
            for index in range(int(value))
        ]
    elif field == "preview":
        changed = [[-23.5505, -46.6333] for _ in range(int(value))]
    body = finish_body(family, frozen_clock, **{field: changed})
    response = await client_for(family.users[1]).post(
        f"/api/v1/walks/{walk.id}/finish", json=body, headers=idem()
    )
    assert response.status_code == expected
    if expected == 422:
        assert response.json()["code"] == "validation_error"
        assert await database_state(app, family) == before
    else:
        await assert_finished_is_stored(
            app, family, family.users[1], walk.id, body, response.json()
        )


@pytest.mark.parametrize("operation", ["start", "finish", "discard", "route"])
@pytest.mark.parametrize("role", ["member", "leader"])
async def test_rb1_foreign_walk_is_404_on_every_route_without_disclosure_or_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    operation: str,
    role: str,
) -> None:
    family, other = await make_family(), await make_family()
    foreign = await stored_walk(app, other, frozen_clock, status="finished")
    actor = next(user for user in family.users if user.role == role)
    before, foreign_before = (
        await database_state(app, family),
        await database_state(app, other),
    )
    client = client_for(actor)
    if operation == "start":
        response = await client.post(
            "/api/v1/walks",
            json=start_body(family, frozen_clock, id=str(foreign.id)),
            headers=idem(),
        )
    elif operation == "route":
        response = await client.get(f"/api/v1/walks/{foreign.id}/route")
    else:
        response = await client.post(
            f"/api/v1/walks/{foreign.id}/{operation}",
            json=finish_body(family, frozen_clock) if operation == "finish" else None,
            headers=idem(),
        )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert (
        str(foreign.id) not in response.text
        and str(foreign.pet_id) not in response.text
    )
    assert str(foreign.user_id) not in response.text
    assert await database_state(app, family) == before
    assert await database_state(app, other) == foreign_before


@pytest.mark.parametrize("operation", ["discard", "route"])
async def test_rb1_unknown_walk_discard_or_route_is_404_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    operation: str,
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    client = client_for(family.users[1])
    path = f"/api/v1/walks/{uuid4()}/{operation}"
    response = (
        await client.get(path)
        if operation == "route"
        else await client.post(path, headers=idem())
    )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert await database_state(app, family) == before


@pytest.mark.parametrize("operation", ["start", "finish"])
@pytest.mark.parametrize("target", ["unknown", "foreign"])
async def test_rb1_walk_pet_reference_must_belong_to_callers_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    operation: str,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    pet_id = uuid4() if target == "unknown" else other.pets[0].id
    before, foreign_before = (
        await database_state(app, family),
        await database_state(app, other),
    )
    body = (
        start_body(family, frozen_clock, pet_id=str(pet_id))
        if operation == "start"
        else finish_body(family, frozen_clock, pet_id=str(pet_id))
    )
    path = (
        "/api/v1/walks" if operation == "start" else f"/api/v1/walks/{uuid4()}/finish"
    )
    response = await client_for(family.users[1]).post(path, json=body, headers=idem())
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert await database_state(app, family) == before
    assert await database_state(app, other) == foreign_before


@pytest.mark.parametrize("operation", ["start", "finish", "discard"])
async def test_id2_walk_mutation_replay_returns_same_row_without_new_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    operation: str,
) -> None:
    family = await make_family()
    actor = family.users[1]
    if operation == "start":
        body: dict[str, object] | None = start_body(family, frozen_clock)
        id, path = UUID(str(body["id"])), "/api/v1/walks"
    else:
        walk = await stored_walk(app, family, frozen_clock, owner=actor)
        id, path = walk.id, f"/api/v1/walks/{walk.id}/{operation}"
        body = finish_body(family, frozen_clock) if operation == "finish" else None
    headers = idem()
    client = client_for(actor)
    first = await client.post(path, json=body, headers=headers)
    assert first.status_code == 200
    before = await database_state(app, family)
    frozen_clock.advance(timedelta(hours=1))
    client = client_for(actor)
    replay = await client.post(path, json=body, headers=headers)
    assert replay.status_code == 200 and replay.content == first.content
    assert await database_state(app, family) == before
    async with app.state.session_factory() as session:
        marker = await session.get(AppliedMutation, UUID(headers["Idempotency-Key"]))
        assert marker is not None
        assert marker.entity == "walk_sessions" and marker.entity_id == id
        assert marker.user_id == actor.id


async def test_id2_start_with_existing_id_returns_current_walk_and_ignores_new_intent(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family(pets=2)
    actor = family.users[1]
    headers = idem()
    body = start_body(family, frozen_clock)
    client = client_for(actor)
    first = await client.post("/api/v1/walks", json=body, headers=headers)
    assert first.status_code == 200
    finished = await client.post(
        f"/api/v1/walks/{body['id']}/finish",
        json=finish_body(family, frozen_clock),
        headers=idem(),
    )
    assert finished.status_code == 200
    before = await database_state(app, family)
    changed = start_body(
        family,
        frozen_clock,
        id=body["id"],
        pet_id=str(family.pets[1].id),
        started_at=(frozen_clock.now() - timedelta(days=1)).isoformat(),
    )
    for key in (headers, idem()):
        response = await client.post("/api/v1/walks", json=changed, headers=key)
        assert response.status_code == 200 and response.content == finished.content
        after = await database_state(app, family)
        for field in ("revision", "walks", "routes"):
            assert after[field] == before[field], field


@pytest.mark.parametrize(
    "operation,changes",
    [
        ("start", {"id": str(uuid1())}),
        ("start", {"started_at": "2026-09-14T10:30:00"}),
        ("start", {"user_id": str(uuid4())}),
        ("start", {"family_id": str(uuid4())}),
        ("finish", {"ended_at": "2026-09-14T11:00:00"}),
        ("finish", {"paused_ms": 2**63}),
        ("finish", {"avg_pace_s_per_km": 2**31}),
        ("finish", {"distance_m": 0.001}),
        ("finish", {"duration_s": 1.5}),
        ("finish", {"route": [[-23.55, -46.63]]}),
        ("finish", {"preview": [[-23.55, -46.63, 1]]}),
        ("finish", {"point_count": 100}),
        ("finish", {"has_route": True}),
        ("finish", {"note": "Invalid\x00note"}),
    ],
)
async def test_r4_14_invalid_walk_body_is_422_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    operation: str,
    changes: dict[str, object],
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    body = (
        start_body(family, frozen_clock, **changes)
        if operation == "start"
        else finish_body(family, frozen_clock, **changes)
    )
    path = (
        "/api/v1/walks" if operation == "start" else f"/api/v1/walks/{uuid4()}/finish"
    )
    response = await client_for(family.users[1]).post(path, json=body, headers=idem())
    assert response.status_code == 422 and response.json()["code"] == "validation_error"
    assert await database_state(app, family) == before
