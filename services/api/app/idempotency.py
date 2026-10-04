from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.db import get_session
from app.deps import current_user
from app.models import AppUser
from app.schemas import rows
from app.schemas.rows import Row

type SyncModel = (
    models.Family
    | models.AppUser
    | models.Pet
    | models.WeightEntry
    | models.HealthEvent
    | models.TaskTemplate
    | models.TaskCompletion
    | models.TaskTimer
    | models.WalkSession
    | models.Asset
)


@dataclass(frozen=True)
class Entity:
    model: type[SyncModel]
    schema: type[Row]


ENTITY_REGISTRY: dict[str, Entity] = {
    "family": Entity(models.Family, rows.Family),
    "members": Entity(models.AppUser, rows.Member),
    "pets": Entity(models.Pet, rows.Pet),
    "weight_entries": Entity(models.WeightEntry, rows.WeightEntry),
    "health_events": Entity(models.HealthEvent, rows.HealthEvent),
    "task_templates": Entity(models.TaskTemplate, rows.TaskTemplate),
    "task_completions": Entity(models.TaskCompletion, rows.Completion),
    "task_timers": Entity(models.TaskTimer, rows.Timer),
    "walk_sessions": Entity(models.WalkSession, rows.Walk),
    "assets": Entity(models.Asset, rows.Asset),
}


@dataclass
class IdempotentMutation:
    session: AsyncSession
    user: AppUser
    key: str | None
    entity: str

    async def __call__(self, handler: Callable[[], Awaitable[SyncModel]]) -> Row:
        raise NotImplementedError("not implemented")


def idempotent(entity: str) -> Callable[..., Awaitable[IdempotentMutation]]:
    async def dependency(
        session: Annotated[AsyncSession, Depends(get_session)],
        user: Annotated[AppUser, Depends(current_user)],
        key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> IdempotentMutation:
        return IdempotentMutation(session, user, key, entity)

    return dependency
