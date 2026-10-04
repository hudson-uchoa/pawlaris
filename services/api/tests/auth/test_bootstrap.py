import asyncio
import getpass
import os
import secrets
import sys
from collections.abc import Sequence

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.cli import main
from app.models import AppUser, Family
from app.security.passwords import verify_password
from tests.factories import API_ROOT, ScratchDatabase


async def run_bootstrap(
    url: str, users: Sequence[str], credentials: Sequence[str], *, timezone: str = "UTC"
) -> tuple[int | None, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("PAWLARIS_PASSWORD_")
    }
    environment.update(DATABASE_URL=url, JWT_SECRET=secrets.token_hex(32))
    environment.update(
        {
            f"PAWLARIS_PASSWORD_{i}": password
            for i, password in enumerate(credentials, start=1)
        }
    )
    arguments = ["--family", "Test household", "--timezone", timezone]
    for user in users:
        arguments.extend(["--user", user])
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.cli",
        "bootstrap",
        *arguments,
        cwd=API_ROOT,
        env=environment,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return process.returncode, (stdout + stderr).decode()


async def test_r1_2_bootstrap_creates_family_members_identity_keys_and_refuses_repeat(
    scratch_database: ScratchDatabase,
) -> None:
    credentials = [secrets.token_urlsafe(24) for _ in range(3)]
    users = [
        f"Member {i}:{secrets.token_hex(8)}@example.invalid:{role}"
        for i, role in enumerate(["member", "leader", "leader"])
    ]
    async with scratch_database() as url:
        code, output = await run_bootstrap(
            url, users, credentials, timezone="America/Sao_Paulo"
        )
        assert code == 0
        assert all(password not in output for password in credentials)
        assert bool(url not in output)
        engine = create_async_engine(url)
        try:
            async with AsyncSession(engine) as session:
                family = (await session.execute(select(Family))).scalar_one()
                members = (await session.execute(select(AppUser))).scalars().all()
                assert family.name == "Test household"
                assert family.timezone == "America/Sao_Paulo"
                assert len(members) == 3
                by_name = {member.display_name: member for member in members}
                for i, key in enumerate(["#5B7DB1", "#B15B6B", "#4F8A6B"]):
                    member = by_name[f"Member {i}"]
                    assert member.color == key
                    assert member.family_id == family.id
                    assert member.role == users[i].rsplit(":", 1)[1]
                    assert member.email == users[i].split(":")[1]
                    assert member.id.version == 4
                    assert await verify_password(credentials[i], member.password_hash)
                ids = {member.id for member in members}
            code, output = await run_bootstrap(url, users, credentials)
            assert code == 1
            assert "already exists" in output
            async with AsyncSession(engine) as session:
                assert (
                    await session.scalar(select(func.count()).select_from(Family)) == 1
                )
                assert set((await session.scalars(select(AppUser.id))).all()) == ids
        finally:
            await engine.dispose()


@pytest.mark.parametrize(
    "fault",
    [
        "no_leader",
        "timezone",
        "role",
        "duplicate_email",
        "short_password",
        "long_password",
    ],
)
async def test_r1_2_invalid_bootstrap_leaves_no_partial_family(
    scratch_database: ScratchDatabase, fault: str
) -> None:
    email = f"{secrets.token_hex(8)}@example.invalid"
    users = [f"First:{email}:leader"]
    credentials = [secrets.token_urlsafe(24)]
    timezone = "UTC"
    if fault == "no_leader":
        users = [f"First:{email}:member"]
    elif fault == "timezone":
        timezone = "Invalid/Timezone"
    elif fault == "role":
        users = [f"First:{email}:admin"]
    elif fault == "duplicate_email":
        users.append(f"Second:{email.upper()}:member")
        credentials.append(secrets.token_urlsafe(24))
    elif fault == "short_password":
        credentials = [secrets.token_hex(3)]
    else:
        credentials = [secrets.token_hex(65)]
    async with scratch_database() as url:
        code, output = await run_bootstrap(url, users, credentials, timezone=timezone)
        assert code == 1
        assert "Traceback" not in output
        assert all(password not in output for password in credentials)
        assert bool(url not in output)
        engine = create_async_engine(url)
        try:
            async with AsyncSession(engine) as session:
                assert (
                    await session.scalar(select(func.count()).select_from(Family)) == 0
                )
                assert (
                    await session.scalar(select(func.count()).select_from(AppUser)) == 0
                )
        finally:
            await engine.dispose()


async def test_r1_2_bootstrap_prompts_without_environment_passwords(
    scratch_database: ScratchDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credential = secrets.token_urlsafe(24)
    prompts: list[str] = []

    def prompt(message: str) -> str:
        prompts.append(message)
        return credential

    monkeypatch.delenv("PAWLARIS_PASSWORD_1", raising=False)
    monkeypatch.setattr(getpass, "getpass", prompt)
    async with scratch_database() as url:
        monkeypatch.setenv("DATABASE_URL", url)
        monkeypatch.setenv("JWT_SECRET", secrets.token_hex(32))
        result = await asyncio.to_thread(
            main,
            [
                "bootstrap",
                "--family",
                "Test household",
                "--timezone",
                "UTC",
                "--user",
                f"First:{secrets.token_hex(8)}@example.invalid:leader",
            ],
        )
        assert result == 0
        assert len(prompts) == 1
        engine = create_async_engine(url)
        try:
            async with AsyncSession(engine) as session:
                member = (await session.execute(select(AppUser))).scalar_one()
                assert await verify_password(credential, member.password_hash)
        finally:
            await engine.dispose()
