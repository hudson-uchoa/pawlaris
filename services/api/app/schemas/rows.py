from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, JsonValue, model_validator


class Row(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def pending(cls, value: object) -> object:
        raise NotImplementedError("not implemented")


class Family(Row):
    id: UUID
    name: str
    timezone: str
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class Member(Row):
    id: UUID
    display_name: str
    role: str
    color: str
    disabled_at: datetime | None
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class Pet(Row):
    id: UUID
    name: str
    species: str
    sex: str
    breed: str | None
    color: str | None
    birthdate: date | None
    microchip_id: str | None
    avatar_asset_id: UUID | None
    notes: str | None
    sort_order: int
    archived_at: datetime | None
    created_by: UUID
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class WeightEntry(Row):
    id: UUID
    pet_id: UUID
    weight_kg: float
    measured_at: datetime
    note: str | None
    created_by: UUID
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class HealthEvent(Row):
    id: UUID
    pet_id: UUID
    type: str
    title: str
    notes: str | None
    occurred_at: datetime
    next_due_on: date | None
    attachment_asset_id: UUID | None
    created_by: UUID
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class TaskTemplate(Row):
    id: UUID
    title: str
    description: str | None
    category: str
    assigned_to: UUID | None
    requires_photo: bool
    timer_seconds: int | None
    reminder_class: str
    sort_order: int
    recurrence: dict[str, JsonValue]
    times_of_day: list[str]
    starts_on: date
    pet_ids: list[UUID]
    completion_mode: str
    ends_on: date | None
    replaces_task_id: UUID | None
    created_by: UUID
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class Completion(Row):
    id: UUID
    task_id: UUID
    occurrence_key: str
    pet_id: UUID | None
    completed_by: UUID
    completed_at: datetime
    title_snapshot: str
    photo_asset_id: UUID | None
    note: str | None
    undone_at: datetime | None
    undone_by: UUID | None
    revision: int
    updated_at: datetime


class Timer(Row):
    id: UUID
    task_id: UUID
    occurrence_key: str
    pet_id: UUID | None
    started_by: UUID
    started_at: datetime
    ends_at: datetime
    cancelled_at: datetime | None
    revision: int
    updated_at: datetime


class Walk(Row):
    id: UUID
    pet_id: UUID
    user_id: UUID
    status: str
    started_at: datetime
    ended_at: datetime | None
    paused_ms: int
    distance_m: float
    duration_s: int
    avg_pace_s_per_km: int | None
    point_count: int
    has_route: bool
    preview: list[list[float]]
    note: str | None
    revision: int
    updated_at: datetime
    deleted_at: datetime | None


class Asset(Row):
    id: UUID
    kind: str
    mime: str
    bytes: int
    width: int
    height: int
    uploaded_by: UUID
    created_at: datetime
    revision: int
    updated_at: datetime
    deleted_at: datetime | None
