from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import current_user
from app.models import AppUser, Base
from app.schemas.rows import Row


@dataclass
class IdempotentMutation:
    session: AsyncSession
    user: AppUser
    key: str | None
    entity: str

    async def __call__(self, handler: Callable[[], Awaitable[Base]]) -> Row:
        raise NotImplementedError("not implemented")


def idempotent(entity: str) -> Callable[..., Awaitable[IdempotentMutation]]:
    async def dependency(
        session: Annotated[AsyncSession, Depends(get_session)],
        user: Annotated[AppUser, Depends(current_user)],
        key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> IdempotentMutation:
        return IdempotentMutation(session, user, key, entity)

    return dependency
