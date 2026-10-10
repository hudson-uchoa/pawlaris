from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock, poke_after_commit, push_after_commit
from app.models import AppUser
from app.push import PushAfterCommit
from app.realtime import PokeAfterCommit
from app.schemas.reseed import ReseedRequest, ReseedResult
from app.services import reseed as reseed_service

router = APIRouter()


@router.post("/reseed", response_model=ReseedResult)
async def reseed(
    body: ReseedRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[AppUser, Depends(current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    poke: Annotated[PokeAfterCommit, Depends(poke_after_commit)],
    push: Annotated[PushAfterCommit, Depends(push_after_commit)],
) -> ReseedResult:
    return await reseed_service.reseed(session, user, body, clock, poke, push)
