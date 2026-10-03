from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import get_clock
from app.schemas.health import HealthResponse
from app.services.health import read_health
from app.settings import Settings

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    clock: Annotated[Clock, Depends(get_clock)],
) -> HealthResponse:
    return await read_health(
        session,
        cast(Settings, request.app.state.settings),
        clock,
        cast(float, request.app.state.started_at),
    )
