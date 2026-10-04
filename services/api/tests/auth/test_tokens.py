import base64
import hashlib
import secrets
from datetime import timedelta
from uuid import uuid4

import jwt
import pytest
from pydantic import SecretStr

from app.clock import FrozenClock
from app.errors import ApiError
from app.models import AppUser
from app.security.tokens import decode_access, issue_access, new_refresh_token
from app.settings import Settings


@pytest.fixture
def token_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"jwt_secret": SecretStr(secrets.token_hex(32))})


@pytest.fixture
def user() -> AppUser:
    return AppUser(id=uuid4(), family_id=uuid4(), role="leader")


def test_r1_6_access_contains_only_the_signed_identity_and_clock_claims(
    user: AppUser, frozen_clock: FrozenClock, token_settings: Settings
) -> None:
    token = issue_access(user, frozen_clock, settings=token_settings)
    assert jwt.get_unverified_header(token)["alg"] == "HS256"
    claims = decode_access(token, frozen_clock, settings=token_settings)
    assert claims.sub == user.id
    assert claims.fam == user.family_id
    assert claims.role == user.role
    assert claims.iat == int(frozen_clock.now().timestamp())
    assert claims.exp == claims.iat + 900
    assert set(claims.model_dump()) == {"sub", "fam", "role", "exp", "iat"}


def test_r1_6_access_expires_at_exactly_fifteen_minutes(
    user: AppUser, frozen_clock: FrozenClock, token_settings: Settings
) -> None:
    token = issue_access(user, frozen_clock, settings=token_settings)
    frozen_clock.advance(timedelta(seconds=899))
    decode_access(token, frozen_clock, settings=token_settings)
    frozen_clock.advance(timedelta(seconds=1))
    with pytest.raises(ApiError) as caught:
        decode_access(token, frozen_clock, settings=token_settings)
    assert (caught.value.status, caught.value.code) == (401, "token_invalid")


@pytest.mark.parametrize("fault", ["signature", "HS384", "none", "malformed"])
def test_r1_6_invalid_signatures_algorithms_and_encoding_are_rejected(
    user: AppUser, frozen_clock: FrozenClock, token_settings: Settings, fault: str
) -> None:
    token = issue_access(user, frozen_clock, settings=token_settings)
    claims = decode_access(token, frozen_clock, settings=token_settings).model_dump(
        mode="json"
    )
    if fault == "signature":
        token = jwt.encode(claims, secrets.token_hex(32), algorithm="HS256")
    elif fault in {"HS384", "none"}:
        token = jwt.encode(
            claims,
            token_settings.jwt_secret.get_secret_value() if fault == "HS384" else "",
            algorithm=fault,
        )
    else:
        token = secrets.token_urlsafe(24)
    with pytest.raises(ApiError) as caught:
        decode_access(token, frozen_clock, settings=token_settings)
    assert (caught.value.status, caught.value.code) == (401, "token_invalid")
    assert bool(token not in str(caught.value))


@pytest.mark.parametrize("field", ["sub", "fam", "role", "exp", "iat"])
def test_r1_6_access_requires_every_identity_and_time_claim(
    user: AppUser, frozen_clock: FrozenClock, token_settings: Settings, field: str
) -> None:
    token = issue_access(user, frozen_clock, settings=token_settings)
    claims = decode_access(token, frozen_clock, settings=token_settings).model_dump(
        mode="json"
    )
    del claims[field]
    token = jwt.encode(
        claims, token_settings.jwt_secret.get_secret_value(), algorithm="HS256"
    )
    with pytest.raises(ApiError) as caught:
        decode_access(token, frozen_clock, settings=token_settings)
    assert (caught.value.status, caught.value.code) == (401, "token_invalid")


def test_r1_6_refresh_is_32_random_bytes_base64url_and_stored_as_sha256() -> None:
    first, digest = new_refresh_token()
    second, second_digest = new_refresh_token()
    assert len(base64.urlsafe_b64decode(first + "=" * (-len(first) % 4))) == 32
    assert all(char.isalnum() or char in "-_" for char in first)
    assert bool(first != second and digest != second_digest)
    assert len(digest) == 64
    assert bool(digest == hashlib.sha256(first.encode()).hexdigest())


@pytest.mark.parametrize(
    "fault", ["user_id", "family_id", "role", "expiry_type", "future_issued"]
)
def test_r1_6_malformed_or_future_claims_are_token_invalid(
    user: AppUser, frozen_clock: FrozenClock, token_settings: Settings, fault: str
) -> None:
    token = issue_access(user, frozen_clock, settings=token_settings)
    claims = decode_access(token, frozen_clock, settings=token_settings).model_dump(
        mode="json"
    )
    if fault == "user_id":
        claims["sub"] = secrets.token_hex(3)
    elif fault == "family_id":
        claims["fam"] = secrets.token_hex(3)
    elif fault == "role":
        claims["role"] = "admin"
    elif fault == "expiry_type":
        claims["exp"] = str(claims["exp"])
    else:
        claims["iat"] = int(frozen_clock.now().timestamp()) + 1
    token = jwt.encode(
        claims, token_settings.jwt_secret.get_secret_value(), algorithm="HS256"
    )
    with pytest.raises(ApiError) as caught:
        decode_access(token, frozen_clock, settings=token_settings)
    assert (caught.value.status, caught.value.code) == (401, "token_invalid")
