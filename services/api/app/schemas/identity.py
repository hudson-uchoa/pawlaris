"""Identity palette validation shared by member and pet contracts."""

from typing import Annotated

from pydantic import AfterValidator, Field

from app.cli import IDENTITY_KEYS


def validate_identity_color(value: str) -> str:
    if value not in IDENTITY_KEYS:
        raise ValueError("Color must be an identity key.")
    return value


type IdentityColor = Annotated[
    str,
    AfterValidator(validate_identity_color),
    Field(json_schema_extra={"enum": list(IDENTITY_KEYS)}),
]
