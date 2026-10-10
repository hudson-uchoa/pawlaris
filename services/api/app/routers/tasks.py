from typing import Annotated, cast
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import RequestClock
from app.schemas.rows import TaskTemplate
from app.schemas.tasks import TaskCreate, TaskPatch
from app.services import tasks

router = APIRouter()
TaskMutation = Annotated[IdempotentMutation, Depends(idempotent("task_templates"))]


@router.post("/tasks", response_model=TaskTemplate)
async def create_task(body: TaskCreate, mutation: TaskMutation) -> TaskTemplate:
    return cast(
        TaskTemplate,
        await mutation(
            lambda: tasks.create_task(mutation.session, mutation.user, body)
        ),
    )


@router.patch("/tasks/{id}", response_model=TaskTemplate)
async def patch_task(id: UUID, body: TaskPatch, mutation: TaskMutation) -> TaskTemplate:
    return cast(
        TaskTemplate,
        await mutation(
            lambda: tasks.patch_task(mutation.session, mutation.user, id, body)
        ),
    )


@router.delete("/tasks/{id}", response_model=TaskTemplate)
async def delete_task(
    id: UUID, mutation: TaskMutation, clock: RequestClock
) -> TaskTemplate:
    return cast(
        TaskTemplate,
        await mutation(
            lambda: tasks.delete_task(mutation.session, mutation.user, id, clock)
        ),
    )
