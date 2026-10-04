"""Isolated PostgreSQL databases and family-owned rows for integration tests."""

import asyncio
import os
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from dotenv import dotenv_values
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models import AppUser, Base, Family, Pet

API_ROOT = Path(__file__).resolve().parents[1]
INSTANT = datetime(2026, 9, 14, 10, 30, tzinfo=UTC)


async def migrate(database_url: str, direction: str, revision: str) -> None:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.attributes["database_url"] = database_url
    operation = command.upgrade if direction == "upgrade" else command.downgrade
    await asyncio.to_thread(operation, config, revision)


type ScratchDatabase = Callable[[], AbstractAsyncContextManager[str]]


@asynccontextmanager
async def private_database() -> AsyncIterator[str]:
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
        yield admin_url.set(database=name).render_as_string(hide_password=False)
    finally:
        if created:
            async with admin.connect() as connection:
                await connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        await admin.dispose()


@pytest.fixture
def scratch_database() -> ScratchDatabase:
    return private_database


@dataclass
class TestFamily:
    __test__ = False
    family: Family
    users: list[AppUser]
    pets: list[Pet]
    database_url: str

    @property
    def id(self) -> UUID:
        return self.family.id

    async def row_values(self, session: AsyncSession, table: str) -> dict[str, object]:
        raise NotImplementedError("not implemented")

    async def make_rows(self, session: AsyncSession) -> dict[str, Base]:
        raise NotImplementedError("not implemented")


class MakeFamily(Protocol):
    async def __call__(self, *, members: int = 2, pets: int = 1) -> TestFamily: ...


@pytest.fixture
def make_family(database_url: str) -> MakeFamily:
    async def make(*, members: int = 2, pets: int = 1) -> TestFamily:
        raise NotImplementedError("not implemented")

    return make
