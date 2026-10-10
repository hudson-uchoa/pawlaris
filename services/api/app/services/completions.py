from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.models import AppUser, TaskCompletion
from app.schemas.completions import CompletionCreate

type CompletionOutcome = Literal["created", "existing", "lost"]


async def create_completion(
    session: AsyncSession, user: AppUser, body: CompletionCreate, clock: Clock
) -> tuple[TaskCompletion, CompletionOutcome]:
    raise NotImplementedError


async def undo_completion(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> TaskCompletion:
    raise NotImplementedError
