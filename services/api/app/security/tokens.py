from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictInt

from app.clock import Clock
from app.models import AppUser
from app.settings import Settings


class AccessClaims(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sub: UUID
    fam: UUID
    role: Literal["leader", "member"]
    exp: StrictInt
    iat: StrictInt


def issue_access(
    user: AppUser, clock: Clock, *, settings: Settings | None = None
) -> str:
    raise NotImplementedError("not implemented")


def decode_access(
    token: str, clock: Clock, *, settings: Settings | None = None
) -> AccessClaims:
    raise NotImplementedError("not implemented")


def new_refresh_token() -> tuple[str, str]:
    raise NotImplementedError("not implemented")
