"""Merge family replica rows into this server's history."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser
from app.push import PushAfterCommit
from app.realtime import PokeAfterCommit
from app.schemas.reseed import ReseedRequest, ReseedResult


async def reseed(
    session: AsyncSession,
    actor: AppUser,
    body: ReseedRequest,
    clock: Clock,
    poke: PokeAfterCommit,
    push: PushAfterCommit,
) -> ReseedResult:
    raise NotImplementedError("Reseed merge is not implemented")
