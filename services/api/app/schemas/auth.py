from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.schemas.body import RequestBody


class Login(RequestBody):
    email: str
    password: SecretStr


class Redeem(RequestBody):
    code: str
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=40)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if (
            any(char.isspace() for char in value)
            or "@" not in value[1:-1]
            or value.startswith("@")
            or value.endswith("@")
            or value.rsplit("@", 1)[-1].lower() == "pawlaris.invalid"
        ):
            raise ValueError("Email must be a non-reserved address without whitespace.")
        return value


class Refresh(RequestBody):
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


class MePatch(RequestBody):
    display_name: str = Field(min_length=1, max_length=40)


class PasswordChange(RequestBody):
    current_password: SecretStr
    new_password: SecretStr = Field(min_length=8, max_length=128)
