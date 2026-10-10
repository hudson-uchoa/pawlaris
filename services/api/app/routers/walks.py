from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import Database, RequestClock, User
from app.schemas.rows import Walk
from app.schemas.walks import WalkCreate, WalkFinish, WalkRoute

router = APIRouter()
WalkMutation = Annotated[IdempotentMutation, Depends(idempotent("walk_sessions"))]


@router.post("/walks", response_model=Walk)
async def create_walk(body: WalkCreate, mutation: WalkMutation) -> Walk:
    raise NotImplementedError


@router.post("/walks/{id}/finish", response_model=Walk)
async def finish_walk(id: UUID, body: WalkFinish, mutation: WalkMutation) -> Walk:
    raise NotImplementedError


@router.post("/walks/{id}/discard", response_model=Walk)
async def discard_walk(id: UUID, mutation: WalkMutation, clock: RequestClock) -> Walk:
    raise NotImplementedError


@router.get("/walks/{id}/route", response_model=WalkRoute)
async def get_walk_route(id: UUID, session: Database, user: User) -> WalkRoute:
    raise NotImplementedError
