from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FamilyPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(default_factory=str, min_length=1, max_length=60)
    timezone: str = Field(default_factory=str)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Timezone must be an IANA name.") from exc
        return value


class RoleChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["leader", "member"]


class Invite(BaseModel):
    code: str
    role: Literal["leader", "member"]
    expires_at: datetime
