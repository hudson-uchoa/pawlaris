"""Typed push adapter and message contracts for family activity."""

import asyncio
import json
import logging
import traceback
from collections.abc import Callable, Sequence
from contextvars import ContextVar
from typing import Protocol
from uuid import UUID
from zoneinfo import ZoneInfo

from httpx import AsyncClient, HTTPError
from pydantic import JsonValue
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import CommitCallback
from app.models import AppUser, Family, Pet, PushDevice, TaskCompletion, WalkSession

type PushMessage = dict[str, JsonValue]
type PushAfterCommit = Callable[[Sequence[PushMessage]], None]
_log_context: ContextVar[dict[str, object]] = ContextVar("push_log_context")


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
        if not messages:
            return
        if self.client is None:
            async with AsyncClient(timeout=10.0) as client:
                await self._send(client, messages)
        else:
            await self._send(self.client, messages)

    async def _send(self, client: AsyncClient, messages: Sequence[PushMessage]) -> None:
        for offset in range(0, len(messages), 100):
            batch = messages[offset : offset + 100]
            try:
                response = await client.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=list(batch),
                    timeout=10.0,
                )
                response.raise_for_status()
                payload: object = response.json()
                tickets = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(tickets, list):
                    raise ValueError("Invalid Expo push tickets")
            except (HTTPError, ValueError) as exc:
                # HTTP exceptions can include request or response content.
                log_failure(exc)
                return
            stale: set[str] = set()
            for message, ticket in zip(batch, tickets, strict=False):
                if not isinstance(ticket, dict):
                    continue
                details = ticket.get("details")
                if (
                    ticket.get("status") == "error"
                    and isinstance(details, dict)
                    and details.get("error") == "DeviceNotRegistered"
                ):
                    token = message.get("to")
                    if isinstance(token, str):
                        stale.add(token)
            if stale:
                async with self.session_factory() as session, session.begin():
                    await session.execute(
                        delete(PushDevice).where(PushDevice.token.in_(stale))
                    )


class NoOpPushSender:
    async def send(self, messages: Sequence[PushMessage]) -> None:
        return


def completion_messages(
    token: str,
    author_name: str,
    completion: TaskCompletion,
    timezone: str,
    pet_name: str | None = None,
) -> list[PushMessage]:
    time = completion.completed_at.astimezone(ZoneInfo(timezone)).strftime("%H:%M")
    suffix = f" ({pet_name})" if pet_name is not None else ""
    data = _completion_data(completion, "completion")
    return [
        _visible(
            token,
            author_name,
            f'concluiu "{completion.title_snapshot}"{suffix} às {time}',
            data,
        ),
        {"to": token, "priority": "high", "data": {**data, "silent": True}},
    ]


def completion_duplicate_message(
    token: str, loser_name: str, winner: TaskCompletion
) -> PushMessage:
    return _visible(
        token,
        loser_name,
        f'também marcou "{winner.title_snapshot}"',
        _completion_data(winner, "completion_duplicate"),
    )


def walk_started_message(
    token: str, walker_name: str, pet_name: str, walk: WalkSession
) -> PushMessage:
    return _visible(
        token,
        walker_name,
        f"saiu para passear com {pet_name}",
        {"type": "walk_started", "walk_id": str(walk.id), "pet_id": str(walk.pet_id)},
    )


def _completion_data(row: TaskCompletion, event: str) -> dict[str, JsonValue]:
    return {
        "type": event,
        "task_id": str(row.task_id),
        "occurrence_key": row.occurrence_key,
        "pet_id": str(row.pet_id) if row.pet_id is not None else None,
        "completion_id": str(row.id),
    }


def _visible(
    token: str, title: str, body: str, data: dict[str, JsonValue]
) -> PushMessage:
    return {
        "to": token,
        "channelId": "family-activity",
        "priority": "high",
        "title": title,
        "body": body,
        "data": data,
    }


async def _target_tokens(
    session: AsyncSession, user: AppUser, winner_id: UUID | None = None
) -> Sequence[str]:
    query = (
        select(PushDevice.token)
        .join(AppUser)
        .where(
            AppUser.family_id == user.family_id,
            AppUser.disabled_at.is_(None),
            AppUser.id != user.id,
        )
    )
    if winner_id is not None:
        query = query.where(AppUser.id == winner_id)
    return (await session.scalars(query)).all()


async def queue_completion(
    session: AsyncSession,
    user: AppUser,
    row: TaskCompletion,
    push: PushAfterCommit,
    *,
    duplicate: bool = False,
) -> None:
    if duplicate and row.completed_by == user.id:
        return
    tokens = await _target_tokens(
        session, user, row.completed_by if duplicate else None
    )
    if not tokens:
        return
    if duplicate:
        push(
            [
                completion_duplicate_message(token, user.display_name, row)
                for token in tokens
            ]
        )
        return
    timezone = (
        await session.execute(
            select(Family.timezone).where(Family.id == user.family_id)
        )
    ).scalar_one()
    pet_name = (
        (
            await session.execute(
                select(Pet.name).where(
                    Pet.id == row.pet_id, Pet.family_id == user.family_id
                )
            )
        ).scalar_one()
        if row.pet_id is not None
        else None
    )
    push(
        [
            message
            for token in tokens
            for message in completion_messages(
                token, user.display_name, row, timezone, pet_name
            )
        ]
    )


async def queue_walk(
    session: AsyncSession, user: AppUser, row: WalkSession, push: PushAfterCommit
) -> None:
    tokens = await _target_tokens(session, user)
    if not tokens:
        return
    pet_name = (
        await session.execute(
            select(Pet.name).where(
                Pet.id == row.pet_id, Pet.family_id == user.family_id
            )
        )
    ).scalar_one()
    push(
        [
            walk_started_message(token, user.display_name, pet_name, row)
            for token in tokens
        ]
    )


def register_push(
    callbacks: list[CommitCallback],
    tasks: set[asyncio.Task[None]],
    sender: PushSender,
    messages: Sequence[PushMessage],
    context: dict[str, object],
    authorization: str,
) -> None:
    if not messages:
        return

    async def deliver() -> None:
        context_token = _log_context.set(context)
        try:
            await sender.send(messages)
        except Exception as exc:
            # Exception messages can contain the payload or credentials.
            secrets = [authorization, authorization.removeprefix("Bearer ")]
            secrets.extend(
                value
                for message in messages
                for key in ("to", "title", "body")
                if isinstance(value := message.get(key), str)
            )
            detail = str(exc)
            for secret in sorted(secrets, key=len, reverse=True):
                if secret:
                    detail = detail.replace(secret, "[redacted]")
            log_failure(exc, context, detail)
        finally:
            _log_context.reset(context_token)

    async def start() -> None:
        task = asyncio.create_task(deliver())
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    callbacks.append(start)


def log_failure(
    exc: Exception, context: dict[str, object] | None = None, detail: str = ""
) -> None:
    # Frames without source lines or locals keep HTTP and SQL parameters private.
    frames = [
        f'  File "{frame.f_code.co_filename}", line {line}, in {frame.f_code.co_name}'
        for frame, line in traceback.walk_tb(exc.__traceback__)
    ]
    logging.getLogger("pawlaris.push").error(
        json.dumps(
            {
                **(context if context is not None else _log_context.get({})),
                "level": "ERROR",
                "msg": "Push delivery failed",
                "exc": "\n".join([*frames, f"{type(exc).__name__}: {detail}"]),
            }
        )
    )
