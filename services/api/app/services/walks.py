from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.errors import ApiError
from app.models import AppUser, Pet, WalkRoute, WalkSession
from app.schemas.walks import WalkCreate, WalkFinish
from app.services import common


async def create_walk(
    session: AsyncSession, user: AppUser, body: WalkCreate
) -> WalkSession:
    return await common.create_owned(
        session,
        WalkSession,
        body.id,
        user,
        body.model_dump(),
        references=((Pet, body.pet_id),),
    )


async def finish_walk(
    session: AsyncSession, user: AppUser, id: UUID, body: WalkFinish
) -> WalkSession:
    row = await common.create_owned(
        session,
        WalkSession,
        id,
        user,
        {"id": id, "pet_id": body.pet_id, "started_at": body.started_at},
        references=((Pet, body.pet_id),),
    )
    _require_edit(user, row)
    if row.status in {"finished", "discarded"}:
        return row
    row.status = "finished"
    row.ended_at = body.ended_at
    row.paused_ms = body.paused_ms
    row.distance_m = body.distance_m
    row.duration_s = body.duration_s
    row.avg_pace_s_per_km = body.avg_pace_s_per_km
    row.note = body.note
    row.preview = [list(point) for point in body.preview]
    row.point_count = len(body.route)
    row.has_route = bool(body.route)
    session.add(WalkRoute(walk_id=row.id, points=[list(point) for point in body.route]))
    return row


async def discard_walk(
    session: AsyncSession, user: AppUser, id: UUID, clock: Clock
) -> WalkSession:
    async def validate(row: WalkSession) -> None:
        _require_edit(user, row)

    row = await common.soft_delete(
        session, WalkSession, id, user, clock, validate=validate
    )
    if row.status != "discarded":
        row.status = "discarded"
    return row


async def get_walk_route(session: AsyncSession, user: AppUser, id: UUID) -> WalkRoute:
    row = await common.get_owned(session, WalkSession, id, user)
    if not row.has_route:
        raise ApiError(404, "not_found", "Walk route not found.")
    route = await session.scalar(
        select(WalkRoute)
        .join(WalkSession)
        .where(WalkSession.family_id == user.family_id, WalkRoute.walk_id == row.id)
    )
    if route is None:
        raise ApiError(404, "not_found", "Walk route not found.")
    return route


def _require_edit(user: AppUser, row: WalkSession) -> None:
    if user.role != "leader" and row.user_id != user.id:
        raise ApiError(
            403,
            "forbidden",
            "Only the walker or a leader may finish or discard a walk.",
        )
