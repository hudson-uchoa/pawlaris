from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, cast
from uuid import UUID

from fastapi import Depends, Header
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.db import get_session, transactional
from app.deps import current_user
from app.errors import ApiError
from app.locks import lock_family
from app.models import AppUser
from app.schemas import rows
from app.schemas.rows import Row

type FamilyOwnedModel = (
    models.AppUser
    | models.Pet
    | models.WeightEntry
    | models.HealthEvent
    | models.TaskTemplate
    | models.TaskCompletion
    | models.TaskTimer
    | models.WalkSession
    | models.Asset
)
type SyncModel = models.Family | FamilyOwnedModel


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
        key = _parse_key(self.key)
        entry = ENTITY_REGISTRY[self.entity]

        async def operation() -> Row:
            claimed = await self.session.scalar(
                insert(models.AppliedMutation)
                .values(
                    client_mutation_id=key,
                    family_id=self.user.family_id,
                    user_id=self.user.id,
                    entity=self.entity,
                    entity_id=UUID(int=0),
                )
                .on_conflict_do_nothing()
                .returning(models.AppliedMutation.client_mutation_id)
            )
            if claimed is None:
                stored = (
                    await self.session.execute(
                        select(models.AppliedMutation).where(
                            models.AppliedMutation.client_mutation_id == key
                        )
                    )
                ).scalar_one()
                if (
                    stored.family_id != self.user.family_id
                    or stored.entity != self.entity
                ):
                    raise ApiError(
                        422,
                        "idempotency_key_reused",
                        "The key belongs to another family or entity.",
                    )
                model = entry.model
                query = select(model).where(model.id == stored.entity_id)
                if model is models.Family:
                    query = query.where(models.Family.id == self.user.family_id)
                else:
                    owned_model = cast(type[FamilyOwnedModel], model)
                    query = query.where(owned_model.family_id == self.user.family_id)
                row = (
                    await self.session.execute(
                        query.execution_options(populate_existing=True)
                    )
                ).scalar_one_or_none()
                if row is None:
                    raise ApiError(404, "not_found", "Row not found.")
                return entry.schema.model_validate(row)

            await lock_family(self.session, self.user.family_id)
            current = await self.session.scalar(
                select(AppUser)
                .where(
                    AppUser.id == self.user.id,
                    AppUser.family_id == self.user.family_id,
                )
                .execution_options(populate_existing=True)
            )
            if current is None or current.disabled_at is not None:
                raise ApiError(401, "token_invalid", "Invalid or expired access token.")
            self.user = current
            row = await handler()
            await self.session.flush()
            await self.session.execute(
                update(models.AppliedMutation)
                .where(models.AppliedMutation.client_mutation_id == key)
                .values(entity_id=row.id)
            )
            return entry.schema.model_validate(row)

        return await transactional(self.session, operation)


def _parse_key(raw: str | None) -> UUID:
    if raw is not None:
        try:
            key = UUID(raw)
        except ValueError:
            pass
        else:
            if key.version == 4 and str(key) == raw:
                return key
    raise ApiError(
        400, "idempotency_key_required", "A valid UUIDv4 Idempotency-Key is required."
    )


def idempotent(entity: str) -> Callable[..., Awaitable[IdempotentMutation]]:
    async def dependency(
        session: Annotated[AsyncSession, Depends(get_session)],
        user: Annotated[AppUser, Depends(current_user)],
        key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> IdempotentMutation:
        return IdempotentMutation(session, user, key, entity)

    return dependency
