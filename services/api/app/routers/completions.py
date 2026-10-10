from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.deps import push_after_commit
from app.idempotency import IdempotentMutation, idempotent
from app.models import TaskCompletion
from app.push import PushAfterCommit
from app.routers.auth import RequestClock
from app.schemas.completions import CompletionCreate
from app.schemas.rows import Completion
from app.services import completions

router = APIRouter()
CompletionMutation = Annotated[
    IdempotentMutation, Depends(idempotent("task_completions"))
]


@router.post("/completions", response_model=Completion)
async def create_completion(
    body: CompletionCreate,
    mutation: CompletionMutation,
    clock: RequestClock,
    push: Annotated[PushAfterCommit, Depends(push_after_commit)],
) -> Completion:
    async def write() -> TaskCompletion:
        row, outcome = await completions.create_completion(
            mutation.session, mutation.user, body, clock
        )
        await completions.notify_completion(
            mutation.session, mutation.user, row, outcome, push
        )
        return row

    return cast(Completion, await mutation(write))


@router.post("/completions/{id}/undo", response_model=Completion)
async def undo_completion(
    id: UUID, mutation: CompletionMutation, clock: RequestClock
) -> Completion:
    return cast(
        Completion,
        await mutation(
            lambda: completions.undo_completion(
                mutation.session, mutation.user, id, clock
            )
        ),
    )
