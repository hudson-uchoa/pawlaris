from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import RequestClock
from app.schemas.rows import Timer
from app.schemas.timers import TimerCreate
from app.services import timers

router = APIRouter()
TimerMutation = Annotated[IdempotentMutation, Depends(idempotent("task_timers"))]


@router.post("/timers", response_model=Timer)
async def create_timer(body: TimerCreate, mutation: TimerMutation) -> Timer:
    return cast(
        Timer,
        await mutation(
            lambda: timers.create_timer(mutation.session, mutation.user, body)
        ),
    )


@router.post("/timers/{id}/cancel", response_model=Timer)
async def cancel_timer(id: UUID, mutation: TimerMutation, clock: RequestClock) -> Timer:
    return cast(
        Timer,
        await mutation(
            lambda: timers.cancel_timer(mutation.session, mutation.user, id, clock)
        ),
    )
