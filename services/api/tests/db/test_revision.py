from datetime import datetime
from typing import cast

import pytest
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import Base
from tests.factories import MakeFamily

SYNCABLE = (
    "family",
    "app_user",
    "pet",
    "weight_entry",
    "health_event",
    "task_template",
    "task_completion",
    "task_timer",
    "walk_session",
    "asset",
)


@pytest.mark.parametrize("table_name", SYNCABLE)
async def test_sy1_sql_insert_and_update_advance_revision(
    make_family: MakeFamily, table_name: str
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            values = await fam.row_values(session, table_name)
            await session.commit()
        table = Base.metadata.tables[table_name]
        family_id = values["id"] if table_name == "family" else fam.id
        async with engine.begin() as connection:
            before = (
                await connection.execute(
                    text("SELECT value FROM family_revision WHERE family_id = :id"),
                    {"id": family_id},
                )
            ).scalar_one_or_none() or 0
            row = (
                await connection.execute(
                    table.insert()
                    .values(**values)
                    .returning(table.c.id, table.c.revision, table.c.updated_at)
                )
            ).one()
            assert row.revision == before + 1
            assert row.updated_at.tzinfo is not None
            updated = (
                await connection.execute(
                    table.update()
                    .where(table.c.id == row.id)
                    .values(id=row.id)
                    .returning(table.c.revision)
                )
            ).scalar_one()
            assert updated == before + 2
    finally:
        await engine.dispose()


@pytest.mark.parametrize("table_name", SYNCABLE)
async def test_sy1_orm_fetches_generated_values_on_insert_and_update(
    make_family: MakeFamily, table_name: str
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            values = await fam.row_values(session, table_name)
            mapper = next(
                m for m in Base.registry.mappers if m.local_table.name == table_name
            )
            row = mapper.class_(**values)
            session.add(row)
            await session.flush()
            assert not {"revision", "updated_at"} & inspect(row).unloaded
            before = cast(int, row.revision)
            assert isinstance(row.updated_at, datetime)
            # Force a real UPDATE without assigning either generated column.
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(
                row, "name" if table_name in ("family", "pet") else "family_id"
            )
            await session.flush()
            assert not {"revision", "updated_at"} & inspect(row).unloaded
            assert row.revision == before + 1
    finally:
        await engine.dispose()


@pytest.mark.parametrize("table_name", SYNCABLE)
async def test_sy3_hard_delete_is_forbidden(
    make_family: MakeFamily, table_name: str
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine) as session:
            rows = await fam.make_rows(session)
            row_id = rows[table_name].id
            await session.commit()
            table = Base.metadata.tables[table_name]
            with pytest.raises(DBAPIError, match="hard delete forbidden"):
                await session.execute(table.delete().where(table.c.id == row_id))
            await session.rollback()
            assert (
                await session.execute(select(table.c.id).where(table.c.id == row_id))
            ).scalar_one() == row_id
    finally:
        await engine.dispose()


async def test_sy1_family_counters_are_independent(make_family: MakeFamily) -> None:
    first, second = await make_family(), await make_family()
    engine = create_async_engine(first.database_url)
    try:
        async with engine.begin() as connection:
            query = text("SELECT value FROM family_revision WHERE family_id = :id")
            before = (await connection.execute(query, {"id": second.id})).scalar_one()
            await connection.execute(
                text("UPDATE family SET name = name WHERE id = :id"), {"id": first.id}
            )
            assert (
                await connection.execute(query, {"id": second.id})
            ).scalar_one() == before
    finally:
        await engine.dispose()
