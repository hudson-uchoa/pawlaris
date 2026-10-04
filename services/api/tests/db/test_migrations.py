from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.models import Base
from tests.factories import ScratchDatabase, migrate


async def test_migrations_upgrade_downgrade_upgrade(
    scratch_database: ScratchDatabase,
) -> None:
    async with scratch_database() as url:
        for direction, revision in (
            ("upgrade", "head"),
            ("downgrade", "base"),
            ("upgrade", "head"),
        ):
            await migrate(url, direction, revision)
            engine = create_async_engine(url)
            try:
                async with engine.connect() as connection:
                    tables = set(
                        (
                            await connection.execute(
                                text(
                                    "SELECT tablename FROM "
                                    "pg_tables WHERE schemaname = "
                                    "'public'"
                                )
                            )
                        ).scalars()
                    ) - {"alembic_version"}
                    assert tables == (
                        set(Base.metadata.tables) if direction == "upgrade" else set()
                    )
                    types = set(
                        (
                            await connection.execute(
                                text(
                                    "SELECT typname FROM pg_type "
                                    "JOIN pg_namespace n ON n.oid "
                                    "= typnamespace"
                                    "WHERE typtype = 'e' AND n.nspname = 'public'"
                                )
                            )
                        ).scalars()
                    )
                    assert len(types) == (9 if direction == "upgrade" else 0)
                    functions = set(
                        (
                            await connection.execute(
                                text(
                                    "SELECT proname FROM pg_proc "
                                    "JOIN pg_namespace n ON n.oid "
                                    "= pronamespace"
                                    "WHERE n.nspname = 'public' AND proname IN "
                                    "('bump_revision', "
                                    "'bump_revision_family', "
                                    "'forbid_delete')"
                                )
                            )
                        ).scalars()
                    )
                    assert functions == (
                        {"bump_revision", "bump_revision_family", "forbid_delete"}
                        if direction == "upgrade"
                        else set()
                    )
                    extension = (
                        await connection.execute(
                            text(
                                "SELECT count(*) FROM "
                                "pg_extension WHERE extname = "
                                "'citext'"
                            )
                        )
                    ).scalar_one()
                    assert extension == (1 if direction == "upgrade" else 0)
                    if direction == "upgrade":
                        epoch = (
                            await connection.execute(
                                text("SELECT sync_epoch FROM server_meta")
                            )
                        ).scalar_one()
                        assert epoch.version == 4
            finally:
                await engine.dispose()
