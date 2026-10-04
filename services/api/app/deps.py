from typing import Annotated, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import CommitCallback, get_session
from app.models import AppUser
from app.settings import Settings

bearer = HTTPBearer(auto_error=False)


def get_clock(request: Request) -> Clock:
    return cast(Clock, request.app.state.clock)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


async def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AppUser:
    raise NotImplementedError


def after_commit(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CommitCallback]:
    return cast(list[CommitCallback], session.info.setdefault("after_commit", []))
