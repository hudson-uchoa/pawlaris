import asyncio
from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from fastapi.routing import iter_route_contexts
from sqlalchemy import func, select, update

from app.clock import FrozenClock
from app.models import AppUser, FamilyRevision, TaskTemplate
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily
from tests.security.matrix import PERMISSION_MATRIX, PermissionCase, task_body

type Idem = Callable[[], dict[str, str]]
WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


async def revision(app: FastAPI, family: TestFamily) -> int:
    async with app.state.session_factory() as session:
        return (
            await session.execute(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
        ).scalar_one()


async def stored_task(
    app: FastAPI, family: TestFamily, *, creator: int = 1, assignee: int | None = None
) -> TaskTemplate:
    async with app.state.session_factory() as session:
        values = await family.row_values(session, "task_template")
        values.update(
            created_by=family.users[creator].id,
            assigned_to=None if assignee is None else family.users[assignee].id,
        )
        row = TaskTemplate(**values)
        session.add(row)
        await session.commit()
        return row


VALID_RULES: list[dict[str, object]] = [
    {"freq": "daily", "interval": 1},
    {"freq": "daily", "interval": 365},
    {"freq": "weekly", "interval": 1, "byday": ["MO"]},
    {"freq": "weekly", "interval": 365, "byday": WEEKDAYS},
    {"freq": "weekly", "interval": 2, "byday": ["SU", "MO"]},
    {"freq": "monthly", "interval": 1, "bymonthday": [1]},
    {"freq": "monthly", "interval": 365, "bymonthday": list(range(1, 32))},
    {"freq": "monthly", "interval": 2, "bymonthday": [31, 1]},
    {"freq": "once", "date": "2026-09-14"},
]


@pytest.mark.parametrize("rule", VALID_RULES)
async def test_rc1_store_each_recurrence_shape_and_boundaries_without_evaluating(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    rule: dict[str, object],
) -> None:
    family = await make_family()
    body = task_body(family)
    body.update(
        recurrence=rule,
        description="Task details",
        category="medication",
        requires_photo=True,
        timer_seconds=86400,
        reminder_class="critical",
        sort_order=-1,
        times_of_day=["00:00", "23:59"],
        completion_mode="per_pet",
        ends_on="2026-09-13",
    )
    response = await client_for(family.users[1]).post(
        "/api/v1/tasks", json=body, headers=idem()
    )
    assert response.status_code == 200
    row = response.json()
    assert row.items() >= body.items()
    assert row["created_by"] == str(family.users[1].id) and "family_id" not in row
    assert row["assigned_to"] is None and row["deleted_at"] is None
    async with app.state.session_factory() as session:
        stored = await session.get(TaskTemplate, UUID(str(body["id"])))
        assert stored is not None and stored.recurrence == rule
    changes = (await client_for(family.users[0]).get("/api/v1/sync?since=0")).json()[
        "changes"
    ]
    assert {"entity": "task_templates", "row": row} in changes


INVALID_RULES: list[object] = [None, [], "daily", {}, {"freq": "yearly"}]
for freq in ("daily", "weekly", "monthly"):
    extra: dict[str, object] = (
        {"byday": ["MO"]}
        if freq == "weekly"
        else {"bymonthday": [1]}
        if freq == "monthly"
        else {}
    )
    INVALID_RULES.append({"freq": freq, **extra})
    for interval in (0, 366, -1, 1.5, "1", True, None):
        INVALID_RULES.append({"freq": freq, "interval": interval, **extra})
    INVALID_RULES.append({"freq": freq, "interval": 1, **extra, "unknown": 1})
for days in (None, [], "MO", ["XX"], ["mo"], ["MO", "MO"], WEEKDAYS + ["MO"]):
    INVALID_RULES.append({"freq": "weekly", "interval": 1, "byday": days})
INVALID_RULES.append({"freq": "weekly", "interval": 1})
for days in (
    None,
    [],
    "1",
    [0],
    [32],
    [1.5],
    [True],
    ["1"],
    [1, 1],
    list(range(1, 33)),
):
    INVALID_RULES.append({"freq": "monthly", "interval": 1, "bymonthday": days})
INVALID_RULES.append({"freq": "monthly", "interval": 1})
for date in (
    None,
    "2026-09-13",
    "2026-09-15",
    "2026-02-30",
    "2026-9-14",
    "2026-09-14T00:00:00Z",
    1789344000,
    "2026-09-14\n",
):
    INVALID_RULES.append({"freq": "once", "date": date})
INVALID_RULES.extend(
    [
        {"freq": "once"},
        {"freq": "once", "date": "2026-09-14", "interval": 1},
        {"freq": "once", "date": "2026-09-14", "unknown": 1},
        {"freq": "daily", "interval": 1, "byday": ["MO"]},
        {"freq": "weekly", "interval": 1, "byday": ["MO"], "bymonthday": [1]},
        {"freq": "monthly", "interval": 1, "bymonthday": [1], "date": "2026-09-14"},
    ]
)


@pytest.mark.parametrize("rule", INVALID_RULES)
async def test_rc1_each_invalid_recurrence_is_422(
    make_family: MakeFamily, client_for: ClientFor, idem: Idem, rule: object
) -> None:
    family = await make_family()
    body = {**task_body(family), "recurrence": rule}
    response = await client_for(family.users[0]).post(
        "/api/v1/tasks", json=body, headers=idem()
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error" and response.json()["errors"]


@pytest.mark.parametrize(
    "times,expected",
    [
        ([], 200),
        (["00:00"], 200),
        (["19:59", "20:00", "23:59"], 200),
        ([f"{hour:02}:00" for hour in range(8)], 200),
        ([f"{hour:02}:00" for hour in range(9)], 422),
        (["24:00"], 422),
        (["23:60"], 422),
        (["-1:00"], 422),
        (["00:-1"], 422),
        (["8:00"], 422),
        (["08:0"], 422),
        (["08:00:00"], 422),
        (["08:00\n"], 422),
        (["０８:00"], 422),
        (["20:00", "08:00"], 422),
        (["08:00", "08:00"], 422),
        ([None], 422),
        ([800], 422),
        ("08:00", 422),
        (None, 422),
    ],
)
async def test_rc1_times_have_exact_shape_count_order_and_uniqueness(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    times: object,
    expected: int,
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).post(
        "/api/v1/tasks",
        json={**task_body(family), "times_of_day": times},
        headers=idem(),
    )
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["times_of_day"] == times


@pytest.mark.parametrize(
    "field,value",
    [
        ("recurrence", {"freq": "weekly", "interval": 2, "byday": ["WE"]}),
        ("times_of_day", ["12:00"]),
        ("starts_on", "2026-10-01"),
        ("pet_ids", [str(uuid4())]),
        ("completion_mode", "per_pet"),
    ],
)
async def test_tk1_patch_schedule_field_is_422_and_leaves_existing_row_untouched(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    field: str,
    value: object,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    created = await client.post("/api/v1/tasks", json=task_body(family), headers=idem())
    assert created.status_code == 200
    row = created.json()
    before = await revision(app, family)
    changed = await client.patch(
        f"/api/v1/tasks/{row['id']}",
        json={field: value, "title": "Should roll back"},
        headers=idem(),
    )
    assert changed.status_code == 422 and await revision(app, family) == before
    replay = await client.post(
        "/api/v1/tasks", json={**task_body(family), "id": row["id"]}, headers=idem()
    )
    assert replay.status_code == 200 and replay.json() == row


@pytest.mark.parametrize("target", ["unknown", "foreign", "duplicate", "empty"])
async def test_r3_1_pet_list_elements_are_422(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    pets = {
        "unknown": [str(uuid4())],
        "foreign": [str(other.pets[0].id)],
        "duplicate": [str(family.pets[0].id)] * 2,
        "empty": [],
    }[target]
    before = await revision(app, family)
    response = await client_for(family.users[0]).post(
        "/api/v1/tasks", json={**task_body(family), "pet_ids": pets}, headers=idem()
    )
    assert response.status_code == 422 and response.json()["errors"]
    assert await revision(app, family) == before


@pytest.mark.parametrize("field", ["assigned_to", "replaces_task_id"])
@pytest.mark.parametrize("target", ["unknown", "foreign"])
@pytest.mark.parametrize("method", ["POST", "PATCH"])
async def test_rb1_scalar_references_outside_family_are_404(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    field: str,
    target: str,
    method: str,
) -> None:
    if method == "PATCH" and field == "replaces_task_id":
        # It is immutable, so the schema rejects this before any lookup.
        expected = 422
    else:
        expected = 404
    family, other = await make_family(), await make_family()
    foreign = (
        other.users[0].id
        if field == "assigned_to"
        else (await stored_task(app, other)).id
    )
    value = str(uuid4() if target == "unknown" else foreign)
    row = await stored_task(app, family, creator=0)
    path = "/api/v1/tasks" if method == "POST" else f"/api/v1/tasks/{row.id}"
    body = task_body(family) if method == "POST" else {}
    body[field] = value
    response = await client_for(family.users[0]).request(
        method, path, json=body, headers=idem()
    )
    assert response.status_code == expected


@pytest.mark.parametrize("method", ["POST", "PATCH"])
@pytest.mark.parametrize("actor_index", [0, 1])
async def test_q16_disabled_assignee_becomes_null_before_assignment_permissions(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    method: str,
    actor_index: int,
) -> None:
    family = await make_family(members=3)
    row = await stored_task(app, family, creator=actor_index, assignee=actor_index)
    async with app.state.session_factory() as session:
        await session.execute(
            update(AppUser)
            .where(AppUser.id == family.users[2].id)
            .values(disabled_at=frozen_clock.now())
        )
        await session.commit()
    body = task_body(family) if method == "POST" else {}
    body["assigned_to"] = str(family.users[2].id)
    path = "/api/v1/tasks" if method == "POST" else f"/api/v1/tasks/{row.id}"
    response = await client_for(family.users[actor_index]).request(
        method, path, json=body, headers=idem()
    )
    assert response.status_code == 200 and response.json()["assigned_to"] is None
    async with app.state.session_factory() as session:
        stored = await session.get(TaskTemplate, UUID(response.json()["id"]))
        assert stored is not None and stored.assigned_to is None


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize(
    "case", [case for case in PERMISSION_MATRIX if 11 <= case.row <= 15]
)
async def test_rb1_rows_11_to_15_and_fork_exception(
    make_family: MakeFamily, client_for: ClientFor, role: str, case: PermissionCase
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    request = await case.request(family, actor)
    response = await client_for(actor).request(
        case.method, request.url, json=request.json, headers=request.headers
    )
    assert response.status_code == case.expected[role]


@pytest.mark.parametrize(
    "replacement", ["own", "absent", "other_creator", "different_assignee"]
)
async def test_r3_3_member_fork_may_only_keep_own_templates_assignee(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    replacement: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    old = await stored_task(
        app,
        family,
        creator=0 if replacement == "other_creator" else 1,
        assignee=None if replacement == "different_assignee" else 0,
    )
    body = {
        **task_body(family),
        "assigned_to": str(family.users[0].id),
        "starts_on": "2026-10-01",
    }
    if replacement != "absent":
        body["replaces_task_id"] = str(old.id)
    before = await revision(app, family)
    response = await client.post("/api/v1/tasks", json=body, headers=idem())
    assert response.status_code == (200 if replacement == "own" else 403)
    if replacement == "own":
        assert response.json()["starts_on"] == "2026-10-01"
        async with app.state.session_factory() as session:
            original = await session.get(TaskTemplate, old.id)
            assert original is not None and original.ends_on is None
        ended = await client.patch(
            f"/api/v1/tasks/{old.id}", json={"ends_on": "2026-09-30"}, headers=idem()
        )
        assert ended.status_code == 200 and ended.json()["ends_on"] == "2026-09-30"
    else:
        assert await revision(app, family) == before


@pytest.mark.parametrize("assignee", [None, "self"])
async def test_r3_3_member_may_clear_or_self_assign_own_task(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    assignee: str | None,
) -> None:
    family = await make_family()
    row = await stored_task(app, family, assignee=0)
    value = str(family.users[1].id) if assignee == "self" else None
    response = await client_for(family.users[1]).patch(
        f"/api/v1/tasks/{row.id}", json={"assigned_to": value}, headers=idem()
    )
    assert response.status_code == 200 and response.json()["assigned_to"] == value


async def test_r3_7_patch_only_present_fields_nulls_and_noop_revisions(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, idem: Idem
) -> None:
    family = await make_family()
    row = await stored_task(app, family, assignee=0)
    client = client_for(family.users[1])
    path = f"/api/v1/tasks/{row.id}"
    original = await client.patch(path, json={}, headers=idem())
    assert original.status_code == 200 and original.json()["revision"] == row.revision
    patch = {
        "title": "Changed",
        "description": "Details",
        "category": "feeding",
        "requires_photo": True,
        "timer_seconds": 1,
        "reminder_class": "critical",
        "sort_order": 12,
        "ends_on": "2026-09-13",
    }
    changed = await client.patch(path, json=patch, headers=idem())
    assert changed.status_code == 200 and changed.json().items() >= patch.items()
    for key, value in original.json().items():
        if key not in {*patch, "updated_at", "revision"}:
            assert changed.json()[key] == value
    repeated = await client.patch(path, json=patch, headers=idem())
    assert repeated.json() == changed.json()
    cleared = await client.patch(
        path,
        json={"description": None, "timer_seconds": None, "ends_on": None},
        headers=idem(),
    )
    assert cleared.status_code == 200 and all(
        cleared.json()[field] is None
        for field in ("description", "timer_seconds", "ends_on")
    )
    assert cleared.json()["assigned_to"] == str(family.users[0].id)


@pytest.mark.parametrize("method", ["POST", "PATCH"])
@pytest.mark.parametrize(
    "field,value,expected",
    [
        ("title", "", 422),
        ("title", "x", 200),
        ("title", "x" * 80, 200),
        ("title", "x" * 81, 422),
        ("timer_seconds", 0, 422),
        ("timer_seconds", 1, 200),
        ("timer_seconds", 86400, 200),
        ("timer_seconds", 86401, 422),
        ("sort_order", -(2**31) - 1, 422),
        ("sort_order", -(2**31), 200),
        ("sort_order", 2**31 - 1, 200),
        ("sort_order", 2**31, 422),
        ("category", "invalid", 422),
        ("reminder_class", "invalid", 422),
        ("title", None, 422),
        ("category", None, 422),
        ("requires_photo", None, 422),
        ("sort_order", None, 422),
        ("reminder_class", None, 422),
        ("unknown", 1, 422),
        ("description", "before\x00after", 422),
    ],
)
async def test_r3_6_cosmetic_bounds_and_body_validation_on_real_targets(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    method: str,
    field: str,
    value: object,
    expected: int,
) -> None:
    family = await make_family()
    row = await stored_task(app, family, creator=0)
    body = task_body(family) if method == "POST" else {}
    body[field] = value
    path = "/api/v1/tasks" if method == "POST" else f"/api/v1/tasks/{row.id}"
    response = await client_for(family.users[0]).request(
        method, path, json=body, headers=idem()
    )
    assert response.status_code == expected
    if expected == 200:
        assert response.json()[field] == value


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", str(uuid1())),
        ("recurrence", None),
        ("starts_on", None),
        ("pet_ids", None),
        ("completion_mode", None),
        ("completion_mode", "invalid"),
    ],
)
async def test_r3_6_create_required_types(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    field: str,
    value: object,
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).post(
        "/api/v1/tasks", json={**task_body(family), field: value}, headers=idem()
    )
    assert response.status_code == 422


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize("method", ["POST", "PATCH", "DELETE"])
async def test_rb1_other_family_target_is_404_before_task_permissions(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    role: str,
    method: str,
) -> None:
    family, other = await make_family(), await make_family()
    row = await stored_task(app, other)
    actor = next(user for user in family.users if user.role == role)
    body = (
        {**task_body(family), "id": str(row.id)}
        if method == "POST"
        else {"title": "Changed"}
        if method == "PATCH"
        else None
    )
    path = "/api/v1/tasks" if method == "POST" else f"/api/v1/tasks/{row.id}"
    before = await revision(app, other)
    response = await client_for(actor).request(method, path, json=body, headers=idem())
    assert response.status_code == 404 and str(row.id) not in response.text
    assert await revision(app, other) == before


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
async def test_rb1_unknown_task_target_is_404(
    make_family: MakeFamily, client_for: ClientFor, idem: Idem, method: str
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).request(
        method,
        f"/api/v1/tasks/{uuid4()}",
        json={} if method == "PATCH" else None,
        headers=idem(),
    )
    assert response.status_code == 404


async def test_id2_existing_id_and_tombstone_are_unchanged_before_new_references(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    body = task_body(family)
    created = await client.post("/api/v1/tasks", json=body, headers=idem())
    assert created.status_code == 200
    body.update(
        pet_ids=[str(uuid4())] * 2,
        assigned_to=str(uuid4()),
        replaces_task_id=str(uuid4()),
        title="Different intent",
    )
    repeated = await client.post("/api/v1/tasks", json=body, headers=idem())
    assert repeated.status_code == 200 and repeated.json() == created.json()
    deleted = await client.delete(f"/api/v1/tasks/{body['id']}", headers=idem())
    assert deleted.status_code == 200 and deleted.json()[
        "deleted_at"
    ] == frozen_clock.now().isoformat().replace("+00:00", "Z")
    frozen_clock.advance(timedelta(days=1))
    before = await revision(app, family)
    repeated_delete = await client.delete(f"/api/v1/tasks/{body['id']}", headers=idem())
    assert (
        repeated_delete.status_code == 200 and repeated_delete.json() == deleted.json()
    )
    recreated = await client.post("/api/v1/tasks", json=body, headers=idem())
    assert recreated.status_code == 200 and recreated.json() == deleted.json()
    patched = await client.patch(
        f"/api/v1/tasks/{body['id']}", json={"title": "Resurrect"}, headers=idem()
    )
    assert patched.status_code == 404 and await revision(app, family) == before
    changes = (
        await client.get(f"/api/v1/sync?since={created.json()['revision']}")
    ).json()["changes"]
    assert changes == [{"entity": "task_templates", "row": deleted.json()}]


async def test_id2_ten_concurrent_creates_of_same_task_id_write_one_row(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, idem: Idem
) -> None:
    family = await make_family()
    body = task_body(family)
    before = await revision(app, family)
    responses = await asyncio.gather(
        *[
            client_for(family.users[index % 2]).post(
                "/api/v1/tasks", json=body, headers=idem()
            )
            for index in range(10)
        ]
    )
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json() == responses[0].json() for response in responses)
    assert await revision(app, family) == before + 1
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(TaskTemplate)
                .where(TaskTemplate.id == UUID(str(body["id"])))
            )
            == 1
        )


def test_r3_12_no_route_computes_or_returns_occurrences(app: FastAPI) -> None:
    paths = [context.path for context in iter_route_contexts(app.routes)]
    assert paths and all(
        not any(
            word in (path or "").lower() for word in ("occurrence", "today", "schedule")
        )
        for path in paths
    )
