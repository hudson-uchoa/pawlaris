from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import Base, ServerMeta
from tests.factories import INSTANT, MakeFamily


@pytest.mark.parametrize("per_pet", [False, True], ids=["NULL", "pet"])
async def test_cp1_cp4_live_unique_index_and_undo(
    make_family: MakeFamily, per_pet: bool
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    table = Base.metadata.tables["task_completion"]
    try:
        async with AsyncSession(engine) as session:
            values = await fam.row_values(session, "task_completion")
            values["pet_id"] = fam.pets[0].id if per_pet else None
            await session.execute(table.insert().values(**values))
            await session.commit()
            retry = {**values, "id": uuid4()}
            with pytest.raises(IntegrityError, match="task_completion_live"):
                await session.execute(table.insert().values(**retry))
            await session.rollback()
            await session.execute(
                table.update()
                .where(table.c.id == values["id"])
                .values(undone_at=INSTANT, undone_by=fam.users[0].id)
            )
            await session.execute(table.insert().values(**retry))
            await session.commit()
            rows = (
                (
                    await session.execute(
                        select(table.c.undone_at).where(
                            table.c.task_id == values["task_id"]
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert len(rows) == 2
            assert rows.count(None) == 1
    finally:
        await engine.dispose()


async def test_r3_1_empty_pet_ids_are_rejected(make_family: MakeFamily) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine) as session:
            values = await fam.row_values(session, "task_template")
            values["pet_ids"] = []
            with pytest.raises(IntegrityError, match="check"):
                await session.execute(
                    Base.metadata.tables["task_template"].insert().values(**values)
                )
    finally:
        await engine.dispose()


@pytest.mark.parametrize("table_name", ["task_completion", "task_timer"])
@pytest.mark.parametrize(
    "key",
    [
        "2026-09-14",
        "2026-09-14T08:00",
        "2026-9-14",
        "2026-09-14T8:00",
        "2026-09-14T08:00Z",
        "2026-09-14\n",
        "",
    ],
)
async def test_r3_14_occurrence_key_format(
    make_family: MakeFamily, table_name: str, key: str
) -> None:
    fam = await make_family()
    engine = create_async_engine(fam.database_url)
    try:
        async with AsyncSession(engine) as session:
            values = await fam.row_values(session, table_name)
            values["occurrence_key"] = key
            statement = Base.metadata.tables[table_name].insert().values(**values)
            if key in ("2026-09-14", "2026-09-14T08:00"):
                await session.execute(statement)
                await session.commit()
            else:
                with pytest.raises(IntegrityError, match="check"):
                    await session.execute(statement)
    finally:
        await engine.dispose()


@pytest.mark.parametrize("singleton_id", [True, False])
async def test_server_meta_rejects_a_second_row(
    database_url: str, singleton_id: bool
) -> None:
    engine = create_async_engine(database_url)
    try:
        async with AsyncSession(engine) as session:
            assert (
                await session.execute(select(ServerMeta))
            ).scalar_one().sync_epoch.version == 4
            with pytest.raises(IntegrityError):
                await session.execute(
                    ServerMeta.__table__.insert().values(
                        id=singleton_id, sync_epoch=uuid4()
                    )
                )
    finally:
        await engine.dispose()
