from collections.abc import AsyncIterator
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, event, select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.clock import FrozenClock
from app.idempotency import ENTITY_REGISTRY
from app.models import (
    Base,
    FamilyRevision,
    Pet,
    ServerMeta,
    TaskCompletion,
    TaskTemplate,
    TaskTimer,
)
from app.schemas.sync import SyncPage, SyncResponse
from app.services.sync import collect_changes
from tests.conftest import ClientFor
from tests.factories import INSTANT, MakeFamily, TestFamily


@pytest.fixture
async def session(database_url: str) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(database_url)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as database:
            yield database
    finally:
        await engine.dispose()


async def revision(session: AsyncSession, family: TestFamily) -> int:
    value = await session.scalar(
        select(FamilyRevision.value).where(FamilyRevision.family_id == family.id)
    )
    assert value is not None
    return value


async def snapshot_rows(session: AsyncSession, family: TestFamily) -> dict[str, Base]:
    rows = await family.make_rows(session)
    completion, timer = rows["task_completion"], rows["task_timer"]
    assert isinstance(completion, TaskCompletion)
    assert isinstance(timer, TaskTimer)
    # The completion and timer factories each persist their own template.
    templates = (
        await session.scalars(
            select(TaskTemplate).where(
                TaskTemplate.id.in_([completion.task_id, timer.task_id])
            )
        )
    ).all()
    assert len(templates) == 2
    rows.update({str(template.id): template for template in templates})
    return rows


async def pull(
    client: AsyncClient, *, since: int = 0, limit: int | None = None
) -> SyncResponse:
    params = {"since": since}
    if limit is not None:
        params["limit"] = limit
    response = await client.get("/api/v1/sync", params=params)
    assert response.status_code == 200, response.text
    return SyncResponse.model_validate(response.json())


async def test_sy2_exactly_five_changed_entities_in_revision_order(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family()
    rows = await family.make_rows(session)
    await session.commit()
    before = await revision(session, family)
    changed = ["asset", "family", "task_template", "pet", "app_user"]
    for table in changed:
        row = rows[table]
        await session.execute(
            row.__table__.update().where(row.__table__.c.id == row.id).values(id=row.id)
        )
    await session.commit()
    page = await pull(client_for(family.users[0]), since=before)
    assert [change.entity for change in page.changes] == [
        "assets",
        "family",
        "task_templates",
        "pets",
        "members",
    ]
    assert [change.row.id for change in page.changes] == [rows[t].id for t in changed]
    assert [change.row.revision for change in page.changes] == sorted(
        change.row.revision for change in page.changes
    )
    assert not page.has_more
    assert page.revision == await revision(session, family)


async def test_sy4_twelve_rows_paginate_five_five_two_without_loss(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family(pets=12)
    before = min(pet.revision for pet in family.pets) - 1
    client = client_for(family.users[0])
    cursor = before
    pages: list[SyncResponse] = []
    for _ in range(3):
        page = await pull(client, since=cursor, limit=5)
        assert page.revision > cursor
        pages.append(page)
        cursor = page.revision
    assert [len(page.changes) for page in pages] == [5, 5, 2]
    assert [page.has_more for page in pages] == [True, True, False]
    ids = [change.row.id for page in pages for change in page.changes]
    assert len(ids) == len(set(ids)) == 12
    assert set(ids) == {pet.id for pet in family.pets}
    assert cursor == await revision(session, family)


@pytest.mark.parametrize("row_count", [5, 6])
async def test_sy4_exact_limit_is_final_and_one_extra_requires_another_page(
    make_family: MakeFamily,
    client_for: ClientFor,
    session: AsyncSession,
    row_count: int,
) -> None:
    family = await make_family(pets=row_count)
    before = min(pet.revision for pet in family.pets) - 1
    page = await pull(client_for(family.users[0]), since=before, limit=5)
    expected = sorted(family.pets, key=lambda pet: pet.revision)[:5]
    assert [change.row.id for change in page.changes] == [pet.id for pet in expected]
    assert page.has_more is (row_count > 5)
    if row_count == 5:
        assert page.revision == await revision(session, family)
    else:
        assert page.revision == expected[-1].revision
        assert page.revision < await revision(session, family)


@pytest.mark.parametrize("since", [0, 2, 10000])
async def test_sy5_other_family_never_appears(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession, since: int
) -> None:
    family, other = await make_family(), await make_family()
    own_rows = await snapshot_rows(session, family)
    other_rows = await snapshot_rows(session, other)
    await session.commit()
    own_ids = {row.id for row in own_rows.values()} | {u.id for u in family.users}
    other_ids = {row.id for row in other_rows.values()} | {u.id for u in other.users}
    for actor in family.users:
        page = await pull(client_for(actor), since=since)
        ids = {change.row.id for change in page.changes}
        assert ids <= own_ids
        assert ids.isdisjoint(other_ids)
        assert ids == {
            row.id
            for row in [*own_rows.values(), *family.users]
            if row.revision > since
        }


async def test_sy6_explicit_upper_bound_defers_newer_rows(
    make_family: MakeFamily, session: AsyncSession
) -> None:
    family = await make_family()
    hi = await revision(session, family)
    await session.execute(
        update(Pet).where(Pet.id == family.pets[0].id).values(name="Changed after hi")
    )
    await session.commit()
    bounded = await collect_changes(session, family.id, 0, 1000, hi)
    assert family.pets[0].id not in {change.row.id for change in bounded.changes}
    assert all(change.row.revision <= hi for change in bounded.changes)
    assert bounded.revision == hi
    assert not bounded.has_more
    real_hi = await revision(session, family)
    following = await collect_changes(
        session, family.id, bounded.revision, 1000, real_hi
    )
    assert [(change.entity, change.row.id) for change in following.changes] == [
        ("pets", family.pets[0].id)
    ]
    assert following.revision == real_hi


async def test_sy6_router_reads_hi_before_collecting_entities(
    make_family: MakeFamily,
    client_for: ClientFor,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routers import sync

    family = await make_family()
    before = await revision(session, family)
    observed: list[int] = []

    async def collect_after_commit(
        database: AsyncSession, family_id: UUID, since: int, limit: int, hi: int
    ) -> SyncPage:
        observed.append(hi)
        await session.execute(
            update(Pet).where(Pet.id == family.pets[0].id).values(name="Later commit")
        )
        await session.commit()
        return await collect_changes(database, family_id, since, limit, hi)

    monkeypatch.setattr(sync, "collect_changes", collect_after_commit, raising=False)
    page = await pull(client_for(family.users[0]), since=before)
    assert observed == [before]
    assert page.changes == []
    assert page.revision == before
    assert not page.has_more
    monkeypatch.setattr(sync, "collect_changes", collect_changes)
    following = await pull(client_for(family.users[0]), since=page.revision)
    assert [change.row.id for change in following.changes] == [family.pets[0].id]


async def test_sy_snapshot_includes_all_ten_entities_and_exact_row_shapes(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family()
    rows = await snapshot_rows(session, family)
    await session.commit()
    page = await pull(client_for(family.users[0]))
    assert {change.entity for change in page.changes} == set(ENTITY_REGISTRY)
    expected = {
        (entity, row.id): entry.schema.model_validate(row).model_dump(mode="json")
        for entity, entry in ENTITY_REGISTRY.items()
        for row in rows.values()
        if isinstance(row, entry.model)
    }
    member_schema = ENTITY_REGISTRY["members"].schema
    expected.update(
        {
            ("members", user.id): member_schema.model_validate(user).model_dump(
                mode="json"
            )
            for user in family.users
        }
    )
    actual = {
        (change.entity, change.row.id): change.row.model_dump(mode="json")
        for change in page.changes
    }
    assert actual == expected
    assert not page.has_more
    assert page.revision == await revision(session, family)


async def test_sy_soft_deleted_row_is_included_with_tombstone(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family()
    before = await revision(session, family)
    await session.execute(
        update(Pet).where(Pet.id == family.pets[0].id).values(deleted_at=INSTANT)
    )
    await session.commit()
    page = await pull(client_for(family.users[0]), since=before)
    assert len(page.changes) == 1
    change = page.changes[0]
    assert change.entity == "pets"
    assert change.row.deleted_at == INSTANT


async def test_sy_final_empty_page_returns_family_revision_and_frozen_server_time(
    make_family: MakeFamily,
    client_for: ClientFor,
    session: AsyncSession,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    hi = await revision(session, family)
    frozen_clock.advance(timedelta(seconds=37))
    page = await pull(client_for(family.users[0]), since=hi)
    assert page.changes == []
    assert not page.has_more
    assert page.revision == hi
    assert page.server_time == frozen_clock.now()


async def test_sy_epoch_is_stored_value_and_changes_after_restore(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family()
    client = client_for(family.users[0])
    old_epoch = await session.scalar(select(ServerMeta.sync_epoch))
    first = await pull(client)
    assert first.epoch == old_epoch
    replacement = uuid4()
    try:
        await session.execute(update(ServerMeta).values(sync_epoch=replacement))
        await session.commit()
        second = await pull(client, since=first.revision)
        assert second.epoch == replacement
        assert second.epoch != first.epoch
    finally:
        await session.execute(update(ServerMeta).values(sync_epoch=old_epoch))
        await session.commit()


async def test_sy4_default_limit_is_500_and_maximum_is_1000(
    make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family(pets=1001)
    client = client_for(family.users[0])
    default = await pull(client)
    maximum = await pull(client, limit=1000)
    assert len(default.changes) == 500
    assert len(maximum.changes) == 1000
    assert default.has_more and maximum.has_more
    assert default.revision == default.changes[-1].row.revision
    assert maximum.revision == maximum.changes[-1].row.revision


@pytest.mark.parametrize(
    "params",
    [
        {"since": "0", "limit": "0"},
        {"since": "0", "limit": "1001"},
        {"since": "0", "limit": "invalid"},
        {"since": "-1"},
        {"since": "invalid"},
        {},
    ],
)
async def test_sy_invalid_query_returns_422(
    make_family: MakeFamily, client_for: ClientFor, params: dict[str, str]
) -> None:
    family = await make_family()
    response = await client_for(family.users[0]).get("/api/v1/sync", params=params)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_sy_read_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/api/v1/sync?since=0")
    assert response.status_code == 401
    assert response.json()["code"] == "token_invalid"


async def test_sy6_missing_family_counter_returns_zero(session: AsyncSession) -> None:
    page = await collect_changes(session, uuid4(), 0, 5, 0)
    assert page.changes == []
    assert page.revision == 0
    assert not page.has_more


async def test_sy6_router_uses_zero_when_family_counter_is_missing(
    make_family: MakeFamily, client_for: ClientFor, session: AsyncSession
) -> None:
    family = await make_family()
    await session.execute(
        delete(FamilyRevision).where(FamilyRevision.family_id == family.id)
    )
    await session.commit()
    page = await pull(client_for(family.users[0]))
    assert page.revision == 0
    assert page.changes == []
    assert not page.has_more


async def test_sy4_each_entity_query_is_bounded_before_global_merge(
    make_family: MakeFamily, session: AsyncSession
) -> None:
    family = await make_family(pets=12)
    await family.make_rows(session)
    await session.commit()
    hi = await revision(session, family)
    statements: list[str] = []

    def observe(sql: str, parameters: object) -> None:
        statements.append(sql)

    event.listen(
        session.bind.sync_engine,
        "before_cursor_execute",
        lambda conn, cursor, sql, params, context, many: observe(sql, params),
    )
    page = await collect_changes(session, family.id, 0, 5, hi)
    assert len(page.changes) == 5
    assert page.has_more
    assert page.revision == page.changes[-1].row.revision
    assert len(statements) == 10
    for sql in statements:
        assert "LIMIT" in sql and "ORDER BY" in sql
        assert "revision >" in sql and "revision <=" in sql
