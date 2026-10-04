import asyncio
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from argon2 import extract_parameters
from argon2.exceptions import VerifyMismatchError
from argon2.low_level import Type

from app.security import passwords


async def test_r1_4_hash_uses_fixed_argon2id_parameters_and_random_salt() -> None:
    password = secrets.token_urlsafe(24)
    first = await passwords.hash_password(password)
    second = await passwords.hash_password(password)
    parameters = extract_parameters(first)
    assert parameters.type == Type.ID
    assert (parameters.memory_cost, parameters.time_cost, parameters.parallelism) == (
        19456,
        2,
        1,
    )
    assert bool(first != second)
    assert bool(password not in first)
    assert await passwords.verify_password(password, first)
    assert await passwords.verify_password(password, second)


async def test_r1_4_wrong_password_and_malformed_hash_do_not_verify() -> None:
    password = secrets.token_urlsafe(24)
    encoded = await passwords.hash_password(password)
    assert not await passwords.verify_password(secrets.token_urlsafe(24), encoded)
    assert not await passwords.verify_password(password, secrets.token_hex(24))


async def test_r1_4_hash_and_verify_share_two_slots_off_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loop_thread = threading.get_ident()
    release = threading.Event()
    entered = threading.Event()
    lock = threading.Lock()
    active = maximum = calls = 0
    on_loop = False

    def observe() -> None:
        nonlocal active, maximum, calls, on_loop
        with lock:
            active += 1
            calls += 1
            maximum = max(maximum, active)
            on_loop |= threading.get_ident() == loop_thread
            if active == 2:
                entered.set()
        release.wait(timeout=2)
        with lock:
            active -= 1

    class Hasher:
        def hash(self, password: str) -> str:
            observe()
            return secrets.token_hex(24)

        def verify(self, encoded: str, password: str) -> bool:
            observe()
            return True

    monkeypatch.setattr(passwords, "_hasher", Hasher())
    password, encoded = secrets.token_urlsafe(24), secrets.token_hex(24)
    tasks = [
        asyncio.create_task(
            passwords.hash_password(password)
            if i % 2 == 0
            else passwords.verify_password(password, encoded)
        )
        for i in range(6)
    ]
    # A separate observer thread leaves all default executor slots for Argon2.
    observer = ThreadPoolExecutor(max_workers=1)
    try:
        assert await asyncio.get_running_loop().run_in_executor(
            observer, entered.wait, 1
        )
        await asyncio.sleep(0)
        with lock:
            assert active == 2
            assert not on_loop
        assert all(not task.done() for task in tasks)
    finally:
        release.set()
        await asyncio.gather(*tasks)
        observer.shutdown()
    assert calls == 6
    assert maximum == 2


async def test_r1_4_cancelled_jobs_keep_their_slot_until_the_thread_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    release = threading.Event()
    two_started = threading.Event()
    third_started = threading.Event()
    lock = threading.Lock()
    calls = 0

    class Hasher:
        def hash(self, password: str) -> str:
            nonlocal calls
            with lock:
                calls += 1
                if calls == 2:
                    two_started.set()
                if calls == 3:
                    third_started.set()
            release.wait(timeout=2)
            return secrets.token_hex(24)

    monkeypatch.setattr(passwords, "_hasher", Hasher())
    credential = secrets.token_urlsafe(24)
    tasks = [asyncio.create_task(passwords.hash_password(credential)) for _ in range(2)]
    observer = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_running_loop()
    try:
        assert await loop.run_in_executor(observer, two_started.wait, 1)
        tasks[0].cancel()
        tasks.append(asyncio.create_task(passwords.hash_password(credential)))
        assert not await loop.run_in_executor(observer, third_started.wait, 0.1)
    finally:
        release.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        observer.shutdown()
    assert isinstance(results[0], asyncio.CancelledError)
    assert third_started.is_set()


@pytest.mark.parametrize("use_timeout", [False, True])
async def test_r1_cancelled_wrong_password_preserves_cancellation_and_slot(
    monkeypatch: pytest.MonkeyPatch, use_timeout: bool
) -> None:
    release = threading.Event()
    two_started = threading.Event()
    third_started = threading.Event()
    lock = threading.Lock()
    calls = 0
    deadline: asyncio.Timeout | None = None

    class Hasher:
        def verify(self, encoded: str, password: str) -> bool:
            nonlocal calls
            with lock:
                calls += 1
                if calls == 2:
                    two_started.set()
                if calls == 3:
                    third_started.set()
            release.wait(timeout=2)
            raise VerifyMismatchError("Password does not match.")

    async def verify() -> bool:
        nonlocal deadline
        async with asyncio.timeout(None) as deadline:
            return await passwords.verify_password(credential, encoded)

    monkeypatch.setattr(passwords, "_hasher", Hasher())
    credential, encoded = secrets.token_urlsafe(24), secrets.token_hex(24)
    tasks = [
        asyncio.create_task(verify()),
        asyncio.create_task(passwords.verify_password(credential, encoded)),
    ]
    observer = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_running_loop()
    try:
        assert await loop.run_in_executor(observer, two_started.wait, 1)
        if use_timeout:
            assert deadline is not None
            deadline.reschedule(loop.time())
        else:
            tasks[0].cancel()
        tasks.append(
            asyncio.create_task(passwords.verify_password(credential, encoded))
        )
        assert not await loop.run_in_executor(observer, third_started.wait, 0.1)
    finally:
        release.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        observer.shutdown()
    assert isinstance(
        results[0], TimeoutError if use_timeout else asyncio.CancelledError
    )
    assert results[1:] == [False, False]
    assert third_started.is_set()
