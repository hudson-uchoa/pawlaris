"""Merge family replica rows into this server's history."""

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import transactional
from app.errors import ApiError
from app.idempotency import ENTITY_REGISTRY, FamilyOwnedModel, SyncModel
from app.locks import lock_family
from app.models import (
    AppUser,
    Family,
    Pet,
    PushDevice,
    TaskCompletion,
    TaskTemplate,
    WalkRoute,
    WalkSession,
)
from app.push import PushAfterCommit, PushMessage, completion_duplicate_message
from app.realtime import PokeAfterCommit
from app.schemas.family import FamilyPatch
from app.schemas.pets import HealthEventPatch, PetPatch
from app.schemas.reseed import (
    ReseedChange,
    ReseedCompletion,
    ReseedRequest,
    ReseedResult,
    ReseedTaskTemplate,
    ReseedWalk,
    ReseedWalkRoute,
)
from app.schemas.tasks import TaskPatch
from app.schemas.walks import WalkFinish

type Values = dict[str, object]
type Outcome = Literal["inserted", "updated", "unchanged", "refused"]

ENTITY_ORDER = (
    "members",
    "family",
    "pets",
    "task_templates",
    "weight_entries",
    "health_events",
    "task_completions",
    "task_timers",
    "walk_sessions",
    "walk_routes",
)
EDITABLE_FIELDS: dict[str, tuple[str, ...]] = {
    "family": tuple(FamilyPatch.model_fields),
    "pets": (*PetPatch.model_fields, "archived_at"),
    "task_templates": tuple(TaskPatch.model_fields),
    "health_events": tuple(HealthEventPatch.model_fields),
    "walk_sessions": ("note",),
}
WALK_METRICS = (
    "status",
    *(
        field
        for field in WalkFinish.model_fields
        if field not in {"pet_id", "started_at", "note", "route"}
    ),
)
REFERENCES: tuple[tuple[str, type[FamilyOwnedModel]], ...] = (
    ("created_by", AppUser),
    ("completed_by", AppUser),
    ("undone_by", AppUser),
    ("started_by", AppUser),
    ("user_id", AppUser),
    ("assigned_to", AppUser),
    ("pet_id", Pet),
    ("task_id", TaskTemplate),
    ("replaces_task_id", TaskTemplate),
)


def editable_fields(server: Values, incoming: Values, fields: Iterable[str]) -> Values:
    """Take editable fields from the newer row; the server wins a tie."""
    source = (
        incoming
        if cast(datetime, incoming["updated_at"]) > cast(datetime, server["updated_at"])
        else server
    )
    return {field: source[field] for field in fields}


def updated_at(server: datetime, incoming: datetime) -> datetime:
    """The row's change instant is independent of its fields and tombstone."""
    return max(server, incoming)


def tombstone(
    server: Values,
    incoming: Values,
    field: str,
    companions: tuple[str, ...] = (),
) -> Values:
    """Keep the earliest tombstone and its attribution, never resurrect a row."""
    server_time = cast(datetime | None, server[field])
    incoming_time = cast(datetime | None, incoming[field])
    source = (
        incoming
        if incoming_time is not None
        and (server_time is None or incoming_time < server_time)
        else server
    )
    return {key: source[key] for key in (field, *companions)}


def ordered_changes(rows: list[ReseedChange]) -> Iterable[ReseedChange]:
    for entity in ENTITY_ORDER:
        pending = [change for change in rows if change.entity == entity]
        if entity == "task_completions":
            pending.sort(
                key=lambda change: (
                    isinstance(change.row, ReseedCompletion)
                    and change.row.duplicate_of is not None
                )
            )
        while pending:
            ids = {
                change.row.id
                for change in pending
                if not isinstance(change.row, ReseedWalkRoute)
            }
            eligible = next(
                (
                    change
                    for change in pending
                    if (
                        not isinstance(change.row, ReseedTaskTemplate)
                        or change.row.replaces_task_id not in ids
                    )
                    and (
                        not isinstance(change.row, ReseedCompletion)
                        or change.row.duplicate_of not in ids
                    )
                ),
                pending[0],
            )
            pending.remove(eligible)
            yield eligible


async def has_reference[Model: FamilyOwnedModel](
    session: AsyncSession,
    model: type[Model],
    id: UUID,
    family_id: UUID,
) -> bool:
    row = await session.get(model, id)
    return row is not None and row.family_id == family_id


async def references_exist(
    session: AsyncSession, values: Values, family_id: UUID
) -> bool:
    for field, model in REFERENCES:
        id = cast(UUID | None, values.get(field))
        if id is not None and not await has_reference(session, model, id, family_id):
            return False
    for pet_id in cast(list[UUID], values.get("pet_ids", [])):
        if not await has_reference(session, Pet, pet_id, family_id):
            return False
    return True


def merged_values(entity: str, server: SyncModel, incoming: Values) -> Values:
    stored = {field: cast(object, getattr(server, field)) for field in incoming}
    values = {
        **stored,
        **editable_fields(stored, incoming, EDITABLE_FIELDS.get(entity, ())),
        "updated_at": updated_at(
            server.updated_at, cast(datetime, incoming["updated_at"])
        ),
    }
    if entity != "family" and "deleted_at" in incoming:
        values.update(tombstone(stored, incoming, "deleted_at"))
    elif "undone_at" in incoming:
        values.update(
            tombstone(stored, incoming, "undone_at", ("undone_by", "duplicate_of"))
        )
    elif "cancelled_at" in incoming:
        values.update(tombstone(stored, incoming, "cancelled_at"))
    if isinstance(server, WalkSession):
        statuses = ("active", "finished", "discarded")
        incoming_status = statuses.index(cast(str, incoming["status"]))
        server_status = statuses.index(server.status)
        source = (
            incoming
            if incoming_status > server_status
            or (
                incoming_status == server_status
                and cast(datetime, incoming["updated_at"]) > server.updated_at
            )
            else stored
        )
        values.update({field: source[field] for field in WALK_METRICS})
    return values


async def save_row[Model: SyncModel](
    session: AsyncSession,
    model: type[Model],
    server: Model | None,
    values: Values,
) -> tuple[Model, Outcome]:
    if server is None:
        row = model(**values)
        session.add(row)
        await session.flush()
        return row, "inserted"
    changes = {
        field: value
        for field, value in values.items()
        if getattr(server, field) != value
    }
    if not changes:
        return server, "unchanged"
    # SET LOCAL preserves even an old instant, so every update supplies it.
    changes["updated_at"] = values["updated_at"]
    for field, value in changes.items():
        setattr(server, field, value)
    await session.flush()
    return server, "updated"


async def duplicate_target(
    session: AsyncSession, id: UUID | None, family_id: UUID
) -> UUID | None:
    seen: set[UUID] = set()
    while id is not None and id not in seen:
        seen.add(id)
        row = await session.get(TaskCompletion, id)
        if row is None or row.family_id != family_id:
            return None
        if row.duplicate_of is None:
            return row.id
        id = row.duplicate_of
    return None


async def merge_completion(
    session: AsyncSession,
    server: TaskCompletion | None,
    values: Values,
    now: datetime,
    duplicates: set[UUID],
) -> Outcome:
    family_id = cast(UUID, values["family_id"])
    values["duplicate_of"] = await duplicate_target(
        session, cast(UUID | None, values["duplicate_of"]), family_id
    )
    live = (
        await session.scalar(
            select(TaskCompletion).where(
                TaskCompletion.family_id == family_id,
                TaskCompletion.id != values["id"],
                TaskCompletion.task_id == values["task_id"],
                TaskCompletion.occurrence_key == values["occurrence_key"],
                TaskCompletion.pet_id.is_not_distinct_from(values["pet_id"]),
                TaskCompletion.undone_at.is_(None),
            )
        )
        if values["undone_at"] is None
        else None
    )
    if live is None:
        _, outcome = await save_row(session, TaskCompletion, server, values)
        return outcome
    incoming_order = (cast(datetime, values["completed_at"]), cast(UUID, values["id"]))
    if incoming_order > (live.completed_at, live.id):
        values.update(
            undone_at=now, undone_by=None, duplicate_of=live.id, updated_at=now
        )
        row, outcome = await save_row(session, TaskCompletion, server, values)
        duplicates.add(row.id)
        return outcome
    # Free the unique live slot before inserting the earlier completion. Its
    # foreign key cannot name the new winner until that row has been inserted.
    live.undone_at = now
    live.undone_by = None
    live.updated_at = now
    await session.flush()
    row, outcome = await save_row(session, TaskCompletion, server, values)
    live.duplicate_of = row.id
    live.updated_at = now
    await session.flush()
    duplicates.add(live.id)
    await session.execute(
        update(TaskCompletion)
        .where(
            TaskCompletion.family_id == family_id,
            TaskCompletion.duplicate_of == live.id,
        )
        .values(duplicate_of=row.id, updated_at=TaskCompletion.updated_at)
    )
    return outcome


async def merge_route(
    session: AsyncSession, row: ReseedWalkRoute, family_id: UUID
) -> Outcome:
    walk = await session.get(WalkSession, row.walk_id)
    if walk is None or walk.family_id != family_id:
        return "refused"
    if (
        walk.status != "finished"
        or await session.get(WalkRoute, row.walk_id) is not None
    ):
        return "unchanged"
    session.add(
        WalkRoute(walk_id=walk.id, points=[list(point) for point in row.points])
    )
    # The route fills the existing snapshot; it does not advance its change time.
    await session.execute(
        update(WalkSession)
        .where(WalkSession.id == walk.id)
        .values(has_route=True, point_count=len(row.points), updated_at=walk.updated_at)
    )
    await session.flush()
    return "inserted"


async def merge_row(
    session: AsyncSession,
    change: ReseedChange,
    family_id: UUID,
    now: datetime,
    duplicates: set[UUID],
) -> Outcome:
    incoming = change.row
    if isinstance(incoming, ReseedWalkRoute):
        return await merge_route(session, incoming, family_id)
    model = ENTITY_REGISTRY[change.entity].model
    server = cast(SyncModel | None, await session.get(model, incoming.id))
    if (change.entity == "family" and incoming.id != family_id) or (
        server is not None
        and not isinstance(server, Family)
        and server.family_id != family_id
    ):
        return "refused"
    if isinstance(server, AppUser):
        return "unchanged"
    values: Values = incoming.model_dump()
    values["updated_at"] = min(incoming.updated_at, now + timedelta(minutes=5))
    if change.entity != "family":
        values["family_id"] = family_id
    if isinstance(incoming, ReseedTaskTemplate):
        values["recurrence"] = incoming.recurrence.model_dump(mode="json")
    elif isinstance(incoming, ReseedWalk):
        values["preview"] = [list(point) for point in incoming.preview]
        values.update(has_route=False, point_count=0)
    if not await references_exist(session, values, family_id):
        return "refused"
    if server is not None:
        values = merged_values(change.entity, server, values)
    if change.entity == "members":
        values.update(
            role="member",
            email=f"stub+{incoming.id}@pawlaris.invalid",
            # An invalid hash is a deliberate sentinel: no password verifies it.
            password_hash="",
        )
    if isinstance(incoming, ReseedCompletion):
        return await merge_completion(
            session, cast(TaskCompletion | None, server), values, now, duplicates
        )
    _, outcome = await save_row(session, model, server, values)
    return outcome


async def queue_duplicates(
    session: AsyncSession,
    family_id: UUID,
    duplicates: set[UUID],
    push: PushAfterCommit,
) -> None:
    messages: list[PushMessage] = []
    for id in sorted(duplicates):
        loser = await session.get(TaskCompletion, id, populate_existing=True)
        if loser is None or loser.duplicate_of is None:
            continue
        winner = await session.get(TaskCompletion, loser.duplicate_of)
        if winner is None or winner.completed_by == loser.completed_by:
            continue
        for recipient_id, other_id in (
            (winner.completed_by, loser.completed_by),
            (loser.completed_by, winner.completed_by),
        ):
            other = await session.get(AppUser, other_id)
            if other is None:
                continue
            tokens = await session.scalars(
                select(PushDevice.token)
                .join(AppUser)
                .where(
                    AppUser.family_id == family_id,
                    AppUser.disabled_at.is_(None),
                    AppUser.id == recipient_id,
                )
            )
            messages.extend(
                completion_duplicate_message(token, other.display_name, winner)
                for token in tokens
            )
    if messages:
        push(messages)


async def reseed(
    session: AsyncSession,
    actor: AppUser,
    body: ReseedRequest,
    clock: Clock,
    poke: PokeAfterCommit,
    push: PushAfterCommit,
) -> ReseedResult:
    family_id = actor.family_id

    async def write() -> ReseedResult:
        await lock_family(session, family_id)
        current = await session.scalar(
            select(AppUser)
            .where(AppUser.id == actor.id, AppUser.family_id == family_id)
            .execution_options(populate_existing=True)
        )
        if current is None or current.disabled_at is not None:
            raise ApiError(401, "token_invalid", "Invalid or expired access token.")
        await session.execute(text("SET LOCAL pawlaris.reseed = 'on'"))
        now = clock.now()
        duplicates: set[UUID] = set()
        counts: dict[str, int] = dict.fromkeys(
            ("inserted", "updated", "unchanged", "refused"), 0
        )
        for change in ordered_changes(body.rows):
            outcome = await merge_row(session, change, family_id, now, duplicates)
            counts[outcome] += 1
        if counts["inserted"] or counts["updated"]:
            await poke(family_id)
        await queue_duplicates(session, family_id, duplicates, push)
        return ReseedResult(**counts, duplicates=len(duplicates))

    return await transactional(session, write)
