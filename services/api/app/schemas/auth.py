from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class AuthBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(AuthBody):
    email: str
    password: SecretStr


class Redeem(AuthBody):
    code: str
    email: str
    password: SecretStr = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=40)


class Refresh(AuthBody):
    refresh_token: SecretStr


class Me(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    email: str
    display_name: str
    role: Literal["leader", "member"]
    color: str
    family_id: UUID


class Session(BaseModel):
    access_token: str
    refresh_token: str
    access_expires_at: datetime
    user: Me


class MePatch(AuthBody):
    display_name: str = Field(min_length=1, max_length=40)


class PasswordChange(AuthBody):
    current_password: SecretStr
    new_password: SecretStr = Field(min_length=8, max_length=128)
