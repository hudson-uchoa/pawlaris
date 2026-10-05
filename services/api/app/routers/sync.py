from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock
from app.models import AppUser
from app.schemas.sync import SyncResponse

router = APIRouter()


@router.get("/sync", response_model=SyncResponse)
async def sync(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[AppUser, Depends(current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    since: Annotated[int, Query(ge=0)],
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> SyncResponse:
    raise NotImplementedError
