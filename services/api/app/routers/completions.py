from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import RequestClock
from app.schemas.completions import CompletionCreate
from app.schemas.rows import Completion

router = APIRouter()
CompletionMutation = Annotated[
    IdempotentMutation, Depends(idempotent("task_completions"))
]


@router.post("/completions", response_model=Completion)
async def create_completion(
    body: CompletionCreate, mutation: CompletionMutation, clock: RequestClock
) -> Completion:
    raise NotImplementedError


@router.post("/completions/{id}/undo", response_model=Completion)
async def undo_completion(
    id: UUID, mutation: CompletionMutation, clock: RequestClock
) -> Completion:
    raise NotImplementedError
