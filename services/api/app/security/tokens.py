import hashlib
import secrets
from datetime import timedelta
from typing import Literal
from uuid import UUID

import jwt
from pydantic import BaseModel, ConfigDict, StrictInt, ValidationError

from app.clock import Clock
from app.errors import ApiError
from app.models import AppUser
from app.settings import Settings


class AccessClaims(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sub: UUID
    fam: UUID
    role: Literal["leader", "member"]
    exp: StrictInt
    iat: StrictInt


def issue_access(user: AppUser, clock: Clock, settings: Settings) -> str:
    now = clock.now()
    claims = AccessClaims.model_validate(
        {
            "sub": user.id,
            "fam": user.family_id,
            "role": user.role,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=15)).timestamp()),
        }
    )
    return jwt.encode(
        claims.model_dump(mode="json"),
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def decode_access(token: str, clock: Clock, settings: Settings) -> AccessClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            options={
                "require": ["sub", "fam", "role", "exp", "iat"],
                # PyJWT's time checks use its wall clock; validate against ours below.
                "verify_exp": False,
                "verify_iat": False,
                "verify_nbf": False,
            },
        )
        claims = AccessClaims.model_validate(payload)
        now = clock.now().timestamp()
        if claims.exp <= now or claims.iat > now or claims.exp <= claims.iat:
            raise ApiError(401, "token_invalid", "Invalid or expired access token.")
        return claims
    except (jwt.InvalidTokenError, ValidationError):
        raise ApiError(
            401, "token_invalid", "Invalid or expired access token."
        ) from None


def new_refresh_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode("ascii")).hexdigest()
