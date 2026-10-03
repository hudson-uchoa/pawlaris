import json
import logging
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
        session.info["log_context"] = getattr(request.state, "log_context", {})
        yield session


async def transactional[T](session: AsyncSession, fn: Callable[[], Awaitable[T]]) -> T:
    callbacks = cast(list[CommitCallback], session.info.setdefault("after_commit", []))
    try:
        result = await fn()
        await session.commit()
    except BaseException:
        callbacks.clear()
        await session.rollback()
        raise
    pending = tuple(callbacks)
    callbacks.clear()
    for callback in pending:
        try:
            await callback()
        except Exception:
            context = cast(dict[str, object], session.info.get("log_context", {}))
            logging.getLogger("pawlaris.transaction").error(
                json.dumps(
                    {
                        **context,
                        "level": "ERROR",
                        "msg": "After-commit callback failed",
                    }
                )
            )
    return result
