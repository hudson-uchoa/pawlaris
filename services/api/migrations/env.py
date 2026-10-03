"""Async migrations; credentials stay out of the configuration file."""

import asyncio

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import create_async_engine

from app.settings import Settings

config = context.config


def database_url() -> str:
    configured: object = config.attributes.get("database_url")
    if isinstance(configured, str):
        return configured
    return Settings().database_url.get_secret_value()


def migrate(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        context.run_migrations()


async def run_async() -> None:
    engine = create_async_engine(database_url(), poolclass=pool.NullPool)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(migrate)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    context.configure(url=database_url(), target_metadata=None, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(run_async())
