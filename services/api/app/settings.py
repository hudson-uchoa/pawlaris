from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: SecretStr
    jwt_secret: SecretStr
    blob_dir: Path = Path("/data/blobs")
    push_enabled: bool = True
    server_role: Literal["primary", "reserve"] = "primary"
    app_version: str = "dev"
    log_level: str = "INFO"
    ws_auth_timeout_seconds: float = Field(default=5, gt=0)
    ws_sweep_seconds: float = Field(default=30, gt=0)

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value().encode("utf-8")) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 bytes")
        return value
