from pydantic import BaseModel, ConfigDict, model_validator


def _reject_null_character(value: object) -> None:
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("Strings must not contain U+0000.")
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_null_character(key)
            _reject_null_character(item)
    elif isinstance(value, list):
        for item in value:
            _reject_null_character(item)


class RequestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def validate_strings(cls, value: object) -> object:
        # Inspect raw JSON before fields such as SecretStr hide their values.
        _reject_null_character(value)
        return value
