from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock, get_settings
from app.models import AppUser
from app.schemas.auth import Login, Me, MePatch, PasswordChange, Refresh, Session
from app.settings import Settings

router = APIRouter()
Database = Annotated[AsyncSession, Depends(get_session)]
User = Annotated[AppUser, Depends(current_user)]
RequestClock = Annotated[Clock, Depends(get_clock)]
Configuration = Annotated[Settings, Depends(get_settings)]


@router.post("/auth/login", response_model=Session)
async def login(
    body: Login, session: Database, clock: RequestClock, settings: Configuration
) -> Session:
    raise NotImplementedError


@router.post("/auth/refresh", response_model=Session)
async def refresh(
    body: Refresh, session: Database, clock: RequestClock, settings: Configuration
) -> Session:
    raise NotImplementedError


@router.post("/auth/logout", status_code=204)
async def logout(body: Refresh, session: Database, clock: RequestClock) -> Response:
    raise NotImplementedError


@router.get("/me", response_model=Me)
async def me(user: User) -> Me:
    raise NotImplementedError


@router.patch("/me", response_model=Me)
async def patch_me(body: MePatch, user: User, session: Database) -> Me:
    raise NotImplementedError


@router.post("/me/password", status_code=204)
async def change_password(
    body: PasswordChange, user: User, session: Database, clock: RequestClock
) -> Response:
    raise NotImplementedError
