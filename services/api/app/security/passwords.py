import asyncio
from collections.abc import Callable

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, type=Type.ID)
_semaphore = asyncio.Semaphore(2)


async def _run[T](operation: Callable[[], T]) -> T:
    async with _semaphore:
        worker = asyncio.create_task(asyncio.to_thread(operation))
        try:
            return await asyncio.shield(worker)
        except asyncio.CancelledError:
            # Cancelling an await cannot stop Argon2's thread. Keep its slot held.
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    continue
            worker.result()
            raise


async def hash_password(password: str) -> str:
    return await _run(lambda: _hasher.hash(password))


async def verify_password(password: str, password_hash: str) -> bool:
    try:
        return await _run(lambda: _hasher.verify(password_hash, password))
    except (VerificationError, InvalidHashError):
        return False
