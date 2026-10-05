from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import rows


class SyncModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FamilyChange(SyncModel):
    entity: Literal["family"]
    row: rows.Family


class MemberChange(SyncModel):
    entity: Literal["members"]
    row: rows.Member


class PetChange(SyncModel):
    entity: Literal["pets"]
    row: rows.Pet


class WeightChange(SyncModel):
    entity: Literal["weight_entries"]
    row: rows.WeightEntry


class HealthChange(SyncModel):
    entity: Literal["health_events"]
    row: rows.HealthEvent


class TaskChange(SyncModel):
    entity: Literal["task_templates"]
    row: rows.TaskTemplate


class CompletionChange(SyncModel):
    entity: Literal["task_completions"]
    row: rows.Completion


class TimerChange(SyncModel):
    entity: Literal["task_timers"]
    row: rows.Timer


class WalkChange(SyncModel):
    entity: Literal["walk_sessions"]
    row: rows.Walk


class AssetChange(SyncModel):
    entity: Literal["assets"]
    row: rows.Asset


type Change = Annotated[
    FamilyChange
    | MemberChange
    | PetChange
    | WeightChange
    | HealthChange
    | TaskChange
    | CompletionChange
    | TimerChange
    | WalkChange
    | AssetChange,
    Field(discriminator="entity"),
]


class SyncPage(SyncModel):
    revision: int
    has_more: bool
    changes: list[Change]


class SyncResponse(SyncPage):
    epoch: UUID
    server_time: datetime
