from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import UUID4, AwareDatetime, Field

from app.schemas.body import RequestBody

type Sex = Literal["female", "male", "unknown"]
type EventType = Literal[
    "vaccine", "medication", "vet_visit", "symptom", "procedure", "other"
]


class PetPatch(RequestBody):
    name: str = Field(default_factory=str, min_length=1, max_length=40)
    sex: Sex = "unknown"
    breed: str | None = None
    color: str | None = None
    birthdate: date | None = None
    microchip_id: str | None = None
    avatar_asset_id: UUID | None = None
    notes: str | None = None
    sort_order: int = Field(default=0, ge=-(2**31), le=2**31 - 1)


class PetCreate(PetPatch):
    id: UUID4
    name: str = Field(min_length=1, max_length=40)
    species: Literal["cat", "dog"]


class WeightCreate(RequestBody):
    id: UUID4
    pet_id: UUID
    weight_kg: Decimal = Field(
        ge=Decimal("0.01"), le=Decimal("119.99"), decimal_places=2
    )
    measured_at: AwareDatetime
    note: str | None = None


class HealthEventPatch(RequestBody):
    type: EventType = "other"
    title: str = Field(default_factory=str, min_length=1, max_length=80)
    notes: str | None = None
    occurred_at: AwareDatetime = Field(
        default_factory=lambda: datetime.min.replace(tzinfo=UTC)
    )
    next_due_on: date | None = None
    attachment_asset_id: UUID | None = None


class HealthEventCreate(HealthEventPatch):
    id: UUID4
    pet_id: UUID
    type: EventType
    title: str = Field(min_length=1, max_length=80)
    occurred_at: AwareDatetime
