import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from app.clock import FrozenClock
from app.deps import get_clock
from app.main import create_app
from app.settings import Settings
from tests._probe import ProbeState, router

API_ROOT = Path(__file__).resolve().parents[1]
pytest_plugins = ["tests.factories"]


@pytest.fixture(scope="session")
async def database_url() -> AsyncIterator[str]:
    from dotenv import dotenv_values

    configured = os.environ.get("TEST_DATABASE_URL") or dotenv_values(
        API_ROOT / ".env"
    ).get("TEST_DATABASE_URL")
    if not configured:
        pytest.fail("TEST_DATABASE_URL is required for integration tests")
    admin_url = make_url(configured)
    name = f"pawlaris_test_{uuid4().hex}"
    admin = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
    created = False
    try:
        async with admin.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{name}"'))
        created = True
        test_url = admin_url.set(database=name).render_as_string(hide_password=False)
        config = Config(str(API_ROOT / "alembic.ini"))
        config.attributes["database_url"] = test_url
        await asyncio.to_thread(command.upgrade, config, "head")
        engine = create_async_engine(test_url)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        "CREATE TABLE probe_commit (id uuid PRIMARY KEY, "
                        "marker text UNIQUE DEFERRABLE INITIALLY DEFERRED)"
                    )
                )
        finally:
            await engine.dispose()
        yield test_url
    finally:
        if created:
            async with admin.connect() as connection:
                await connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        await admin.dispose()


@pytest.fixture
def frozen_clock() -> FrozenClock:
    return FrozenClock(datetime(2026, 9, 14, 10, 30, tzinfo=UTC))


@pytest.fixture
def settings(database_url: str, tmp_path: Path) -> Settings:
    return Settings(database_url=SecretStr(database_url), blob_dir=tmp_path)


@pytest.fixture
async def app(settings: Settings, frozen_clock: FrozenClock) -> AsyncIterator[FastAPI]:
    application = create_app(settings, frozen_clock)
    application.dependency_overrides[get_clock] = lambda: frozen_clock
    application.state.probe = ProbeState()
    application.include_router(router, prefix="/probe")
    yield application
    await application.state.engine.dispose()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as http:
        yield http
