"""Isolated PostgreSQL databases and family-owned rows for integration tests."""

import asyncio
import os
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
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

from app.models import (
    AppUser,
    Asset,
    Base,
    Family,
    HealthEvent,
    Pet,
    TaskCompletion,
    TaskTemplate,
    TaskTimer,
    WalkSession,
    WeightEntry,
)

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
    @asynccontextmanager
    async def scratch() -> AsyncIterator[str]:
        async with private_database() as url:
            await migrate(url, "upgrade", "head")
            yield url

    return scratch


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
        values: dict[str, object] = {"id": uuid4()}
        if table == "family":
            return {**values, "name": "Test family"}
        values["family_id"] = self.id
        user_id, pet_id = self.users[0].id, self.pets[0].id
        match table:
            case "app_user":
                values.update(
                    email=f"{uuid4().hex}@example.invalid",
                    password_hash=str(uuid4()),
                    display_name="Test member",
                    color="#5B7DB1",
                )
            case "pet":
                values.update(
                    name="Test pet",
                    species="cat",
                    created_by=user_id,
                    birthdate=date(2020, 2, 29),
                    avatar_asset_id=uuid4(),
                )
            case "weight_entry":
                values.update(
                    pet_id=pet_id,
                    weight_kg=Decimal("4.25"),
                    measured_at=INSTANT,
                    created_by=user_id,
                )
            case "health_event":
                values.update(
                    pet_id=pet_id,
                    type="vaccine",
                    title="Test vaccine",
                    occurred_at=INSTANT,
                    next_due_on=date(2027, 9, 14),
                    attachment_asset_id=uuid4(),
                    created_by=user_id,
                )
            case "task_template":
                values.update(
                    title="Family task",
                    recurrence={"freq": "daily", "interval": 1},
                    times_of_day=["08:00"],
                    starts_on=date(2026, 9, 14),
                    pet_ids=[pet_id],
                    created_by=user_id,
                )
            case "task_completion" | "task_timer":
                task = TaskTemplate(**await self.row_values(session, "task_template"))
                session.add(task)
                await session.flush()
                values.update(task_id=task.id, occurrence_key="2026-09-14T08:00")
                if table == "task_completion":
                    values.update(
                        completed_by=user_id,
                        completed_at=INSTANT,
                        title_snapshot=task.title,
                        photo_asset_id=uuid4(),
                    )
                else:
                    values.update(
                        started_by=user_id,
                        started_at=INSTANT,
                        ends_at=INSTANT + timedelta(minutes=5),
                    )
            case "walk_session":
                values.update(
                    pet_id=pet_id,
                    user_id=user_id,
                    started_at=INSTANT,
                    distance_m=Decimal("1234.56"),
                    preview=[[-23.55, -46.63]],
                )
            case "asset":
                asset_id = values["id"]
                values.update(
                    kind="task_proof",
                    storage_key=f"{self.id}/{asset_id}.jpg",
                    mime="image/jpeg",
                    bytes=100,
                    width=10,
                    height=10,
                    sha256="digest placeholder",
                    uploaded_by=user_id,
                    created_at=INSTANT,
                )
            case _:
                raise ValueError(f"No sync row factory for {table}")
        return values

    async def make_rows(self, session: AsyncSession) -> dict[str, Base]:
        rows: dict[str, Base] = {
            "family": self.family,
            "app_user": self.users[0],
            "pet": self.pets[0],
        }
        models: tuple[type[Base], ...] = (
            WeightEntry,
            HealthEvent,
            TaskTemplate,
            TaskCompletion,
            TaskTimer,
            WalkSession,
            Asset,
        )
        for model in models:
            row = model(**await self.row_values(session, model.__tablename__))
            session.add(row)
            await session.flush()
            rows[model.__tablename__] = row
        return rows


class MakeFamily(Protocol):
    async def __call__(self, *, members: int = 2, pets: int = 1) -> TestFamily: ...


@pytest.fixture
def make_family(database_url: str) -> MakeFamily:
    async def make(*, members: int = 2, pets: int = 1) -> TestFamily:
        if members < 1 or pets < 0:
            raise ValueError(
                "A test family requires a member and a nonnegative pet count"
            )
        engine = create_async_engine(database_url)
        try:
            async with AsyncSession(engine, expire_on_commit=False) as session:
                family = Family(id=uuid4(), name="Test family")
                session.add(family)
                await session.flush()
                users = [
                    AppUser(
                        id=uuid4(),
                        family_id=family.id,
                        role="leader" if i == 0 else "member",
                        email=f"{uuid4().hex}@example.invalid",
                        password_hash=str(uuid4()),
                        display_name=f"Member {i}",
                        color="#5B7DB1",
                    )
                    for i in range(members)
                ]
                session.add_all(users)
                await session.flush()
                animals = [
                    Pet(
                        id=uuid4(),
                        family_id=family.id,
                        name=f"Pet {i}",
                        species="dog",
                        created_by=users[0].id,
                    )
                    for i in range(pets)
                ]
                session.add_all(animals)
                await session.commit()
                return TestFamily(family, users, animals, database_url)
        finally:
            await engine.dispose()

    return make
