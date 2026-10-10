import asyncio
from collections.abc import Sequence
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import CommitCallback, get_session
from app.errors import ApiError
from app.models import AppUser
from app.push import PushAfterCommit, PushMessage, PushSender, register_push
from app.realtime import Hub, PokeAfterCommit, family_revision
from app.security.tokens import decode_access
from app.settings import Settings

bearer = HTTPBearer(auto_error=False)


def get_clock(request: Request) -> Clock:
    return cast(Clock, request.app.state.clock)


def get_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def require_primary(
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    if settings.server_role == "reserve":
        raise ApiError(
            409,
            "reserve_read_only",
            "Account operations require the primary server.",
        )


def get_push_sender(request: Request) -> PushSender:
    return cast(PushSender, request.app.state.push_sender)


async def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AppUser:
    if credentials is None:
        raise ApiError(401, "token_invalid", "Invalid or expired access token.")
    claims = decode_access(credentials.credentials, clock, settings)
    user = await session.scalar(
        select(AppUser).where(
            AppUser.id == claims.sub,
            AppUser.family_id == claims.fam,
        )
    )
    if user is None or user.disabled_at is not None:
        raise ApiError(401, "token_invalid", "Invalid or expired access token.")
    request.state.user_id = str(user.id)
    return user


def after_commit(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[CommitCallback]:
    return cast(list[CommitCallback], session.info.setdefault("after_commit", []))


def push_after_commit(
    request: Request,
    sender: Annotated[PushSender, Depends(get_push_sender)],
    callbacks: Annotated[list[CommitCallback], Depends(after_commit)],
) -> PushAfterCommit:
    tasks = cast(set[asyncio.Task[None]], request.app.state.push_tasks)
    context = cast(dict[str, object], getattr(request.state, "log_context", {}))
    authorization = request.headers.get("Authorization", "")

    def register(messages: Sequence[PushMessage]) -> None:
        register_push(callbacks, tasks, sender, messages, context, authorization)

    return register


def poke_after_commit(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    callbacks: Annotated[list[CommitCallback], Depends(after_commit)],
) -> PokeAfterCommit:
    hub = cast(Hub, request.app.state.hub)

    async def register(family_id: UUID) -> None:
        # Capture the final revision while this transaction holds the family lock.
        revision = await family_revision(session, family_id)

        async def poke() -> None:
            await hub.poke(family_id, revision)

        callbacks.append(poke)

    return register
