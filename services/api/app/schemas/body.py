from math import isfinite

from pydantic import BaseModel, ConfigDict, model_validator


def _validate_body_values(value: object) -> None:
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("Strings must not contain U+0000.")
    elif isinstance(value, float):
        if not isfinite(value):
            raise ValueError("Numbers must be finite.")
    elif isinstance(value, dict):
        for key, item in value.items():
            _validate_body_values(key)
            _validate_body_values(item)
    elif isinstance(value, list):
        for item in value:
            _validate_body_values(item)


class RequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def validate_body_values(cls, value: object) -> object:
        # Inspect raw JSON before fields such as SecretStr hide their values.
        _validate_body_values(value)
        return value
