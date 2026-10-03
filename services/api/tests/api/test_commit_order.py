from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text

from tests._probe import ProbeState


async def test_failed_commit_returns_500_without_callback_or_row(
    app: FastAPI,
    client: AsyncClient,
) -> None:
    row_id = str(uuid4())
    response = await client.post(
        "/probe/write",
        json={
            "id": row_id,
            "marker": uuid4().hex,
            "fail_commit": True,
        },
    )
    assert response.status_code == 500
    assert "Server-Timing" in response.headers
    assert response.headers["Server-Timing"] == "app;dur=12.500"
    assert cast(ProbeState, app.state.probe).events == []
    async with app.state.engine.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM probe_commit WHERE id = :id"),
                {"id": row_id},
            )
            == 0
        )


async def test_successful_commit_is_visible_before_callbacks_and_response(
    app: FastAPI,
    client: AsyncClient,
) -> None:
    row_id = str(uuid4())
    response = await client.post(
        "/probe/write",
        json={
            "id": row_id,
            "marker": uuid4().hex,
        },
    )
    assert response.status_code == 200
    assert response.json()["id"] == row_id
    assert cast(ProbeState, app.state.probe).events == ["visible", "second"]


async def test_callback_failure_preserves_success_and_runs_remaining_callbacks(
    app: FastAPI,
    client: AsyncClient,
) -> None:
    response = await client.post(
        "/probe/write",
        json={
            "id": str(uuid4()),
            "marker": uuid4().hex,
            "fail_callback": True,
        },
    )
    assert response.status_code == 200
    assert cast(ProbeState, app.state.probe).events == ["visible", "second"]
