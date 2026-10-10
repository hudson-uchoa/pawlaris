from datetime import timedelta
from typing import Self
from uuid import UUID

from pydantic import UUID4, AwareDatetime, Field, model_validator

from app.schemas.body import RequestBody


class TimerCreate(RequestBody):
    id: UUID4
    task_id: UUID
    occurrence_key: str = Field(
        pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2})?\z"
    )
    pet_id: UUID | None = None
    started_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def duration_is_positive_and_at_most_24_hours(self) -> Self:
        if self.ends_at <= self.started_at:
            raise ValueError("Timer must end after it starts.")
        if self.ends_at - self.started_at > timedelta(hours=24):
            raise ValueError("Timer duration must not exceed 24 hours.")
        return self
