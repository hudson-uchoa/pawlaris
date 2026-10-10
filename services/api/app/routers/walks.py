from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.deps import push_after_commit
from app.idempotency import IdempotentMutation, idempotent
from app.push import PushAfterCommit
from app.routers.auth import Database, RequestClock, User
from app.schemas.rows import Walk
from app.schemas.walks import WalkCreate, WalkFinish, WalkRoute
from app.services import walks

router = APIRouter()
WalkMutation = Annotated[IdempotentMutation, Depends(idempotent("walk_sessions"))]


@router.post("/walks", response_model=Walk)
async def create_walk(
    body: WalkCreate,
    mutation: WalkMutation,
    push: Annotated[PushAfterCommit, Depends(push_after_commit)],
) -> Walk:
    return cast(
        Walk,
        await mutation(
            lambda: walks.create_walk(mutation.session, mutation.user, body, push)
        ),
    )


@router.post("/walks/{id}/finish", response_model=Walk)
async def finish_walk(id: UUID, body: WalkFinish, mutation: WalkMutation) -> Walk:
    return cast(
        Walk,
        await mutation(
            lambda: walks.finish_walk(mutation.session, mutation.user, id, body)
        ),
    )


@router.post("/walks/{id}/discard", response_model=Walk)
async def discard_walk(id: UUID, mutation: WalkMutation, clock: RequestClock) -> Walk:
    return cast(
        Walk,
        await mutation(
            lambda: walks.discard_walk(mutation.session, mutation.user, id, clock)
        ),
    )


@router.get("/walks/{id}/route", response_model=WalkRoute)
async def get_walk_route(id: UUID, session: Database, user: User) -> WalkRoute:
    return WalkRoute.model_validate(await walks.get_walk_route(session, user, id))
