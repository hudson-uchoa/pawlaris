from decimal import Decimal
from uuid import UUID

from pydantic import UUID4, AwareDatetime, Field

from app.schemas.body import RequestBody
from app.schemas.rows import Row

type RoutePoint = tuple[float, float, int, float]
type PreviewPoint = tuple[float, float]


class WalkCreate(RequestBody):
    id: UUID4
    pet_id: UUID
    started_at: AwareDatetime


class WalkFinish(RequestBody):
    pet_id: UUID
    started_at: AwareDatetime
    ended_at: AwareDatetime
    paused_ms: int = Field(ge=-(2**63), le=2**63 - 1)
    distance_m: Decimal = Field(ge=0, le=200_000, decimal_places=2)
    duration_s: int = Field(ge=0, le=86_400)
    avg_pace_s_per_km: int | None = Field(ge=-(2**31), le=2**31 - 1)
    note: str | None = None
    route: list[RoutePoint] = Field(max_length=5_000)
    preview: list[PreviewPoint] = Field(max_length=32)


class WalkRoute(Row):
    points: list[RoutePoint]
