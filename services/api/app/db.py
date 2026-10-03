from collections.abc import AsyncIterator, Awaitable, Callable
from typing import cast

from fastapi import Request
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.settings import Settings

type CommitCallback = Callable[[], Awaitable[None]]


def make_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url.get_secret_value(), pool_size=4, max_overflow=2
    )


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)
    async with factory() as session:
        yield session


async def transactional[T](session: AsyncSession, fn: Callable[[], Awaitable[T]]) -> T:
    raise NotImplementedError("not implemented")
