import secrets
from datetime import timedelta

from fastapi import FastAPI
from httpx import AsyncClient

from app.clock import FrozenClock
from app.security.ratelimit import LoginRateLimiter
from tests.auth.conftest import LoginAccount


async def test_r1_5_five_failures_block_sixth_until_sliding_window_frees_slot(
    client: AsyncClient,
    account: LoginAccount,
    frozen_clock: FrozenClock,
) -> None:
    body = {"email": account.user.email, "password": secrets.token_urlsafe(24)}
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 401
    frozen_clock.advance(timedelta(minutes=1))
    body["email"] = body["email"].upper()
    for _ in range(4):
        assert (await client.post("/api/v1/auth/login", json=body)).status_code == 401
    response = await client.post("/api/v1/auth/login", json=account.body())
    assert response.status_code == 429
    assert response.json()["code"] == "rate_limited"
    assert response.headers["Retry-After"] == "840"
    frozen_clock.advance(timedelta(seconds=839))
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 429
    frozen_clock.advance(timedelta(seconds=1))
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 401
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 429


async def test_r1_5_success_resets_email_failure_counter(
    client: AsyncClient,
    account: LoginAccount,
) -> None:
    body = {"email": account.user.email, "password": secrets.token_urlsafe(24)}
    for _ in range(4):
        assert (await client.post("/api/v1/auth/login", json=body)).status_code == 401
    assert (
        await client.post("/api/v1/auth/login", json=account.body())
    ).status_code == 200
    for _ in range(5):
        assert (await client.post("/api/v1/auth/login", json=body)).status_code == 401
    assert (await client.post("/api/v1/auth/login", json=body)).status_code == 429


async def test_r1_5_global_login_cap_counts_successes_and_frees_at_one_minute(
    client: AsyncClient,
    account: LoginAccount,
    frozen_clock: FrozenClock,
) -> None:
    for _ in range(30):
        assert (
            await client.post("/api/v1/auth/login", json=account.body())
        ).status_code == 200
    response = await client.post("/api/v1/auth/login", json=account.body())
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    frozen_clock.advance(timedelta(seconds=59))
    assert (
        await client.post("/api/v1/auth/login", json=account.body())
    ).status_code == 429
    frozen_clock.advance(timedelta(seconds=1))
    assert (
        await client.post("/api/v1/auth/login", json=account.body())
    ).status_code == 200


def test_r1_5_email_map_evicts_oldest_at_ten_thousand(
    frozen_clock: FrozenClock,
) -> None:
    limiter = LoginRateLimiter(frozen_clock)
    oldest = f"{secrets.token_hex(12)}@example.invalid"
    for _ in range(5):
        limiter.failure(oldest)
    for i in range(10000):
        limiter.failure(f"{i}@example.invalid")
    assert limiter.tracked_emails == 10000
    limiter.check(oldest)


async def test_r1_5_rate_limit_state_is_per_application(
    app: FastAPI,
    frozen_clock: FrozenClock,
) -> None:
    from app.main import create_app

    first = app.state.login_limiter
    second_app = create_app(app.state.settings, frozen_clock)
    try:
        second = second_app.state.login_limiter
        email = f"{secrets.token_hex(12)}@example.invalid"
        for _ in range(5):
            first.failure(email)
        second.check(email)
        assert second.tracked_emails == 0
    finally:
        await second_app.state.engine.dispose()
