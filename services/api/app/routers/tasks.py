from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.idempotency import IdempotentMutation, idempotent
from app.routers.auth import RequestClock
from app.schemas.rows import TaskTemplate
from app.schemas.tasks import TaskCreate, TaskPatch

router = APIRouter()
TaskMutation = Annotated[IdempotentMutation, Depends(idempotent("task_templates"))]


@router.post("/tasks", response_model=TaskTemplate)
async def create_task(body: TaskCreate, mutation: TaskMutation) -> TaskTemplate:
    raise NotImplementedError


@router.patch("/tasks/{id}", response_model=TaskTemplate)
async def patch_task(id: UUID, body: TaskPatch, mutation: TaskMutation) -> TaskTemplate:
    raise NotImplementedError


@router.delete("/tasks/{id}", response_model=TaskTemplate)
async def delete_task(
    id: UUID, mutation: TaskMutation, clock: RequestClock
) -> TaskTemplate:
    raise NotImplementedError
