"""Reseed foundations: local timestamp preservation and duplicate metadata."""

from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi import FastAPI
from sqlalchemy import inspect, text

from app.clock import FrozenClock
from app.models import Base
from app.settings import Settings
from tests.conftest import ClientFor
from tests.factories import MakeFamily
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
