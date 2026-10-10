import asyncio
from collections.abc import Callable
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select, update

from app.clock import FrozenClock
from app.models import FamilyRevision, HealthEvent, Pet, WeightEntry
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily

type Idem = Callable[[], dict[str, str]]
MODELS = {"pets": Pet, "weights": WeightEntry, "health-events": HealthEvent}
ENTITIES = {
    "pets": "pets",
    "weights": "weight_entries",
    "health-events": "health_events",
}


@pytest.mark.parametrize("method", ["POST", "PATCH"])
@pytest.mark.parametrize(
    "value,expected",
    [(-(2**31) - 1, 422), (-(2**31), 200), (2**31 - 1, 200), (2**31, 422)],
)
async def test_r2_1_sort_order_fits_database_integer(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    method: str,
    value: int,
    expected: int,
) -> None:
    family = await make_family()
    body = body_for("pets", family) if method == "POST" else {}
    body["sort_order"] = value
    path = "/api/v1/pets" + (f"/{family.pets[0].id}" if method == "PATCH" else "")
    response = await client_for(family.users[0]).request(
        method, path, json=body, headers=idem()
    )
    assert response.status_code == expected
    if expected == 200:
        assert response.json()["sort_order"] == value


def body_for(resource: str, family: TestFamily) -> dict[str, object]:
    body: dict[str, object] = {"id": str(uuid4())}
    if resource == "pets":
        body.update(name="New pet", species="cat")
    elif resource == "weights":
        body.update(
            pet_id=str(family.pets[0].id),
            weight_kg=4.25,
            measured_at="2026-09-14T10:30:00Z",
            note="Measured at home",
        )
    else:
        body.update(
            pet_id=str(family.pets[0].id),
            type="vaccine",
            title="Annual vaccine",
            occurred_at="2026-09-14T10:30:00Z",
            next_due_on="2027-09-14",
            notes="Health notes",
            attachment_asset_id=str(uuid4()),
        )
    return body


async def revision(app: FastAPI, family: TestFamily) -> int:
    async with app.state.session_factory() as session:
        return (
            await session.execute(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            )
        ).scalar_one()


@pytest.mark.parametrize("role", ["member", "leader"])
async def test_r2_1_pet_profile_create_and_fieldwise_patch(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    role: str,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    client = client_for(actor)
    body = body_for("pets", family)
    body.update(
        sex="female",
        breed="Breed",
        color="Grey",
        birthdate="2020-02-29",
        microchip_id="chip",
        avatar_asset_id=str(uuid4()),
        notes="Profile",
        sort_order=7,
    )
    created = await client.post("/api/v1/pets", json=body, headers=idem())
    assert created.status_code == 200
    row = created.json()
    assert row.items() >= body.items()
    assert row["created_by"] == str(actor.id)
    assert (
        "family_id" not in row
        and row["archived_at"] is None
        and row["deleted_at"] is None
    )
    before = await revision(app, family)
    patch = {
        "name": "Renamed",
        "notes": None,
        "avatar_asset_id": None,
        "sort_order": -1,
    }
    changed = await client.patch(
        f"/api/v1/pets/{body['id']}", json=patch, headers=idem()
    )
    assert changed.status_code == 200
    for key, value in row.items():
        if key not in {*patch, "revision", "updated_at"}:
            assert changed.json()[key] == value
    assert changed.json().items() >= patch.items()
    assert changed.json()["revision"] > before
    sync = (await client.get(f"/api/v1/sync?since={before}")).json()
    assert {"entity": "pets", "row": changed.json()} in sync["changes"]


async def test_r2_1_pet_defaults_and_no_delete_route(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    body = body_for("pets", family)
    response = await client.post("/api/v1/pets", json=body, headers=idem())
    assert response.status_code == 200
    assert response.json()["sex"] == "unknown" and response.json()["sort_order"] == 0
    assert (
        await client.delete(f"/api/v1/pets/{body['id']}", headers=idem())
    ).status_code == 405


async def test_r2_2_archive_and_unarchive_replicate_and_preserve_history(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    client = client_for(family.users[0])
    weight = await client.post(
        "/api/v1/weights", json=body_for("weights", family), headers=idem()
    )
    health = await client.post(
        "/api/v1/health-events", json=body_for("health-events", family), headers=idem()
    )
    assert weight.status_code == health.status_code == 200
    path = f"/api/v1/pets/{family.pets[0].id}"
    before = await revision(app, family)
    archived = await client.post(f"{path}/archive", headers=idem())
    assert archived.status_code == 200
    assert archived.json()["archived_at"] == frozen_clock.now().isoformat().replace(
        "+00:00", "Z"
    )
    assert (
        archived.json()["revision"] > before and archived.json()["deleted_at"] is None
    )
    frozen_clock.advance(timedelta(minutes=1))
    repeat = await client.post(f"{path}/archive", headers=idem())
    assert repeat.status_code == 200 and repeat.json() == archived.json()
    sync = (await client.get(f"/api/v1/sync?since={before}")).json()
    assert sync["changes"] == [{"entity": "pets", "row": archived.json()}]
    unarchived = await client.post(f"{path}/unarchive", headers=idem())
    assert unarchived.status_code == 200 and unarchived.json()["archived_at"] is None
    assert unarchived.json()["revision"] > archived.json()["revision"]
    repeat = await client.post(f"{path}/unarchive", headers=idem())
    assert repeat.json() == unarchived.json()
    sync = (
        await client.get(f"/api/v1/sync?since={archived.json()['revision']}")
    ).json()
    assert {"entity": "pets", "row": unarchived.json()} in sync["changes"]
    full = (await client.get("/api/v1/sync?since=0")).json()
    assert {"entity": "weight_entries", "row": weight.json()} in full["changes"]
    assert {"entity": "health_events", "row": health.json()} in full["changes"]


@pytest.mark.parametrize("action", ["archive", "unarchive"])
async def test_rb2_member_cannot_archive_or_unarchive_own_family_pet(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    action: str,
) -> None:
    family = await make_family()
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        f"/api/v1/pets/{family.pets[0].id}/{action}",
        headers=idem(),
    )
    assert response.status_code == 403 and response.json()["code"] == "forbidden"
    assert await revision(app, family) == before


@pytest.mark.parametrize("resource", MODELS)
async def test_id2_existing_id_returns_original_even_with_new_payload(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    body = body_for(resource, family)
    first = await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    assert first.status_code == 200
    before = await revision(app, family)
    body.update(
        {"name": "Other pet", "species": "dog"}
        if resource == "pets"
        else {"pet_id": str(uuid4())}
    )
    second = await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    assert second.status_code == 200 and second.json() == first.json()
    assert await revision(app, family) == before


@pytest.mark.parametrize("resource", MODELS)
async def test_id2_concurrent_creates_with_same_id_have_one_row_and_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
) -> None:
    family = await make_family()
    body = body_for(resource, family)
    before = await revision(app, family)
    responses = await asyncio.gather(
        *[
            client_for(user).post(f"/api/v1/{resource}", json=body, headers=idem())
            for user in family.users
        ]
    )
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    assert await revision(app, family) == before + 1


@pytest.mark.parametrize("resource", ["weights", "health-events"])
async def test_r2_8_soft_delete_syncs_tombstone_and_later_delete_changes_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    resource: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    body = body_for(resource, family)
    created = await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    assert created.status_code == 200
    before = await revision(app, family)
    response = await client.delete(f"/api/v1/{resource}/{body['id']}", headers=idem())
    assert response.status_code == 200
    row = response.json()
    assert row["deleted_at"] == frozen_clock.now().isoformat().replace("+00:00", "Z")
    assert row["revision"] > before
    assert {
        key: value
        for key, value in row.items()
        if key not in {"revision", "updated_at", "deleted_at"}
    } == {
        key: value
        for key, value in created.json().items()
        if key not in {"revision", "updated_at", "deleted_at"}
    }
    sync = (await client.get(f"/api/v1/sync?since={before}")).json()
    assert sync["changes"] == [{"entity": ENTITIES[resource], "row": row}]
    frozen_clock.advance(timedelta(minutes=1))
    before_repeat = await revision(app, family)
    second = await client.delete(f"/api/v1/{resource}/{body['id']}", headers=idem())
    assert second.status_code == 200 and second.json() == row
    recreate = await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    assert recreate.status_code == 200 and recreate.json() == row
    assert await revision(app, family) == before_repeat
    async with app.state.session_factory() as session:
        model = MODELS[resource]
        assert (
            await session.scalar(
                select(func.count())
                .select_from(model)
                .where(model.family_id == family.id, model.id == UUID(str(body["id"])))
            )
            == 1
        )


@pytest.mark.parametrize(
    "resource,action",
    [
        ("pets", "patch"),
        ("pets", "archive"),
        ("pets", "unarchive"),
        ("health-events", "patch"),
    ],
)
async def test_r5_7_soft_deleted_target_rejects_patch_and_actions(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    resource: str,
    action: str,
) -> None:
    family = await make_family()
    body = body_for(resource, family)
    client = client_for(family.users[0])
    assert (
        await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    ).status_code == 200
    async with app.state.session_factory() as session:
        model = MODELS[resource]
        await session.execute(
            update(model)
            .where(model.family_id == family.id, model.id == UUID(str(body["id"])))
            .values(deleted_at=frozen_clock.now())
        )
        await session.commit()
    before = await revision(app, family)
    response = await client.request(
        "PATCH" if action == "patch" else "POST",
        f"/api/v1/{resource}/{body['id']}"
        + ("" if action == "patch" else f"/{action}"),
        json=({"name": "Changed"} if resource == "pets" else {"title": "Changed"})
        if action == "patch"
        else None,
        headers=idem(),
    )
    assert response.status_code == 404
    assert await revision(app, family) == before


ROUTES = [
    ("POST", "pets", ""),
    ("PATCH", "pets", ""),
    ("POST", "pets", "archive"),
    ("POST", "pets", "unarchive"),
    ("POST", "weights", ""),
    ("DELETE", "weights", ""),
    ("POST", "health-events", ""),
    ("PATCH", "health-events", ""),
    ("DELETE", "health-events", ""),
]


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize("role", ["member", "leader"])
async def test_rb1_every_route_hides_other_family_rows_with_404(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str, str],
    role: str,
) -> None:
    family, other = await make_family(), await make_family()
    method, resource, action = route
    foreign_body = body_for(resource, other)
    created = await client_for(other.users[0]).post(
        f"/api/v1/{resource}", json=foreign_body, headers=idem()
    )
    assert created.status_code == 200
    own_body = body_for(resource, family)
    own_body["id"] = foreign_body["id"]
    create = method == "POST" and not action
    path = f"/api/v1/{resource}" + ("" if create else f"/{foreign_body['id']}")
    if action:
        path += f"/{action}"
    body = (
        own_body
        if create
        else ({"name": "Changed"} if resource == "pets" else {"title": "Changed"})
        if method == "PATCH"
        else None
    )
    actor = next(user for user in family.users if user.role == role)
    before, other_before = await revision(app, family), await revision(app, other)
    response = await client_for(actor).request(method, path, json=body, headers=idem())
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert str(foreign_body["id"]) not in response.text
    assert (
        await revision(app, family) == before
        and await revision(app, other) == other_before
    )


@pytest.mark.parametrize(
    "route", [route for route in ROUTES if route[0] != "POST" or route[2]]
)
async def test_rb1_unknown_target_is_404(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    route: tuple[str, str, str],
) -> None:
    family = await make_family()
    method, resource, action = route
    path = f"/api/v1/{resource}/{uuid4()}" + (f"/{action}" if action else "")
    body = (
        ({"name": "Changed"} if resource == "pets" else {"title": "Changed"})
        if method == "PATCH"
        else None
    )
    response = await client_for(family.users[0]).request(
        method, path, json=body, headers=idem()
    )
    assert response.status_code == 404


@pytest.mark.parametrize("resource", ["weights", "health-events"])
@pytest.mark.parametrize("target", ["unknown", "other_family"])
async def test_rb1_scalar_pet_reference_must_belong_to_family(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
    target: str,
) -> None:
    family, other = await make_family(), await make_family()
    body = body_for(resource, family)
    body["pet_id"] = str(uuid4() if target == "unknown" else other.pets[0].id)
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        f"/api/v1/{resource}", json=body, headers=idem()
    )
    assert response.status_code == 404
    assert await revision(app, family) == before


@pytest.mark.parametrize(
    "weight,expected",
    [
        (-0.01, 422),
        (0, 422),
        (0.001, 422),
        (0.009, 422),
        (0.01, 200),
        (0.02, 200),
        (119.98, 200),
        (119.99, 200),
        (119.991, 422),
        (119.999, 422),
        (120, 422),
        (120.01, 422),
        (1.234, 422),
        (4.25, 200),
        (4.2500, 200),
        ("NaN", 422),
        ("Infinity", 422),
    ],
)
async def test_r2_5_weight_bounds_and_scale(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    weight: float | str,
    expected: int,
) -> None:
    family = await make_family()
    body = body_for("weights", family)
    body["weight_kg"] = weight
    before = await revision(app, family)
    response = await client_for(family.users[1]).post(
        "/api/v1/weights", json=body, headers=idem()
    )
    assert response.status_code == expected
    if expected == 200:
        assert isinstance(response.json()["weight_kg"], int | float)
        assert response.json()["weight_kg"] == weight
    else:
        assert await revision(app, family) == before


@pytest.mark.parametrize(
    "event_type",
    ["vaccine", "medication", "vet_visit", "symptom", "procedure", "other"],
)
async def test_r2_9_health_types_and_nullable_patch_fields(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    event_type: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    body = body_for("health-events", family)
    body["type"] = event_type
    created = await client.post("/api/v1/health-events", json=body, headers=idem())
    assert created.status_code == 200 and created.json().items() >= body.items()
    patch = {
        "title": "Updated title",
        "notes": None,
        "next_due_on": None,
        "attachment_asset_id": None,
    }
    changed = await client.patch(
        f"/api/v1/health-events/{body['id']}", json=patch, headers=idem()
    )
    assert changed.status_code == 200 and changed.json().items() >= patch.items()
    assert changed.json()["occurred_at"] == body["occurred_at"]
    assert changed.json()["type"] == event_type
    assert changed.json()["pet_id"] == body["pet_id"]


@pytest.mark.parametrize(
    "resource,field",
    [("pets", "avatar_asset_id"), ("health-events", "attachment_asset_id")],
)
async def test_as1_missing_asset_is_accepted_on_create_and_patch(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
    field: str,
) -> None:
    family = await make_family()
    body = body_for(resource, family)
    body[field] = str(uuid4())
    client = client_for(family.users[1])
    created = await client.post(f"/api/v1/{resource}", json=body, headers=idem())
    assert created.status_code == 200 and created.json()[field] == body[field]
    patch = {field: str(uuid4())}
    changed = await client.patch(
        f"/api/v1/{resource}/{body['id']}", json=patch, headers=idem()
    )
    assert changed.status_code == 200 and changed.json()[field] == patch[field]


@pytest.mark.parametrize(
    "resource,field,value",
    [
        ("pets", "name", ""),
        ("pets", "name", "x" * 41),
        ("pets", "name", None),
        ("pets", "species", "rabbit"),
        ("pets", "sex", "invalid"),
        ("health-events", "title", ""),
        ("health-events", "title", "x" * 81),
        ("health-events", "title", None),
        ("health-events", "type", "invalid"),
        ("weights", "measured_at", "2026-09-14T10:30:00"),
        ("health-events", "occurred_at", "2026-09-14T10:30:00"),
        ("pets", "extra", True),
    ],
)
async def test_r2_1_r2_10_create_validates_profile_and_health_fields(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
    field: str,
    value: object,
) -> None:
    family = await make_family()
    body = body_for(resource, family)
    body[field] = value
    response = await client_for(family.users[1]).post(
        f"/api/v1/{resource}", json=body, headers=idem()
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "resource,field,value",
    [
        ("pets", "id", str(uuid4())),
        ("pets", "species", "dog"),
        ("pets", "name", None),
        ("pets", "sex", None),
        ("pets", "sort_order", None),
        ("health-events", "id", str(uuid4())),
        ("health-events", "pet_id", str(uuid4())),
        ("health-events", "title", None),
        ("health-events", "type", None),
        ("health-events", "occurred_at", None),
    ],
)
async def test_r5_7_patch_rejects_immutable_fields_and_nonnullable_nulls(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    resource: str,
    field: str,
    value: object,
) -> None:
    family = await make_family()
    response = await client_for(family.users[1]).patch(
        f"/api/v1/{resource}/{uuid4()}", json={field: value}, headers=idem()
    )
    assert response.status_code == 422
