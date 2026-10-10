from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"]
    db: bool
    disk_free_mb: int = Field(ge=0)
    version: str
    uptime_s: int = Field(ge=0)
    role: Literal["primary", "reserve"]
