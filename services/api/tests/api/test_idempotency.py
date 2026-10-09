import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError

from app.errors import ApiError
from app.idempotency import ENTITY_REGISTRY, IdempotentMutation, SyncModel
from app.locks import lock_family
from app.models import AppliedMutation, Family, FamilyRevision, Pet
from app.schemas.rows import Row
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily
from tests.security.matrix import IDEMPOTENT_ROUTES, PERMISSION_MATRIX, MatrixRequest

type Idem = Callable[[], dict[str, str]]


async def revision(app: FastAPI, family_id: UUID) -> int:
    async with app.state.session_factory() as session:
        return (
            await session.execute(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family_id
                )
            )
        ).scalar_one()


async def route_request(family: TestFamily, route: tuple[str, str]) -> MatrixRequest:
    if route == ("POST", "/probe/pet"):
        return MatrixRequest("/probe/pet", {"id": str(uuid4()), "name": "Probe pet"})
    case = next(
        case for case in PERMISSION_MATRIX if (case.method, case.template) == route
    )
    return await case.request(family, family.users[0])


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
async def test_id2_replay_preserves_row_and_family_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str],
) -> None:
    family = await make_family()
    client, headers = client_for(family.users[0]), idem()
    request = await route_request(family, route)
    first = await client.request(
        route[0], request.url, json=request.json, headers=headers
    )
    assert first.status_code == 200
    before = await revision(app, family.id)
    changed = dict(request.json) if request.json is not None else None
    if changed is not None:
        if "name" in changed:
            changed["name"] = "Changed intent"
        if "role" in changed:
            changed["role"] = "member"
    second = await client.request(route[0], request.url, json=changed, headers=headers)
    assert second.status_code == 200 and second.json() == first.json()
    assert await revision(app, family.id) == before
    async with app.state.session_factory() as session:
        stored = await session.get(AppliedMutation, UUID(headers["Idempotency-Key"]))
        assert stored is not None
        assert stored.entity_id == UUID(first.json()["id"])
        assert stored.family_id == family.id and stored.user_id == family.users[0].id
        assert stored.entity == IDEMPOTENT_ROUTES[route]


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
async def test_id2_concurrent_duplicate_has_one_write(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str],
) -> None:
    family = await make_family()
    client, headers = client_for(family.users[0]), idem()
    requests = [await route_request(family, route) for _ in range(2)]
    if route == ("POST", "/probe/pet"):
        for request, name in zip(requests, ("First pet", "Second pet"), strict=True):
            assert request.json is not None
            request.json["name"] = name
    before = await revision(app, family.id)
    responses = await asyncio.wait_for(
        asyncio.gather(
            *[
                client.request(
                    route[0], request.url, json=request.json, headers=headers
                )
                for request in requests
            ]
        ),
        timeout=10,
    )
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert await revision(app, family.id) == before + 1
    async with app.state.session_factory() as session:
        assert (
            await session.scalar(
                select(func.count())
                .select_from(AppliedMutation)
                .where(
                    AppliedMutation.client_mutation_id
                    == UUID(headers["Idempotency-Key"])
                )
            )
            == 1
        )
        if route == ("POST", "/probe/pet"):
            ids = [
                UUID(str(request.json["id"]))
                for request in requests
                if request.json is not None
            ]
            assert UUID(responses[0].json()["id"]) in ids
            assert (
                await session.scalar(
                    select(func.count()).select_from(Pet).where(Pet.id.in_(ids))
                )
                == 1
            )


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
async def test_id3_cross_family_replay_reveals_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str],
) -> None:
    first, second = await make_family(), await make_family()
    headers = idem()
    request = await route_request(first, route)
    original = await client_for(first.users[0]).request(
        route[0], request.url, json=request.json, headers=headers
    )
    assert original.status_code == 200
    before = await revision(app, second.id)
    request = await route_request(second, route)
    response = await client_for(second.users[0]).request(
        route[0], request.url, json=request.json, headers=headers
    )
    assert (
        response.status_code == 422
        and response.json()["code"] == "idempotency_key_reused"
    )
    assert original.json()["id"] not in response.text
    if "name" in original.json():
        assert original.json()["name"] not in response.text
    assert await revision(app, second.id) == before


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
async def test_id3_cross_entity_replay_reveals_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str],
) -> None:
    family = await make_family()
    headers = idem()
    async with app.state.session_factory() as session:
        session.add(
            AppliedMutation(
                client_mutation_id=UUID(headers["Idempotency-Key"]),
                family_id=family.id,
                user_id=family.users[0].id,
                entity="weight_entries",
                entity_id=uuid4(),
            )
        )
        await session.commit()
    before = await revision(app, family.id)
    request = await route_request(family, route)
    response = await client_for(family.users[0]).request(
        route[0], request.url, json=request.json, headers=headers
    )
    assert (
        response.status_code == 422
        and response.json()["code"] == "idempotency_key_reused"
    )
    assert await revision(app, family.id) == before


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
@pytest.mark.parametrize(
    "key", [None, "malformed", "", str(uuid1()), str(uuid4()).upper()]
)
async def test_id2_missing_or_malformed_key_is_400_without_write(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    route: tuple[str, str],
    key: str | None,
) -> None:
    family = await make_family()
    before = await revision(app, family.id)
    request = await route_request(family, route)
    response = await client_for(family.users[0]).request(
        route[0],
        request.url,
        json=request.json,
        headers={} if key is None else {"Idempotency-Key": key},
    )
    assert (
        response.status_code == 400
        and response.json()["code"] == "idempotency_key_required"
    )
    assert await revision(app, family.id) == before


@pytest.mark.parametrize("route", IDEMPOTENT_ROUTES)
@pytest.mark.parametrize("fault,status", [("fail_handler", 409), ("fail_commit", 500)])
async def test_id2_failure_rolls_back_key_row_revision_and_callbacks(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str],
    fault: str,
    status: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    headers = idem()
    request = await route_request(family, route)
    before = await revision(app, family.id)
    original = IdempotentMutation.__call__
    entry = ENTITY_REGISTRY[IDEMPOTENT_ROUTES[route]]
    row_id = family.id if entry.model is Family else family.users[1].id
    if entry.model is Pet:
        assert request.json is not None
        row_id = UUID(str(request.json["id"]))
    async with app.state.session_factory() as session:
        row = await session.get(entry.model, row_id)
        previous = (
            None
            if row is None
            else entry.schema.model_validate(row).model_dump(mode="json")
        )

    async def fault_call(
        mutation: IdempotentMutation, handler: Callable[[], Awaitable[SyncModel]]
    ) -> Row:
        async def faulty() -> SyncModel:
            row = await handler()
            if fault == "fail_handler":
                raise ApiError(409, "last_leader", "Injected handler failure.")
            marker = uuid4().hex
            for _ in range(2):
                await mutation.session.execute(
                    text("INSERT INTO probe_commit (id, marker) VALUES (:id, :marker)"),
                    {"id": uuid4(), "marker": marker},
                )
            return row

        return await original(mutation, faulty)

    failed_body = request.json
    if entry.model is Pet:
        assert request.json is not None
        failed_body = {**request.json, fault: True}
    else:
        monkeypatch.setattr(IdempotentMutation, "__call__", fault_call)
    response = await client_for(family.users[0]).request(
        route[0], request.url, headers=headers, json=failed_body
    )
    assert response.status_code == status
    async with app.state.session_factory() as session:
        assert (
            await session.get(AppliedMutation, UUID(headers["Idempotency-Key"])) is None
        )
        row = await session.get(entry.model, row_id)
        assert (
            None
            if row is None
            else entry.schema.model_validate(row).model_dump(mode="json")
        ) == previous
    assert await revision(app, family.id) == before
    assert app.state.probe.events == []
    monkeypatch.setattr(IdempotentMutation, "__call__", original)
    retry = await client_for(family.users[0]).request(
        route[0], request.url, headers=headers, json=request.json
    )
    assert retry.status_code == 200
    assert app.state.probe.events == (["pet visible"] if entry.model is Pet else [])


async def test_id2_replay_returns_current_row_including_tombstone(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
) -> None:
    family = await make_family()
    client, headers = client_for(family.users[0]), idem()
    row_id = uuid4()
    body = {"id": str(row_id), "name": "Original pet"}
    assert (
        await client.post("/probe/pet", headers=headers, json=body)
    ).status_code == 200
    async with app.state.session_factory() as session:
        await session.execute(
            update(Pet)
            .where(Pet.id == row_id)
            .values(name="Current pet", deleted_at=app.state.clock.now())
        )
        await session.commit()
    before = await revision(app, family.id)
    response = await client.post("/probe/pet", headers=headers, json=body)
    assert response.status_code == 200
    assert response.json()["name"] == "Current pet"
    assert response.json()["deleted_at"] is not None
    assert response.json()["revision"] == before
    assert await revision(app, family.id) == before
    assert app.state.probe.events == ["pet visible"]


@pytest.mark.parametrize("entity", ENTITY_REGISTRY)
async def test_id2_registry_replays_each_current_contract_shape(
    app: FastAPI,
    make_family: MakeFamily,
    entity: str,
) -> None:
    family = await make_family()
    entry = ENTITY_REGISTRY[entity]
    key = uuid4()
    async with app.state.session_factory() as session:
        rows = await family.make_rows(session)
        row = rows[entry.model.__tablename__]
        session.add(
            AppliedMutation(
                client_mutation_id=key,
                family_id=family.id,
                user_id=family.users[0].id,
                entity=entity,
                entity_id=row.id,
            )
        )
        await session.commit()
        expected = entry.schema.model_validate(row).model_dump(mode="json")
    before = await revision(app, family.id)

    async def forbidden_handler() -> SyncModel:
        raise AssertionError("A replay must never execute its handler")

    async with app.state.session_factory() as session:
        response = await IdempotentMutation(session, family.users[1], str(key), entity)(
            forbidden_handler
        )
    assert response.model_dump(mode="json") == expected
    assert await revision(app, family.id) == before


async def test_family_lock_serializes_same_family_without_blocking_another(
    app: FastAPI,
    make_family: MakeFamily,
) -> None:
    first, second = await make_family(), await make_family()
    async with (
        app.state.session_factory() as holder,
        app.state.session_factory() as contender,
    ):
        await lock_family(holder, first.id)
        await contender.execute(text("SET LOCAL lock_timeout = '200ms'"))
        await lock_family(contender, second.id)
        with pytest.raises(DBAPIError) as caught:
            await lock_family(contender, first.id)
        assert getattr(caught.value.orig, "sqlstate", None) == "55P03"
        await contender.rollback()
        await holder.commit()
        await asyncio.wait_for(lock_family(contender, first.id), timeout=5)


async def test_id2_wrapper_holds_family_lock_before_handler_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first, second = await make_family(), await make_family()
    entered, release = asyncio.Event(), asyncio.Event()
    original = IdempotentMutation.__call__

    async def held_call(
        mutation: IdempotentMutation,
        handler: Callable[[], Awaitable[SyncModel]],
    ) -> Row:
        async def held_handler() -> SyncModel:
            entered.set()
            await asyncio.wait_for(release.wait(), timeout=10)
            return await handler()

        return await original(mutation, held_handler)

    monkeypatch.setattr(IdempotentMutation, "__call__", held_call)
    request = asyncio.create_task(
        client_for(first.users[0]).post(
            "/probe/pet",
            headers=idem(),
            json={"id": str(uuid4()), "name": "Held probe pet"},
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        async with app.state.session_factory() as contender:
            # NOWAIT observes the wrapper's lock before a row trigger can take it.
            await contender.execute(
                select(FamilyRevision)
                .where(FamilyRevision.family_id == second.id)
                .with_for_update(nowait=True)
            )
            with pytest.raises(DBAPIError) as caught:
                await contender.execute(
                    select(FamilyRevision)
                    .where(FamilyRevision.family_id == first.id)
                    .with_for_update(nowait=True)
                )
            assert getattr(caught.value.orig, "sqlstate", None) == "55P03"
            await contender.rollback()
    finally:
        release.set()
        response = await asyncio.wait_for(request, timeout=10)
    assert response.status_code == 200
