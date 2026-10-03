from typing import Annotated, cast

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import CommitCallback, get_session


def get_clock(request: Request) -> Clock:
    return cast(Clock, request.app.state.clock)


def after_commit(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CommitCallback]:
    return cast(list[CommitCallback], session.info.setdefault("after_commit", []))
