from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser
from app.schemas.auth import Login, Me, MePatch, PasswordChange, Refresh, Session
from app.security.ratelimit import LoginRateLimiter
from app.settings import Settings


async def login(
    session: AsyncSession,
    body: Login,
    clock: Clock,
    settings: Settings,
    limiter: LoginRateLimiter,
) -> Session:
    raise NotImplementedError


async def refresh(
    session: AsyncSession, body: Refresh, clock: Clock, settings: Settings
) -> Session:
    raise NotImplementedError


async def logout(session: AsyncSession, body: Refresh, clock: Clock) -> None:
    raise NotImplementedError


async def patch_me(session: AsyncSession, user: AppUser, body: MePatch) -> Me:
    raise NotImplementedError


async def change_password(
    session: AsyncSession, user: AppUser, body: PasswordChange, clock: Clock
) -> None:
    raise NotImplementedError
