from collections.abc import Callable
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.models import Pet
from tests.conftest import ClientFor
from tests.factories import MakeFamily

PALETTE_KEYS = (
    "#5B7DB1",
    "#B15B6B",
    "#4F8A6B",
    "#C88A2E",
    "#7A65B0",
    "#3F8F97",
    "#B5654A",
    "#B15B9E",
)


@pytest.mark.parametrize("method", ["POST", "PATCH"])
async def test_r2_13_unknown_identity_color_is_422_on_create_and_patch(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Callable[[], dict[str, str]],
    method: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    pet_id = uuid4() if method == "POST" else family.pets[0].id
    body: dict[str, object] = {"identity_color": "#000000"}
    if method == "POST":
        body.update(id=str(pet_id), name="Test pet", species="cat")
    before = (await client.get("/api/v1/sync?since=0")).json()
    response = await client.request(
        method,
        "/api/v1/pets" + ("" if method == "POST" else f"/{pet_id}"),
        json=body,
        headers=idem(),
    )
    assert response.status_code == 422
    after = (await client.get("/api/v1/sync?since=0")).json()
    assert after == before
    async with app.state.session_factory() as session:
        stored = await session.get(Pet, pet_id)
        if method == "POST":
            assert stored is None
        else:
            assert stored is not None and stored.identity_color is None


@pytest.mark.parametrize("key", PALETTE_KEYS)
@pytest.mark.parametrize("method", ["POST", "PATCH"])
async def test_r2_1_r2_13_palette_key_is_stored_returned_and_synced(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Callable[[], dict[str, str]],
    key: str,
    method: str,
) -> None:
    family = await make_family()
    client = client_for(family.users[1])
    pet_id = uuid4() if method == "POST" else family.pets[0].id
    body: dict[str, object] = {"identity_color": key}
    if method == "POST":
        body.update(id=str(pet_id), name="Test pet", species="cat")
    response = await client.request(
        method,
        "/api/v1/pets" + ("" if method == "POST" else f"/{pet_id}"),
        json=body,
        headers=idem(),
    )
    assert response.status_code == 200
    row = response.json()
    assert row["id"] == str(pet_id)
    assert row["identity_color"] == key
    async with app.state.session_factory() as session:
        stored = await session.scalar(select(Pet).where(Pet.id == UUID(row["id"])))
        assert stored is not None and stored.identity_color == key
    sync = await client.get("/api/v1/sync?since=0")
    assert sync.status_code == 200
    assert {"entity": "pets", "row": row} in sync.json()["changes"]
