from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock
from app.models import AppUser
from app.schemas.reseed import ReseedRequest, ReseedResult

router = APIRouter()


@router.post("/reseed", response_model=ReseedResult)
async def reseed(
    body: ReseedRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[AppUser, Depends(current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> ReseedResult:
    raise NotImplementedError
