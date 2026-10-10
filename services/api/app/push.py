"""Typed push adapter and message contracts for family activity."""

from collections.abc import Sequence
from typing import Protocol

from httpx import AsyncClient
from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import TaskCompletion, WalkSession

type PushMessage = dict[str, JsonValue]


class PushSender(Protocol):
    async def send(self, messages: Sequence[PushMessage]) -> None:
        raise NotImplementedError


class ExpoPushSender:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        client: AsyncClient | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.client = client

    async def send(self, messages: Sequence[PushMessage]) -> None:
        raise NotImplementedError


class NoOpPushSender:
    async def send(self, messages: Sequence[PushMessage]) -> None:
        raise NotImplementedError


def completion_messages(
    token: str,
    author_name: str,
    completion: TaskCompletion,
    timezone: str,
    pet_name: str | None = None,
) -> list[PushMessage]:
    raise NotImplementedError


def completion_duplicate_message(
    token: str, loser_name: str, winner: TaskCompletion
) -> PushMessage:
    raise NotImplementedError


def walk_started_message(
    token: str, walker_name: str, pet_name: str, walk: WalkSession
) -> PushMessage:
    raise NotImplementedError
