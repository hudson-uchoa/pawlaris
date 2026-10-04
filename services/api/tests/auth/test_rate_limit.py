import asyncio
import secrets
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.clock import FrozenClock
from app.errors import ApiError
from app.schemas.auth import Login
from app.security.ratelimit import LoginRateLimiter
from app.services.auth import login
from tests.auth.conftest import LoginAccount


async def test_r1_5_twenty_simultaneous_failures_reserve_only_five_slots(
    client: AsyncClient,
    account: LoginAccount,
) -> None:
    body = {"email": account.user.email, "password": secrets.token_urlsafe(24)}
    responses = await asyncio.wait_for(
        asyncio.gather(
            *(client.post("/api/v1/auth/login", json=body) for _ in range(20))
        ),
        timeout=20,
    )
    statuses = [response.status_code for response in responses]
    assert statuses.count(401) == 5
    assert statuses.count(429) == 15


async def test_r1_5_cancelled_attempt_returns_its_slot(
    app: FastAPI,
    account: LoginAccount,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered = asyncio.Event()
    blocked = asyncio.Event()

    async def cancel_check(password: str, encoded: str) -> bool:
        entered.set()
        await blocked.wait()
        return False

    monkeypatch.setattr("app.services.auth.verify_password", cancel_check)
    async with app.state.session_factory() as session:
        task = asyncio.create_task(
            login(
                session,
                Login.model_validate(account.body()),
                frozen_clock,
                app.state.settings,
                app.state.login_limiter,
            )
        )
        await asyncio.wait_for(entered.wait(), timeout=5)
        assert app.state.login_limiter.tracked_emails == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=5)
    assert app.state.login_limiter.tracked_emails == 0


async def test_r1_5_internal_failure_returns_its_slot(
    client: AsyncClient,
    account: LoginAccount,
    app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_check(password: str, encoded: str) -> bool:
        raise RuntimeError("Password operation failed.")

    monkeypatch.setattr("app.services.auth.verify_password", fail_check)
    for _ in range(6):
        assert (
            await client.post("/api/v1/auth/login", json=account.body())
        ).status_code == 500
    assert app.state.login_limiter.tracked_emails == 0


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
    success = account.body()
    success["email"] = success["email"].upper()
    assert (await client.post("/api/v1/auth/login", json=success)).status_code == 200
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
        limiter.check(oldest)
    for i in range(10000):
        frozen_clock.advance(timedelta(seconds=3))
        limiter.check(f"{i}@example.invalid")
    assert limiter.tracked_emails == 10000
    assert oldest not in limiter._failures
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
            first.check(email)
        second.check(email)
        assert second.tracked_emails == 1
    finally:
        await second_app.state.engine.dispose()


@pytest.mark.parametrize("email_wait", [20, 90])
def test_r1_5_retry_after_uses_longer_email_or_global_wait(
    frozen_clock: FrozenClock,
    email_wait: int,
) -> None:
    limiter = LoginRateLimiter(frozen_clock)
    email = f"{secrets.token_hex(12)}@example.invalid"
    for _ in range(5):
        limiter.check(email)
    frozen_clock.advance(timedelta(seconds=900 - email_wait))
    for i in range(30):
        limiter.check(f"{i}@example.invalid")
    with pytest.raises(ApiError) as caught:
        limiter.check(email.upper())
    assert caught.value.headers["Retry-After"] == str(max(email_wait, 60))


def test_r1_5_success_clears_counter_with_different_email_case(
    frozen_clock: FrozenClock,
) -> None:
    limiter = LoginRateLimiter(frozen_clock)
    email = f"{secrets.token_hex(12)}@example.invalid"
    for _ in range(5):
        limiter.check(email)
    limiter.success(email.upper())
    for _ in range(5):
        limiter.check(email)
    with pytest.raises(ApiError) as caught:
        limiter.check(email)
    assert caught.value.status == 429
