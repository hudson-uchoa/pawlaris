from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import text
from starlette.requests import Request

from app.clock import FrozenClock, SystemClock
from app.db import get_session
from app.settings import ENV_FILE, Settings


async def test_session_teardown_closes_without_committing(app: FastAPI) -> None:
    row_id = uuid4()
    request = Request({"type": "http", "app": app})
    dependency = get_session(request)
    session = await anext(dependency)
    await session.execute(
        text("INSERT INTO probe_commit (id, marker) VALUES (:id, :marker)"),
        {"id": row_id, "marker": uuid4().hex},
    )
    await dependency.aclose()
    async with app.state.engine.connect() as connection:
        assert (
            await connection.scalar(
                text("SELECT count(*) FROM probe_commit WHERE id = :id"),
                {"id": row_id},
            )
            == 0
        )


def test_frozen_clock_advances_wall_and_monotonic_time() -> None:
    instant = datetime(2026, 9, 14, tzinfo=UTC)
    clock = FrozenClock(instant)
    assert clock.now() == instant
    assert clock.monotonic() == 0
    clock.advance(timedelta(seconds=2))
    assert clock.now() == instant + timedelta(seconds=2)
    assert clock.monotonic() == 2


def test_frozen_clock_rejects_naive_time() -> None:
    with pytest.raises(ValueError, match="UTC"):
        FrozenClock(datetime.fromisoformat("2026-09-14"))


def test_system_clock_returns_utc_and_monotonic_time() -> None:
    clock = SystemClock()
    assert clock.now().utcoffset() == timedelta(0)
    first = clock.monotonic()
    assert clock.monotonic() >= first


def test_settings_reads_env_from_api_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)
    assert ENV_FILE == Path(__file__).resolve().parents[2] / ".env"
    settings = Settings()
    assert settings.database_url.get_secret_value()
    assert len(settings.jwt_secret.get_secret_value().encode()) >= 32
    assert settings.database_url.get_secret_value() not in repr(settings)
    assert settings.jwt_secret.get_secret_value() not in repr(settings)


def test_production_contract_contains_only_registered_routes(app: FastAPI) -> None:
    from tests.security.matrix import PERMISSION_MATRIX, PUBLIC_ROUTES

    paths = cast(dict[str, object], app.openapi()["paths"])
    assert "/probe/write" in paths
    production = create_production_app()
    expected = PUBLIC_ROUTES | {
        (case.method, case.template) for case in PERMISSION_MATRIX
    }
    assert set(production.openapi()["paths"]) == {path for _, path in expected}


def create_production_app() -> FastAPI:
    from app.main import create_app

    return create_app()
