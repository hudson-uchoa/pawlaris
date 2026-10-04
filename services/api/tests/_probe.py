from dataclasses import dataclass, field
from datetime import timedelta
from typing import Annotated, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import UUID4, BaseModel, ConfigDict
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import FrozenClock
from app.db import CommitCallback, get_session, transactional
from app.deps import after_commit, get_clock
from app.errors import ApiError
from app.idempotency import IdempotentMutation, SyncModel, idempotent
from app.models import Pet
from app.schemas.rows import Pet as PetRow

router = APIRouter()


class ProbeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID4
    marker: str
    fail_commit: bool = False
    fail_callback: bool = False


class ProbePetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID4
    name: str
    fail_handler: bool = False
    fail_commit: bool = False


@router.post("/pet", response_model=PetRow)
async def idempotent_pet(
    value: ProbePetBody,
    request: Request,
    mutation: Annotated[IdempotentMutation, Depends(idempotent("pets"))],
) -> PetRow:
    async def operation() -> SyncModel:
        session = mutation.session
        row = Pet(
            id=value.id,
            family_id=mutation.user.family_id,
            name=value.name,
            species="cat",
            created_by=mutation.user.id,
        )
        session.add(row)
        await session.flush()

        async def callback() -> None:
            async with request.app.state.session_factory() as observer:
                visible = await observer.scalar(select(Pet.id).where(Pet.id == row.id))
            state = cast(ProbeState, request.app.state.probe)
            state.events.append("pet visible" if visible == row.id else "pet missing")

        callbacks = cast(
            list[CommitCallback], session.info.setdefault("after_commit", [])
        )
        callbacks.append(callback)
        if value.fail_handler:
            raise ApiError(409, "last_leader", "Injected handler failure.")
        if value.fail_commit:
            marker = uuid4().hex
            for _ in range(2):
                await session.execute(
                    text("INSERT INTO probe_commit (id, marker) VALUES (:id, :marker)"),
                    {"id": uuid4(), "marker": marker},
                )
        return row

    return cast(PetRow, await mutation(operation))


@dataclass
class ProbeState:
    events: list[str] = field(default_factory=list)


@router.post("/body")
async def body(value: ProbeBody) -> dict[str, str]:
    return {"marker": value.marker}


@router.get("/error")
async def error() -> None:
    raise ApiError(409, "last_leader", "A family must keep an enabled leader.")


@router.post("/write")
async def write(
    value: ProbeBody,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    callbacks: Annotated[list[CommitCallback], Depends(after_commit)],
    clock: Annotated[FrozenClock, Depends(get_clock)],
) -> dict[str, str]:
    state = cast(ProbeState, request.app.state.probe)

    async def callback() -> None:
        async with request.app.state.engine.connect() as connection:
            visible = await connection.scalar(
                text("SELECT marker FROM probe_commit WHERE id = :id"),
                {"id": value.id},
            )
        state.events.append("visible" if visible == value.marker else "missing")
        if value.fail_callback:
            raise RuntimeError("Injected callback failure")

    async def second_callback() -> None:
        state.events.append("second")

    async def operation() -> dict[str, str]:
        await session.execute(
            text("INSERT INTO probe_commit (id, marker) VALUES (:id, :marker)"),
            {"id": value.id, "marker": value.marker},
        )
        if value.fail_commit:
            await session.execute(
                text("INSERT INTO probe_commit (id, marker) VALUES (:id, :marker)"),
                {"id": uuid4(), "marker": value.marker},
            )
        callbacks.extend([callback, second_callback])
        clock.advance(timedelta(milliseconds=12.5))
        return {"id": str(value.id), "marker": value.marker}

    return await transactional(session, operation)
