from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    UUID4,
    AwareDatetime,
    BaseModel,
    Field,
    field_validator,
    model_validator,
)

from app.cli import IDENTITY_KEYS
from app.schemas.auth import MePatch
from app.schemas.body import RequestBody
from app.schemas.completions import CompletionCreate
from app.schemas.family import FamilyPatch, RoleChange
from app.schemas.pets import HealthEventCreate, PetCreate, Sex, WeightCreate
from app.schemas.tasks import CalendarDate, Category, TaskCreate, TimeOfDay
from app.schemas.timers import TimerCreate
from app.schemas.walks import RoutePoint, WalkCreate, WalkFinish


class ReseedInputRow(RequestBody):
    @model_validator(mode="before")
    @classmethod
    def ignore_revision(cls, value: object) -> object:
        if isinstance(value, dict):
            return {key: item for key, item in value.items() if key != "revision"}
        return value


class ReseedRow(ReseedInputRow):
    updated_at: AwareDatetime


class ReseedDeletedRow(ReseedRow):
    deleted_at: AwareDatetime | None


class ReseedMember(MePatch, RoleChange, ReseedDeletedRow):
    id: UUID4
    color: str = Field(json_schema_extra={"enum": list(IDENTITY_KEYS)})
    disabled_at: AwareDatetime | None

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str) -> str:
        if value not in IDENTITY_KEYS:
            raise ValueError("Color must be an identity key.")
        return value


class ReseedFamily(FamilyPatch, ReseedDeletedRow):
    id: UUID4
    name: Annotated[str, *FamilyPatch.model_fields["name"].metadata]
    timezone: str


class ReseedPet(PetCreate, ReseedDeletedRow):
    sex: Sex
    breed: str | None
    color: str | None
    birthdate: date | None
    microchip_id: str | None
    avatar_asset_id: UUID | None
    notes: str | None
    sort_order: Annotated[int, *PetCreate.model_fields["sort_order"].metadata]
    archived_at: AwareDatetime | None
    created_by: UUID


class ReseedWeightEntry(WeightCreate, ReseedDeletedRow):
    note: str | None
    created_by: UUID


class ReseedHealthEvent(HealthEventCreate, ReseedDeletedRow):
    notes: str | None
    next_due_on: date | None
    attachment_asset_id: UUID | None
    created_by: UUID


class ReseedTaskTemplate(TaskCreate, ReseedDeletedRow):
    description: str | None
    category: Category
    assigned_to: UUID | None
    requires_photo: bool
    timer_seconds: Annotated[
        int | None, *TaskCreate.model_fields["timer_seconds"].metadata
    ]
    reminder_class: Literal["critical", "routine"]
    sort_order: Annotated[int, *TaskCreate.model_fields["sort_order"].metadata]
    ends_on: CalendarDate | None
    times_of_day: Annotated[
        list[TimeOfDay], *TaskCreate.model_fields["times_of_day"].metadata
    ]
    completion_mode: Literal["together", "per_pet"]
    replaces_task_id: UUID | None
    created_by: UUID


class ReseedCompletion(CompletionCreate, ReseedRow):
    pet_id: UUID | None
    photo_asset_id: UUID | None
    note: str | None
    completed_by: UUID
    title_snapshot: Annotated[str, TaskCreate.model_fields["title"]]
    undone_at: AwareDatetime | None
    undone_by: UUID | None
    duplicate_of: UUID | None


class ReseedTimer(TimerCreate, ReseedRow):
    pet_id: UUID | None
    started_by: UUID
    cancelled_at: AwareDatetime | None


class ReseedWalk(WalkCreate, ReseedDeletedRow):
    user_id: UUID
    status: Literal["active", "finished", "discarded"]
    ended_at: AwareDatetime | None
    paused_ms: Annotated[int, WalkFinish.model_fields["paused_ms"]]
    distance_m: Annotated[Decimal, WalkFinish.model_fields["distance_m"]]
    duration_s: Annotated[int, WalkFinish.model_fields["duration_s"]]
    avg_pace_s_per_km: Annotated[
        int | None, WalkFinish.model_fields["avg_pace_s_per_km"]
    ]
    point_count: int
    has_route: bool
    preview: Annotated[list[tuple[float, float]], WalkFinish.model_fields["preview"]]
    note: str | None


class ReseedWalkRoute(ReseedInputRow):
    walk_id: UUID
    points: Annotated[list[RoutePoint], WalkFinish.model_fields["route"]]


class ReseedMemberChange(RequestBody):
    entity: Literal["members"]
    row: ReseedMember


class ReseedFamilyChange(RequestBody):
    entity: Literal["family"]
    row: ReseedFamily


class ReseedPetChange(RequestBody):
    entity: Literal["pets"]
    row: ReseedPet


class ReseedWeightEntryChange(RequestBody):
    entity: Literal["weight_entries"]
    row: ReseedWeightEntry


class ReseedHealthEventChange(RequestBody):
    entity: Literal["health_events"]
    row: ReseedHealthEvent


class ReseedTaskTemplateChange(RequestBody):
    entity: Literal["task_templates"]
    row: ReseedTaskTemplate


class ReseedCompletionChange(RequestBody):
    entity: Literal["task_completions"]
    row: ReseedCompletion


class ReseedTimerChange(RequestBody):
    entity: Literal["task_timers"]
    row: ReseedTimer


class ReseedWalkChange(RequestBody):
    entity: Literal["walk_sessions"]
    row: ReseedWalk


class ReseedWalkRouteChange(RequestBody):
    entity: Literal["walk_routes"]
    row: ReseedWalkRoute


type ReseedChange = Annotated[
    ReseedMemberChange
    | ReseedFamilyChange
    | ReseedPetChange
    | ReseedWeightEntryChange
    | ReseedHealthEventChange
    | ReseedTaskTemplateChange
    | ReseedCompletionChange
    | ReseedTimerChange
    | ReseedWalkChange
    | ReseedWalkRouteChange,
    Field(discriminator="entity"),
]


class ReseedRequest(RequestBody):
    rows: list[ReseedChange] = Field(max_length=500)


class ReseedResult(BaseModel):
    inserted: int
    updated: int
    unchanged: int
    duplicates: int
    refused: int
