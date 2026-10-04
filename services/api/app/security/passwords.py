import asyncio

from argon2 import PasswordHasher

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_semaphore = asyncio.Semaphore(2)


async def hash_password(password: str) -> str:
    raise NotImplementedError("not implemented")


async def verify_password(password: str, password_hash: str) -> bool:
    raise NotImplementedError("not implemented")
