import secrets
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, AsyncHTTPTransport, Request, Response
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.clock import FrozenClock
from app.deps import get_clock
from app.main import create_app
from app.models import AppUser
from app.security.tokens import issue_access
from app.settings import Settings
from tests._probe import ProbeState, router

API_ROOT = Path(__file__).resolve().parents[1]
pytest_plugins = ["tests.factories"]


@pytest.fixture(autouse=True)
def forbid_network(monkeypatch: pytest.MonkeyPatch) -> None:
    async def forbidden(self: AsyncHTTPTransport, request: Request) -> Response:
        raise AssertionError("API tests must use ASGITransport or MockTransport")

    monkeypatch.setattr(AsyncHTTPTransport, "handle_async_request", forbidden)


@pytest.fixture
def idem() -> Callable[[], dict[str, str]]:
    return lambda: {"Idempotency-Key": str(uuid4())}


@pytest.fixture(scope="session")
async def database_url() -> AsyncIterator[str]:
    from tests.factories import migrate, private_database

    async with private_database() as test_url:
        await migrate(test_url, "upgrade", "head")
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


@pytest.fixture
def frozen_clock() -> FrozenClock:
    return FrozenClock(datetime(2026, 9, 14, 10, 30, tzinfo=UTC))


@pytest.fixture
def settings(database_url: str, tmp_path: Path) -> Settings:
    return Settings(
        database_url=SecretStr(database_url),
        blob_dir=tmp_path,
        jwt_secret=SecretStr(secrets.token_hex(32)),
    )


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


type ClientFor = Callable[[AppUser], AsyncClient]


@pytest.fixture
async def client_for(
    app: FastAPI, settings: Settings, frozen_clock: FrozenClock
) -> AsyncIterator[ClientFor]:
    clients: list[AsyncClient] = []

    def create(user: AppUser) -> AsyncClient:
        http = AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            headers={
                "Authorization": f"Bearer {issue_access(user, frozen_clock, settings)}"
            },
        )
        clients.append(http)
        return http

    yield create
    for http in clients:
        await http.aclose()
