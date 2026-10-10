from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock, get_settings, poke_after_commit
from app.errors import RESERVE_READ_ONLY_RESPONSE
from app.models import AppUser
from app.realtime import PokeAfterCommit
from app.schemas.auth import (
    Login,
    Me,
    MePatch,
    PasswordChange,
    PushToken,
    Redeem,
    Refresh,
    Session,
)
from app.security.ratelimit import LoginRateLimiter
from app.services import auth, family
from app.settings import Settings

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_session)]
User = Annotated[AppUser, Depends(current_user)]
RequestClock = Annotated[Clock, Depends(get_clock)]
Configuration = Annotated[Settings, Depends(get_settings)]
Poke = Annotated[PokeAfterCommit, Depends(poke_after_commit)]


@router.post(
    "/auth/redeem",
    response_model=Session,
    responses={409: RESERVE_READ_ONLY_RESPONSE},
)
async def redeem(
    body: Redeem,
    session: Database,
    clock: RequestClock,
    settings: Configuration,
    poke: Poke,
) -> Session:
    return await family.redeem(session, body, clock, settings, poke)


def get_limiter(request: Request) -> LoginRateLimiter:
    from typing import cast

    return cast(LoginRateLimiter, request.app.state.login_limiter)


@router.post("/auth/login", response_model=Session)
async def login(
    body: Login,
    session: Database,
    clock: RequestClock,
    settings: Configuration,
    limiter: Annotated[LoginRateLimiter, Depends(get_limiter)],
) -> Session:
    return await auth.login(session, body, clock, settings, limiter)


@router.post("/auth/refresh", response_model=Session)
async def refresh(
    body: Refresh, session: Database, clock: RequestClock, settings: Configuration
) -> Session:
    return await auth.refresh(session, body, clock, settings)


@router.post("/auth/logout", status_code=204)
async def logout(body: Refresh, session: Database, clock: RequestClock) -> Response:
    await auth.logout(session, body, clock)
    return Response(status_code=204)


@router.get("/me", response_model=Me)
async def me(user: User) -> Me:
    return Me.model_validate(user)


@router.patch("/me", response_model=Me, responses={409: RESERVE_READ_ONLY_RESPONSE})
async def patch_me(body: MePatch, user: User, session: Database, poke: Poke) -> Me:
    return await auth.patch_me(session, user, body, poke)


@router.post(
    "/me/password", status_code=204, responses={409: RESERVE_READ_ONLY_RESPONSE}
)
async def change_password(
    body: PasswordChange, user: User, session: Database, clock: RequestClock
) -> Response:
    await auth.change_password(session, user, body, clock)
    return Response(status_code=204)


@router.put("/me/push-token", status_code=204)
async def put_push_token(
    body: PushToken, user: User, session: Database, clock: RequestClock
) -> Response:
    await auth.upsert_push_token(session, user, body, clock)
    return Response(status_code=204)


@router.delete("/me/push-token", status_code=204)
async def delete_push_token(body: PushToken, user: User, session: Database) -> Response:
    await auth.delete_push_token(session, user, body)
    return Response(status_code=204)
