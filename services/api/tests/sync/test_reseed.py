"""Reseed foundations: local timestamp preservation and duplicate metadata."""

import asyncio
import json
import secrets
from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Callable, Sequence
from copy import deepcopy
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import Date, DateTime, Numeric, Uuid, inspect, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import FrozenClock
from app.idempotency import ENTITY_REGISTRY
from app.locks import lock_family
from app.models import (
    AppUser,
    Base,
    Family,
    InviteCode,
    Pet,
    PushDevice,
    RefreshToken,
    TaskCompletion,
    WalkRoute,
)
from app.push import PushMessage, completion_duplicate_message
from app.realtime import Hub
from app.security.passwords import verify_password
from app.security.tokens import new_refresh_token
from app.settings import Settings
from tests.api.test_push import FakeSender, assert_messages, drain_pushes, seed_devices
from tests.api.test_reserve_role import database_rows
from tests.conftest import ClientFor
from tests.factories import MakeFamily, ScratchDatabase, TestFamily
from tests.sync.test_completions import body_for, make_task

type Idem = Callable[[], dict[str, str]]


@pytest.fixture
def settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"push_enabled": False})


@pytest.mark.parametrize("table_name", ["pet", "family"])
@pytest.mark.parametrize("operation", ["insert", "update"])
@pytest.mark.parametrize(
    "reseed,supply_instant",
    [("on", True), (None, True), ("off", True), ("on", False)],
    ids=["on-preserves", "absent-stamps", "off-stamps", "on-null-stamps"],
)
async def test_reseed_trigger_keeps_supplied_time_only_inside_a_reseed(
    app: FastAPI,
    make_family: MakeFamily,
    frozen_clock: FrozenClock,
    table_name: str,
    operation: str,
    reseed: str | None,
    supply_instant: bool,
) -> None:
    family = await make_family()
    table = Base.metadata.tables[table_name]
    async with app.state.session_factory() as session:
        values = await family.row_values(session, table_name)
        # An update starts from a committed row, outside the reseed transaction.
        if operation == "update":
            await session.execute(table.insert().values(**values))
        await session.commit()

    supplied = frozen_clock.now() - timedelta(days=30) if supply_instant else None
    family_id = values["id"] if table_name == "family" else family.id
    async with app.state.engine.begin() as connection:
        if reseed == "on":
            await connection.execute(text("SET LOCAL pawlaris.reseed = 'on'"))
        elif reseed == "off":
            await connection.execute(text("SET LOCAL pawlaris.reseed = 'off'"))
        else:
            setting = (
                await connection.execute(
                    text("SELECT current_setting('pawlaris.reseed', true)")
                )
            ).scalar_one()
            assert setting in (None, "")
        transaction_now = (await connection.execute(text("SELECT now()"))).scalar_one()
        before = (
            await connection.execute(
                text("SELECT value FROM family_revision WHERE family_id = :id"),
                {"id": family_id},
            )
        ).scalar_one_or_none() or 0
        statement = (
            table.insert().values(**{**values, "updated_at": supplied, "revision": -1})
            if operation == "insert"
            else table.update()
            .where(table.c.id == values["id"])
            .values(updated_at=supplied, revision=-1)
        )
        row = (
            await connection.execute(
                statement.returning(table.c.updated_at, table.c.revision)
            )
        ).one()
        assert row.revision == before + 1
        counter = (
            await connection.execute(
                text("SELECT value FROM family_revision WHERE family_id = :id"),
                {"id": family_id},
            )
        ).scalar_one()
        assert counter == row.revision
        expected = (
            supplied if reseed == "on" and supplied is not None else transaction_now
        )
        assert row.updated_at == expected


async def test_rs4_duplicate_of_column_is_nullable_self_reference(app: FastAPI) -> None:
    async with app.state.engine.connect() as connection:
        columns, foreign_keys = await connection.run_sync(
            lambda database: (
                inspect(database).get_columns("task_completion"),
                inspect(database).get_foreign_keys("task_completion"),
            )
        )
    column = next((item for item in columns if item["name"] == "duplicate_of"), None)
    assert column is not None, "task_completion must have duplicate_of"
    assert column["nullable"] is True
    assert str(column["type"]) == "UUID"
    assert any(
        key["constrained_columns"] == ["duplicate_of"]
        and key["referred_table"] == "task_completion"
        and key["referred_columns"] == ["id"]
        for key in foreign_keys
    )


@pytest.mark.parametrize("mode", ["together", "per_pet"])
@pytest.mark.parametrize("undone", [False, True], ids=["live", "undone"])
async def test_rs4_sync_carries_null_duplicate_of_for_ordinary_completions(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
    undone: bool,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    http = client_for(family.users[0])
    completed = await http.post(
        "/api/v1/completions", json=body_for(task, frozen_clock), headers=idem()
    )
    assert completed.status_code == 200
    if undone:
        response = await http.post(
            f"/api/v1/completions/{completed.json()['id']}/undo", headers=idem()
        )
        assert response.status_code == 200
    page = await http.get("/api/v1/sync", params={"since": 0, "limit": 500})
    assert page.status_code == 200
    rows = [
        change["row"]
        for change in page.json()["changes"]
        if change["entity"] == "task_completions"
    ]
    assert len(rows) == 1
    assert rows[0]["id"] == completed.json()["id"]
    assert "duplicate_of" in rows[0] and rows[0]["duplicate_of"] is None
    assert (rows[0]["undone_at"] is not None) == undone


@pytest.mark.parametrize("mode", ["together", "per_pet"])
@pytest.mark.parametrize("operation", ["complete", "undo"])
async def test_rs4_completion_responses_carry_null_duplicate_of(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
    operation: str,
) -> None:
    family = await make_family()
    task = await make_task(app, family, mode)
    http = client_for(family.users[0])
    response = await http.post(
        "/api/v1/completions", json=body_for(task, frozen_clock), headers=idem()
    )
    assert response.status_code == 200
    if operation == "undo":
        response = await http.post(
            f"/api/v1/completions/{response.json()['id']}/undo", headers=idem()
        )
        assert response.status_code == 200
    row = response.json()
    assert "duplicate_of" in row and row["duplicate_of"] is None
    assert (row["undone_at"] is not None) == (operation == "undo")


type Values = dict[str, object]
type Groups = dict[str, list[Values]]
FIXTURE = cast(
    Values,
    json.loads(
        (
            Path(__file__).resolve().parents[4] / "spec/fixtures/reseed-vectors.json"
        ).read_text(encoding="utf-8")
    ),
)
VECTORS = cast(list[Values], FIXTURE["vectors"])
ENTITY_ORDER = (
    "members",
    "family",
    "pets",
    "task_templates",
    "weight_entries",
    "health_events",
    "task_completions",
    "task_timers",
    "walk_sessions",
    "walk_routes",
)
ACCOUNT_TABLES = ("app_user", "invite_code", "refresh_token", "push_device")


@pytest.fixture
async def database_url(
    database_url: str, request: pytest.FixtureRequest, scratch_database: ScratchDatabase
) -> AsyncIterator[str]:
    # Each vector/way and each new case starts with its own migrated database.
    # The existing P2-16 tests retain their suite database and fixtures.
    if "reseed_base" in request.fixturenames:
        async with scratch_database() as fresh:
            yield fresh
    else:
        yield database_url


@pytest.fixture
def frozen_clock(
    frozen_clock: FrozenClock, request: pytest.FixtureRequest
) -> FrozenClock:
    if "reseed_base" in request.fixturenames:
        return FrozenClock(datetime.fromisoformat(str(FIXTURE["now"])))
    return frozen_clock


def table_for(entity: str) -> str:
    return (
        "walk_route"
        if entity == "walk_routes"
        else ENTITY_REGISTRY[entity].model.__tablename__
    )


def database_values(entity: str, row: Values, family: TestFamily) -> Values:
    """Convert wire values for direct seeding; never rewrite incoming bounds."""
    table = Base.metadata.tables[table_for(entity)]
    values = {key: value for key, value in row.items() if key in table.c}
    values.pop("revision", None)
    if "family_id" in table.c:
        values["family_id"] = family.id
    for key, value in tuple(values.items()):
        if value is None:
            continue
        column = table.c[key]
        if isinstance(column.type, Uuid):
            values[key] = UUID(str(value))
        elif isinstance(column.type, DateTime):
            values[key] = datetime.fromisoformat(str(value))
        elif isinstance(column.type, Date):
            values[key] = date.fromisoformat(str(value))
        elif isinstance(column.type, Numeric):
            values[key] = Decimal(str(value))
        elif key == "pet_ids":
            values[key] = [UUID(str(item)) for item in cast(list[object], value)]
    if entity == "members":
        values.update(email=f"{row['id']}@example.invalid", password_hash=str(uuid4()))
    return values


async def complete_vector_row(
    session: AsyncSession,
    family: TestFamily,
    entity: str,
    partial: Values,
    clock: FrozenClock,
) -> Values:
    """Read factory values and real database defaults inside a rolled-back savepoint."""
    if entity == "walk_routes":
        return deepcopy(partial)
    entry = ENTITY_REGISTRY[entity]
    # row_values creates a template for a completion/timer. Roll that back too:
    # factories must never make a vector's missing reference secretly exist.
    nested = await session.begin_nested()
    try:
        values = await family.row_values(session, entry.model.__tablename__)
        model = entry.model(**values)
        session.add(model)
        await session.flush()
        defaults = entry.schema.model_validate(model).model_dump(mode="json")
    finally:
        await nested.rollback()
    defaults.pop("revision")
    defaults["updated_at"] = (clock.now() - timedelta(days=10)).isoformat()
    if entity in ("task_completions", "task_timers"):
        base = cast(Values, FIXTURE["base"])
        defaults["task_id"] = cast(list[Values], base["task_templates"])[0]["id"]
    return {**defaults, **deepcopy(partial)}


async def seed_groups(
    app: FastAPI, family: TestFamily, groups: Groups, clock: FrozenClock
) -> None:
    async with app.state.session_factory() as session:
        await session.execute(text("SET LOCAL pawlaris.reseed = 'on'"))
        for entity in ENTITY_ORDER:
            for partial in groups.get(entity, []):
                row = await complete_vector_row(session, family, entity, partial, clock)
                table = Base.metadata.tables[table_for(entity)]
                await session.execute(
                    table.insert().values(**database_values(entity, row, family))
                )
        await session.commit()


@pytest.fixture
async def reseed_base(
    app: FastAPI, settings: Settings, frozen_clock: FrozenClock
) -> TestFamily:
    base = cast(Values, FIXTURE["base"])
    family_row = cast(Values, base["family"])
    members = cast(list[Values], base["members"])
    pets = cast(list[Values], base["pets"])
    # These id holders let the suite's row_values factory supply the references
    # while constructing the exact base in the read-only fixture.
    family = TestFamily(
        Family(id=UUID(str(family_row["id"])), name=str(family_row["name"])),
        [AppUser(id=UUID(str(row["id"]))) for row in members],
        [Pet(id=UUID(str(row["id"]))) for row in pets],
        settings.database_url.get_secret_value(),
        settings.blob_dir,
    )
    # The family must exist before its members, unlike the reseed apply order.
    await seed_groups(app, family, {"family": [family_row]}, frozen_clock)
    for entity in ("members", "pets", "task_templates"):
        await seed_groups(
            app, family, {entity: cast(list[Values], base[entity])}, frozen_clock
        )
    async with app.state.session_factory() as session:
        family.family = (
            await session.scalars(select(Family).where(Family.id == family.id))
        ).one()
        family.users = list(
            await session.scalars(
                select(AppUser)
                .where(AppUser.family_id == family.id)
                .order_by(AppUser.id)
            )
        )
        family.pets = list(
            await session.scalars(
                select(Pet).where(Pet.family_id == family.id).order_by(Pet.id)
            )
        )
        # Existing account state is populated so RS-5 catches deletion or mutation
        # as well as creation, and does not merely compare empty tables.
        _, digest = new_refresh_token()
        session.add(
            InviteCode(
                code=secrets.token_hex(5).upper(),
                family_id=family.id,
                role="member",
                created_by=family.users[0].id,
                expires_at=frozen_clock.now() + timedelta(days=1),
            )
        )
        session.add(
            RefreshToken(
                id=uuid4(),
                user_id=family.users[1].id,
                chain_id=uuid4(),
                token_hash=digest,
                expires_at=frozen_clock.now() + timedelta(days=30),
            )
        )
        session.add(
            PushDevice(token=secrets.token_urlsafe(24), user_id=family.users[1].id)
        )
        await session.commit()
    return family


async def incoming_rows(
    app: FastAPI, family: TestFamily, partials: Sequence[Values], clock: FrozenClock
) -> list[Values]:
    async with app.state.session_factory() as session:
        return [
            {
                "entity": change["entity"],
                "row": await complete_vector_row(
                    session,
                    family,
                    str(change["entity"]),
                    cast(Values, change["row"]),
                    clock,
                ),
            }
            for change in partials
        ]


def vector_batches(rows: list[Values], way: str) -> list[list[Values]]:
    if way == "once":
        return [rows]
    if way == "twice":
        return [rows, rows]
    if way == "reverse":
        return [list(reversed(rows))]
    # Q-25: singleton calls follow dependencies, as the phone's batches do.
    pending = sorted(rows, key=lambda change: ENTITY_ORDER.index(str(change["entity"])))
    ordered: list[Values] = []
    ids = {
        str(cast(Values, change["row"])["id"])
        for change in pending
        if "id" in cast(Values, change["row"])
    }
    while pending:
        eligible = next(
            (
                change
                for change in pending
                if all(
                    str(cast(Values, change["row"]).get(field)) not in ids
                    for field in ("replaces_task_id", "duplicate_of")
                )
            ),
            None,
        )
        assert eligible is not None, "Vector dependencies must be acyclic"
        ordered.append(eligible)
        pending.remove(eligible)
        ids.discard(str(cast(Values, eligible["row"]).get("id")))
    return [[change] for change in ordered]


async def stored_groups(app: FastAPI, family_id: UUID) -> Groups:
    result: Groups = {}
    async with app.state.session_factory() as session:
        for entity, entry in ENTITY_REGISTRY.items():
            table = entry.model.__table__
            owner = table.c.id if entity == "family" else table.c.family_id
            rows = await session.scalars(select(entry.model).where(owner == family_id))
            result[entity] = [
                entry.schema.model_validate(row).model_dump(mode="json") for row in rows
            ]
        result["walk_routes"] = [
            {"walk_id": str(row.walk_id), "points": row.points}
            for row in await session.scalars(
                select(WalkRoute)
                .join(Base.metadata.tables["walk_session"])
                .where(Base.metadata.tables["walk_session"].c.family_id == family_id)
            )
        ]
    return result


def normalized(value: object, clock: FrozenClock) -> object:
    if value == "@now":
        return clock.now()
    if isinstance(value, str):
        try:
            instant = datetime.fromisoformat(value)
        except ValueError:
            return value
        return instant if instant.tzinfo is not None else value
    return value


def assert_partial_groups(actual: Groups, expected: Groups, clock: FrozenClock) -> None:
    for entity, rows in expected.items():
        key = "walk_id" if entity == "walk_routes" else "id"
        indexed = {row[key]: row for row in actual[entity]}
        for row in rows:
            assert row[key] in indexed, (entity, row[key])
            for field, value in row.items():
                assert normalized(indexed[row[key]][field], clock) == normalized(
                    value, clock
                ), (entity, row[key], field)


async def assert_rs4(app: FastAPI, family: TestFamily) -> None:
    async with app.state.session_factory() as session:
        groups: dict[tuple[UUID, str, UUID | None], list[TaskCompletion]] = defaultdict(
            list
        )
        for row in await session.scalars(
            select(TaskCompletion).where(TaskCompletion.family_id == family.id)
        ):
            groups[row.task_id, row.occurrence_key, row.pet_id].append(row)
        for rows in groups.values():
            live = [row for row in rows if row.undone_at is None]
            assert len(live) <= 1, "RS-4: at most one live completion"
            # Q-27: an intentional undo is not a contender or a duplicate.
            contenders = [
                row
                for row in rows
                if row.undone_at is None or row.duplicate_of is not None
            ]
            if not live:
                continue
            winner = live[0]
            assert (winner.completed_at, winner.id) == min(
                (row.completed_at, row.id) for row in contenders
            )
            assert winner.duplicate_of is None
            for row in contenders:
                if row.id != winner.id:
                    assert row.undone_at is not None
                    assert row.duplicate_of == winner.id


async def assert_rs5(app: FastAPI, before: dict[str, list[Values]]) -> list[AppUser]:
    after = await database_rows(app)
    existing = {row["id"]: row for row in before["app_user"]}
    current = {row["id"]: row for row in after["app_user"]}
    for id, row in existing.items():
        assert current[id] == row, "RS-5: existing accounts never change"
    for name in ACCOUNT_TABLES[1:]:
        assert after[name] == before[name], f"RS-5: {name} never changes"
    async with app.state.session_factory() as session:
        stubs = list(
            await session.scalars(
                select(AppUser).where(AppUser.id.not_in(list(existing)))
            )
        )
    for stub in stubs:
        assert stub.role == "member"
        assert stub.email == f"stub+{stub.id}@pawlaris.invalid"
        for password in ("", str(stub.id), stub.email, secrets.token_urlsafe(24)):
            assert not await verify_password(password, stub.password_hash)
    return stubs


async def assert_rs1(
    http: AsyncClient, incoming: list[Values], absent: dict[str, list[str]]
) -> None:
    page = await http.get("/api/v1/sync", params={"since": 0, "limit": 500})
    assert page.status_code == 200
    payload = page.json()
    assert payload["has_more"] is False
    visible = {(change["entity"], change["row"]["id"]) for change in payload["changes"]}
    for change in incoming:
        entity, row = str(change["entity"]), cast(Values, change["row"])
        key = "walk_id" if entity == "walk_routes" else "id"
        if row[key] in absent.get(entity, []):
            assert (entity, row[key]) not in visible
            continue
        # Q-28: routes are fetched separately; sync carries their owning walk.
        if entity == "walk_routes":
            assert ("walk_sessions", row[key]) in visible
            route = await http.get(f"/api/v1/walks/{row[key]}/route")
            assert route.status_code == 200
        else:
            assert (entity, row[key]) in visible, (entity, row[key])


@pytest.mark.parametrize(
    "vector", VECTORS, ids=[str(vector["name"]) for vector in VECTORS]
)
@pytest.mark.parametrize("way", ["once", "twice", "reverse", "singletons"])
async def test_rs1_rs2_rs3_rs4_rs5_rs10_vector(
    app: FastAPI,
    reseed_base: TestFamily,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    vector: Values,
    way: str,
) -> None:
    await seed_groups(app, reseed_base, cast(Groups, vector["server"]), frozen_clock)
    other = await make_family()
    await seed_groups(
        app, other, cast(Groups, vector.get("other_family", {})), frozen_clock
    )
    other_before = await stored_groups(app, other.id)
    before = await database_rows(app)
    rows = await incoming_rows(
        app, reseed_base, cast(list[Values], vector["incoming"]), frozen_clock
    )
    http = client_for(reseed_base.users[0])
    responses = []
    for batch in vector_batches(rows, way):
        response = await http.post("/api/v1/reseed", json={"rows": batch})
        assert response.status_code == 200, response.text
        responses.append(response)
        await assert_rs4(app, reseed_base)
        await assert_rs5(app, before)
    expected = cast(Values, vector["expect"])
    actual = await stored_groups(app, reseed_base.id)
    assert_partial_groups(actual, cast(Groups, expected.get("rows", {})), frozen_clock)
    absent = cast(dict[str, list[str]], expected.get("absent", {}))
    for entity, ids in absent.items():
        key = "walk_id" if entity == "walk_routes" else "id"
        assert not set(ids) & {row[key] for row in actual[entity]}
    assert await stored_groups(app, other.id) == other_before
    assert_partial_groups(
        other_before, cast(Groups, expected.get("other_family", {})), frozen_clock
    )
    stubs = await assert_rs5(app, before)
    if "stubs" in expected:
        assert {str(stub.id) for stub in stubs} == set(
            cast(list[str], expected["stubs"])
        )
    await assert_rs1(http, rows, absent)
    if way == "once":
        assert responses[0].json() == expected["result"]
    # RS-10: responses are counts only and disclose no refused row or id.
    for response in responses:
        assert set(response.json()) == {
            "inserted",
            "updated",
            "unchanged",
            "duplicates",
            "refused",
        }
        for ids in absent.values():
            assert all(id not in response.text for id in ids)


async def one_row(
    app: FastAPI,
    family: TestFamily,
    clock: FrozenClock,
    entity: str = "pets",
    **fields: object,
) -> Values:
    partial: Values = {
        "id": str(uuid4()),
        "updated_at": clock.now().isoformat(),
        **fields,
    }
    if entity == "family":
        partial["id"] = str(family.id)
    if entity == "walk_routes":
        partial = {"walk_id": str(uuid4()), "points": [[0, 0, 1, 5]], **fields}
    return (
        await incoming_rows(app, family, [{"entity": entity, "row": partial}], clock)
    )[0]


@pytest.mark.parametrize("entity", ENTITY_ORDER)
async def test_rs1_sync_from_zero_lists_accepted_incoming_row(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    entity: str,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock, entity)
    if entity == "walk_routes":
        walk_id = cast(Values, row["row"])["walk_id"]
        await seed_groups(
            app,
            reseed_base,
            {"walk_sessions": [{"id": walk_id, "status": "finished"}]},
            frozen_clock,
        )
    http = client_for(reseed_base.users[1])
    response = await http.post("/api/v1/reseed", json={"rows": [row]})
    assert response.status_code == 200, response.text
    assert response.json()["refused"] == 0
    await assert_rs1(http, [row], {})


@pytest.mark.parametrize(
    "entity,tombstone",
    [
        ("pets", "deleted_at"),
        ("task_completions", "undone_at"),
        ("task_timers", "cancelled_at"),
    ],
)
@pytest.mark.parametrize(
    "sequence", ["dead-then-live", "live-then-dead", "already-dead"]
)
async def test_rs3_two_reseeds_never_resurrect_a_tombstone(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    entity: str,
    tombstone: str,
    sequence: str,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock, entity)
    live = deepcopy(row)
    dead = deepcopy(row)
    instant = (frozen_clock.now() - timedelta(hours=2)).isoformat()
    cast(Values, dead["row"]).update({tombstone: instant, "updated_at": instant})
    if entity == "task_completions":
        cast(Values, dead["row"])["undone_by"] = str(reseed_base.users[1].id)
    batches = [dead, live] if sequence == "dead-then-live" else [live, dead]
    if sequence == "already-dead":
        await seed_groups(
            app, reseed_base, {entity: [cast(Values, dead["row"])]}, frozen_clock
        )
        batches = [live, live]
    http = client_for(reseed_base.users[0])
    for index, change in enumerate(batches):
        response = await http.post("/api/v1/reseed", json={"rows": [change]})
        assert response.status_code == 200, response.text
        if sequence != "live-then-dead" or index == 1:
            rows = (await stored_groups(app, reseed_base.id))[entity]
            saved = next(
                item for item in rows if item["id"] == cast(Values, row["row"])["id"]
            )
            assert normalized(saved[tombstone], frozen_clock) == normalized(
                instant, frozen_clock
            )
            if entity == "task_completions":
                assert saved["undone_by"] == str(reseed_base.users[1].id)


async def test_rs5_stub_is_member_and_cannot_log_in(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    before = await database_rows(app)
    row = await one_row(app, reseed_base, frozen_clock, "members", role="leader")
    http = client_for(reseed_base.users[0])
    response = await http.post("/api/v1/reseed", json={"rows": [row]})
    assert response.status_code == 200, response.text
    stubs = await assert_rs5(app, before)
    assert [str(stub.id) for stub in stubs] == [cast(Values, row["row"])["id"]]
    stub = stubs[0]
    for password in ("", str(stub.id), stub.email, secrets.token_urlsafe(24)):
        login = await http.post(
            "/api/v1/auth/login", json={"email": stub.email, "password": password}
        )
        assert login.status_code == 401
        assert "access_token" not in login.json()
        assert "refresh_token" not in login.json()
    after = await database_rows(app)
    for table in ACCOUNT_TABLES[1:]:
        assert after[table] == before[table]


@pytest.mark.parametrize("actor", [0, 1], ids=["leader", "member"])
@pytest.mark.parametrize("entity", ["pets", "family"])
async def test_rs10_other_family_id_is_refused_without_disclosure_or_write(
    app: FastAPI,
    reseed_base: TestFamily,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    actor: int,
    entity: str,
) -> None:
    other = await make_family()
    row = await one_row(
        app,
        reseed_base,
        frozen_clock,
        entity,
        id=str(other.pets[0].id),
        name="Attempted replacement",
        deleted_at=frozen_clock.now().isoformat(),
    )
    if entity == "family":
        cast(Values, row["row"]).update(id=str(other.id), timezone="Pacific/Auckland")
    before = await database_rows(app)
    response = await client_for(reseed_base.users[actor]).post(
        "/api/v1/reseed", json={"rows": [row]}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "duplicates": 0,
        "refused": 1,
    }
    assert await database_rows(app) == before
    for value in (
        str(other.id),
        str(other.pets[0].id),
        other.pets[0].name,
        other.family.name,
        other.family.timezone,
        "Attempted replacement",
        "Pacific/Auckland",
    ):
        assert value not in response.text


async def test_rs2_501_rows_are_422_and_write_nothing(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock)
    before = await database_rows(app)
    response = await client_for(reseed_base.users[0]).post(
        "/api/v1/reseed", json={"rows": [row] * 501}
    )
    assert response.status_code == 422
    assert await database_rows(app) == before


@pytest.mark.parametrize(
    "entity,field,invalid",
    [
        ("members", "display_name", "x" * 41),
        ("members", "color", "invalid"),
        ("family", "name", "x" * 61),
        ("pets", "name", "x" * 41),
        ("task_templates", "title", "x" * 81),
        ("weight_entries", "weight_kg", 120),
        ("health_events", "title", "x" * 81),
        ("task_completions", "occurrence_key", "invalid"),
        ("task_timers", "ends_at", "2026-09-14T10:30:00Z"),
        ("walk_sessions", "distance_m", -1),
        ("walk_routes", "points", [[0, 0, 1, 5]] * 5001),
    ],
    ids=["members", "members-color", *ENTITY_ORDER[1:]],
)
async def test_rs2_entity_bounds_reject_entire_batch_without_writes(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    entity: str,
    field: str,
    invalid: object,
) -> None:
    good = await one_row(app, reseed_base, frozen_clock)
    bad = await one_row(app, reseed_base, frozen_clock, entity)
    cast(Values, bad["row"])[field] = invalid
    before = await database_rows(app)
    response = await client_for(reseed_base.users[0]).post(
        "/api/v1/reseed", json={"rows": [good, bad]}
    )
    assert response.status_code == 422, response.text
    assert await database_rows(app) == before


@pytest.mark.parametrize(
    "entity", ["assets", "unknown", "app_user", "invites", "refresh_tokens"]
)
async def test_rs2_entities_outside_reseed_list_are_422(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    entity: str,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock)
    row["entity"] = entity
    before = await database_rows(app)
    response = await client_for(reseed_base.users[0]).post(
        "/api/v1/reseed", json={"rows": [row]}
    )
    assert response.status_code == 422
    assert await database_rows(app) == before


async def test_rs2_updated_at_one_hour_ahead_is_clamped_to_five_minutes(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    row = await one_row(
        app,
        reseed_base,
        frozen_clock,
        updated_at=(frozen_clock.now() + timedelta(hours=1)).isoformat(),
    )
    response = await client_for(reseed_base.users[0]).post(
        "/api/v1/reseed", json={"rows": [row]}
    )
    assert response.status_code == 200, response.text
    saved = (await stored_groups(app, reseed_base.id))["pets"]
    pet = next(item for item in saved if item["id"] == cast(Values, row["row"])["id"])
    assert normalized(
        pet["updated_at"], frozen_clock
    ) == frozen_clock.now() + timedelta(minutes=5)


class RecordingHub(Hub):
    def __init__(self, app: FastAPI, clock: FrozenClock) -> None:
        super().__init__(clock)
        self.app = app
        self.calls: list[tuple[UUID, int, Groups]] = []

    async def poke(self, family_id: UUID, revision: int) -> None:
        # A second connection observes the rows only after the write commits.
        self.calls.append(
            (family_id, revision, await stored_groups(self.app, family_id))
        )


@pytest.mark.parametrize("operation", ["insert", "update"])
async def test_rs2_changes_poke_once_after_commit_and_retry_changes_no_revision(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    operation: str,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock)
    if operation == "update":
        await seed_groups(
            app,
            reseed_base,
            {
                "pets": [
                    {
                        **cast(Values, row["row"]),
                        "name": "Before",
                        "updated_at": (
                            frozen_clock.now() - timedelta(hours=1)
                        ).isoformat(),
                    }
                ]
            },
            frozen_clock,
        )
    hub = RecordingHub(app, frozen_clock)
    app.state.hub = hub
    http = client_for(reseed_base.users[0])
    response = await http.post("/api/v1/reseed", json={"rows": [row]})
    assert response.status_code == 200, response.text
    assert response.json()["inserted" if operation == "insert" else "updated"] == 1
    assert len(hub.calls) == 1
    family_id, revision, observed = hub.calls[0]
    assert family_id == reseed_base.id
    saved = next(
        item
        for item in observed["pets"]
        if item["id"] == cast(Values, row["row"])["id"]
    )
    assert saved["name"] == cast(Values, row["row"])["name"]
    assert saved["revision"] == revision
    before = await database_rows(app)
    replay = await http.post("/api/v1/reseed", json={"rows": [row]})
    assert replay.status_code == 200, replay.text
    assert replay.json() == {
        "inserted": 0,
        "updated": 0,
        "unchanged": 1,
        "duplicates": 0,
        "refused": 0,
    }
    assert len(hub.calls) == 1
    assert await database_rows(app) == before


@pytest.mark.parametrize("kind", ["empty", "equal", "older", "refused"])
async def test_rs2_no_change_gets_no_revision_and_pokes_nobody(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    kind: str,
) -> None:
    pet = (await stored_groups(app, reseed_base.id))["pets"][0]
    rows: list[Values] = [{"entity": "pets", "row": pet}]
    if kind == "empty":
        rows = []
    elif kind == "older":
        pet["updated_at"] = (frozen_clock.now() - timedelta(days=30)).isoformat()
        pet["name"] = "Old name"
    elif kind == "refused":
        rows = [
            await one_row(
                app, reseed_base, frozen_clock, "task_completions", task_id=str(uuid4())
            )
        ]
    hub = RecordingHub(app, frozen_clock)
    app.state.hub = hub
    before = await database_rows(app)
    response = await client_for(reseed_base.users[0]).post(
        "/api/v1/reseed", json={"rows": rows}
    )
    assert response.status_code == 200, response.text
    assert response.json()["inserted"] == response.json()["updated"] == 0
    assert hub.calls == []
    assert await database_rows(app) == before


class CommittedDuplicateSender(FakeSender):
    def __init__(self, app: FastAPI, family_id: UUID) -> None:
        super().__init__(app)
        self.family_id = family_id
        self.committed: list[dict[UUID, UUID | None]] = []

    async def send(self, messages: Sequence[PushMessage]) -> None:
        async with self.app.state.session_factory() as session:
            self.committed.append(
                {
                    row.id: row.duplicate_of
                    for row in await session.scalars(
                        select(TaskCompletion).where(
                            TaskCompletion.family_id == self.family_id
                        )
                    )
                }
            )
        await super().send(messages)


@pytest.mark.parametrize(
    "name,same_author,disabled_author",
    [
        ("duplicate-completion-the-earlier-stays", False, None),
        ("duplicate-completion-the-incoming-is-earlier", False, None),
        ("three-completions-one-live", False, None),
        pytest.param(
            "duplicate-completion-the-earlier-stays",
            True,
            None,
            id="same-author-no-push",
        ),
        pytest.param(
            "duplicate-completion-the-earlier-stays",
            False,
            0,
            id="disabled-winner-no-push",
        ),
        pytest.param(
            "duplicate-completion-the-earlier-stays",
            False,
            1,
            id="disabled-loser-no-push",
        ),
    ],
)
async def test_rs4_duplicate_push_names_other_author_after_commit_once_per_loser(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    name: str,
    same_author: bool,
    disabled_author: int | None,
) -> None:
    vector = deepcopy(next(item for item in VECTORS if item["name"] == name))
    if same_author:
        for row in cast(Groups, vector["server"]).get("task_completions", []):
            row["completed_by"] = str(reseed_base.users[0].id)
        for change in cast(list[Values], vector["incoming"]):
            cast(Values, change["row"])["completed_by"] = str(reseed_base.users[0].id)
    await seed_groups(app, reseed_base, cast(Groups, vector["server"]), frozen_clock)
    third_id = uuid4()
    await seed_groups(
        app,
        reseed_base,
        {
            "members": [
                {"id": str(third_id), "display_name": "Third member", "role": "member"}
            ]
        },
        frozen_clock,
    )
    async with app.state.session_factory() as session:
        users = list(
            await session.scalars(
                select(AppUser).where(AppUser.family_id == reseed_base.id)
            )
        )
    devices = [
        (user, secrets.token_urlsafe(24)) for user in [*users, reseed_base.users[0]]
    ]
    await seed_devices(app, devices)
    if disabled_author is not None:
        async with app.state.session_factory() as session:
            await session.execute(
                update(AppUser)
                .where(AppUser.id == reseed_base.users[disabled_author].id)
                .values(disabled_at=frozen_clock.now())
            )
            await session.commit()
    sender = CommittedDuplicateSender(app, reseed_base.id)
    app.state.push_sender = sender
    app.state.settings.push_enabled = True
    rows = await incoming_rows(
        app, reseed_base, cast(list[Values], vector["incoming"]), frozen_clock
    )
    http = client_for(reseed_base.users[1 if disabled_author == 0 else 0])
    try:
        response = await http.post("/api/v1/reseed", json={"rows": rows})
        assert response.status_code == 200, response.text
        await drain_pushes(app)
        expected = cast(Groups, cast(Values, vector["expect"])["rows"])[
            "task_completions"
        ]
        duplicates = {
            UUID(str(row["id"])): UUID(str(row["duplicate_of"]))
            for row in expected
            if row.get("duplicate_of") is not None
        }
        assert response.json()["duplicates"] == len(duplicates)
        targets: dict[UUID, list[str]] = defaultdict(list)
        # Include every stored device, including the base's second-member device.
        async with app.state.session_factory() as session:
            for device in await session.scalars(
                select(PushDevice).where(
                    PushDevice.user_id.in_([user.id for user in users])
                )
            ):
                targets[device.user_id].append(device.token)
            completions = {
                row.id: row
                for row in await session.scalars(
                    select(TaskCompletion).where(
                        TaskCompletion.family_id == reseed_base.id
                    )
                )
            }
        if same_author:
            assert {row.completed_by for row in completions.values()} == {
                reseed_base.users[0].id
            }
        names = {user.id: user.display_name for user in users}
        expected_messages: list[PushMessage] = []
        for loser, winner in duplicates.items():
            winner_author = completions[winner].completed_by
            loser_author = completions[loser].completed_by
            if winner_author == loser_author:
                continue
            for recipient, other_author in (
                (winner_author, loser_author),
                (loser_author, winner_author),
            ):
                if (
                    disabled_author is not None
                    and recipient == reseed_base.users[disabled_author].id
                ):
                    continue
                expected_messages.extend(
                    completion_duplicate_message(
                        token, names[other_author], completions[winner]
                    )
                    for token in targets[recipient]
                )
        actual = Counter(
            (str(message["to"]), str(cast(Values, message["data"])["completion_id"]))
            for message in sender.messages
        )
        assert actual == Counter(
            (str(message["to"]), str(cast(Values, message["data"])["completion_id"]))
            for message in expected_messages
        )
        assert_messages(sender.messages, expected_messages)
        if disabled_author is not None:
            disabled_tokens = set(targets[reseed_base.users[disabled_author].id])
            assert disabled_tokens
            assert sender.messages
            assert (
                not {str(message["to"]) for message in sender.messages}
                & disabled_tokens
            )
        assert not {str(message["to"]) for message in sender.messages} & set(
            targets[third_id]
        )
        if same_author:
            assert sender.messages == []
        for message in sender.messages:
            data = cast(Values, message["data"])
            assert data["type"] == "completion_duplicate"
            assert data["task_id"] == cast(Values, rows[0]["row"])["task_id"]
            assert (
                data["occurrence_key"] == cast(Values, rows[0]["row"])["occurrence_key"]
            )
            assert data["pet_id"] == cast(Values, rows[0]["row"])["pet_id"]
            assert "silent" not in data
            assert message["channelId"] == "family-activity"
            assert message["priority"] == "high"
        if expected_messages:
            assert sender.committed
        for visible in sender.committed:
            assert all(
                visible.get(loser) == winner for loser, winner in duplicates.items()
            )
        count = len(sender.messages)
        replay = await http.post("/api/v1/reseed", json={"rows": rows})
        assert replay.status_code == 200, replay.text
        await drain_pushes(app)
        assert replay.json()["duplicates"] == 0
        assert len(sender.messages) == count
    finally:
        await drain_pushes(app)


async def test_rb3_rs5_actor_removed_while_waiting_for_family_lock_is_401(
    app: FastAPI,
    reseed_base: TestFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    row = await one_row(app, reseed_base, frozen_clock)
    actor = reseed_base.users[1]
    async with app.state.session_factory() as blocker:
        await lock_family(blocker, reseed_base.id)
        blocker_pid = await blocker.scalar(text("SELECT pg_backend_pid()"))
        pending = asyncio.create_task(
            client_for(actor).post("/api/v1/reseed", json={"rows": [row]})
        )
        try:

            async def wait_until_blocked() -> bool:
                # Observe the real PostgreSQL wait, without replacing the service
                # or its lock. The unfinished stub instead returns 500 promptly.
                while not pending.done():  # noqa: ASYNC110
                    await blocker.execute(text("SELECT pg_stat_clear_snapshot()"))
                    waiting = await blocker.scalar(
                        text(
                            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity "
                            "WHERE :pid = ANY(pg_blocking_pids(pid)))"
                        ),
                        {"pid": blocker_pid},
                    )
                    if waiting:
                        return True
                    await asyncio.sleep(0.01)
                return False

            blocked = await asyncio.wait_for(wait_until_blocked(), timeout=5)
            if not blocked:
                response = await pending
                assert response.status_code == 401, response.text
                pytest.fail("RB-3: the call must wait for the family lock")
            await blocker.execute(
                update(AppUser)
                .where(AppUser.id == actor.id)
                .values(disabled_at=frozen_clock.now())
            )
            # Capture all tables on the same connection before releasing the lock.
            before = {}
            for table in Base.metadata.sorted_tables:
                before[table.name] = [
                    dict(item)
                    for item in (
                        await blocker.execute(
                            select(table).order_by(*table.primary_key.columns)
                        )
                    ).mappings()
                ]
            await blocker.commit()
            response = await asyncio.wait_for(pending, timeout=10)
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    assert response.status_code == 401, response.text
    after = await database_rows(app)
    assert {table: after[table] for table in before} == before
