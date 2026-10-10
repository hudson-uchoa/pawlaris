import re
from datetime import date as Date
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import UUID4, BeforeValidator, Field, field_validator, model_validator

from app.schemas.body import RequestBody

type Category = Literal[
    "feeding", "medication", "hygiene", "litter", "play", "vet", "other"
]
type Weekday = Literal["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def _json_integer(value: object) -> object:
    # Match Number.isInteger in the shared validator, without coercing strings
    # or booleans. An integral JSON number such as 1.0 is still an integer.
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError("Expected an integer.")
    return value


def _calendar_date(value: object) -> object:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None
    ):
        raise ValueError("Expected a YYYY-MM-DD date.")
    return value


type CalendarDate = Annotated[Date, BeforeValidator(_calendar_date)]
type Interval = Annotated[int, BeforeValidator(_json_integer), Field(ge=1, le=365)]
type MonthDay = Annotated[int, BeforeValidator(_json_integer), Field(ge=1, le=31)]
type TimeOfDay = Annotated[
    str, Field(min_length=5, max_length=5, pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
]


class Daily(RequestBody):
    freq: Literal["daily"]
    interval: Interval


class Weekly(RequestBody):
    freq: Literal["weekly"]
    interval: Interval
    byday: list[Weekday] = Field(min_length=1, max_length=7)

    @field_validator("byday")
    @classmethod
    def unique_days(cls, value: list[Weekday]) -> list[Weekday]:
        if len(value) != len(set(value)):
            raise ValueError("Weekdays must be unique.")
        return value


class Monthly(RequestBody):
    freq: Literal["monthly"]
    interval: Interval
    bymonthday: list[MonthDay] = Field(min_length=1, max_length=31)

    @field_validator("bymonthday")
    @classmethod
    def unique_days(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("Month days must be unique.")
        return value


class Once(RequestBody):
    freq: Literal["once"]
    date: CalendarDate


type Recurrence = Annotated[
    Daily | Weekly | Monthly | Once, Field(discriminator="freq")
]


class TaskPatch(RequestBody):
    title: str = Field(default_factory=str, min_length=1, max_length=80)
    description: str | None = None
    category: Category = "other"
    assigned_to: UUID | None = None
    requires_photo: bool = False
    timer_seconds: int | None = Field(default=None, ge=1, le=86400)
    reminder_class: Literal["critical", "routine"] = "routine"
    sort_order: int = Field(default=0, ge=-(2**31), le=2**31 - 1)
    ends_on: CalendarDate | None = None


class TaskCreate(TaskPatch):
    id: UUID4
    title: str = Field(min_length=1, max_length=80)
    recurrence: Recurrence
    times_of_day: list[TimeOfDay] = Field(default_factory=list, max_length=8)
    starts_on: CalendarDate
    pet_ids: list[UUID] = Field(min_length=1)
    completion_mode: Literal["together", "per_pet"] = "together"
    replaces_task_id: UUID | None = None

    @field_validator("times_of_day")
    @classmethod
    def sorted_unique_times(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)) or value != sorted(value):
            raise ValueError("Times must be sorted and unique.")
        return value

    @model_validator(mode="after")
    def once_starts_on_its_date(self) -> Self:
        if isinstance(self.recurrence, Once) and self.starts_on != self.recurrence.date:
            raise ValueError("A once template must start on its recurrence date.")
        return self
