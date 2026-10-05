from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import get_session
from app.deps import current_user, get_clock
from app.models import AppUser, FamilyRevision, ServerMeta
from app.schemas.sync import SyncResponse
from app.services.sync import collect_changes

router = APIRouter()


@router.get("/sync", response_model=SyncResponse)
async def sync(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[AppUser, Depends(current_user)],
    clock: Annotated[Clock, Depends(get_clock)],
    since: Annotated[int, Query(ge=0)],
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
) -> SyncResponse:
    hi = await session.scalar(
        select(FamilyRevision.value).where(FamilyRevision.family_id == user.family_id)
    )
    page = await collect_changes(session, user.family_id, since, limit, hi or 0)
    epoch = (await session.execute(select(ServerMeta.sync_epoch))).scalar_one()
    return SyncResponse(
        epoch=epoch,
        server_time=clock.now(),
        revision=page.revision,
        has_more=page.has_more,
        changes=page.changes,
    )
