import argparse
import asyncio
import getpass
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import SecretStr, ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import make_engine
from app.models import AppUser, Family, FamilyRevision
from app.security.passwords import hash_password
from app.settings import Settings

IDENTITY_KEYS = (
    "#5B7DB1",
    "#B15B6B",
    "#4F8A6B",
    "#C88A2E",
    "#7A65B0",
    "#3F8F97",
    "#B5654A",
    "#B15B9E",
)


class BootstrapArguments(argparse.Namespace):
    family: str
    timezone: str
    user: list[str]


@dataclass(frozen=True)
class BootstrapUser:
    name: str
    email: str
    role: str
    password: SecretStr


def read_users(values: Sequence[str]) -> list[BootstrapUser]:
    identities: list[tuple[str, str, str]] = []
    for value in values:
        parts = value.split(":")
        if len(parts) != 3:
            raise ValueError("Each user must be name:email:role.")
        name, email, role = parts
        if not 1 <= len(name) <= 40:
            raise ValueError("User names must contain 1 to 40 characters.")
        if not email or "@" not in email:
            raise ValueError("Each user needs an email address.")
        if role not in {"leader", "member"}:
            raise ValueError("User roles must be leader or member.")
        identities.append((name, email, role))
    if not any(role == "leader" for _, _, role in identities):
        raise ValueError("At least one user must be a leader.")
    if len({email.lower() for _, email, _ in identities}) != len(identities):
        raise ValueError("User email addresses must be distinct.")
    users = []
    for i, (name, email, role) in enumerate(identities, start=1):
        password = os.environ.get(f"PAWLARIS_PASSWORD_{i}")
        if password is None:
            password = getpass.getpass(f"Password for user {i}: ")
        if not 8 <= len(password) <= 128:
            raise ValueError("Passwords must contain 8 to 128 characters.")
        users.append(BootstrapUser(name, email, role, SecretStr(password)))
    return users


async def bootstrap(
    settings: Settings, name: str, timezone: str, users: Sequence[BootstrapUser]
) -> None:
    engine = make_engine(settings)
    try:
        async with AsyncSession(engine) as session, session.begin():
            # No family exists to lock yet. Serialize first-family creation itself.
            await session.execute(text("LOCK TABLE family IN EXCLUSIVE MODE"))
            if await session.scalar(select(Family.id).limit(1)) is not None:
                raise ValueError("A family already exists; bootstrap refused.")
            family = Family(id=uuid4(), name=name, timezone=timezone)
            session.add(family)
            await session.flush()
            await session.execute(
                select(FamilyRevision)
                .where(FamilyRevision.family_id == family.id)
                .with_for_update()
            )
            for i, user in enumerate(users):
                session.add(
                    AppUser(
                        id=uuid4(),
                        family_id=family.id,
                        role=user.role,
                        email=user.email,
                        display_name=user.name,
                        color=IDENTITY_KEYS[i % len(IDENTITY_KEYS)],
                        password_hash=await hash_password(
                            user.password.get_secret_value()
                        ),
                    )
                )
    finally:
        await engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pawlaris operator commands")
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("bootstrap", help="Create the first family and users")
    command.add_argument("--family", required=True)
    command.add_argument("--timezone", required=True)
    command.add_argument("--user", action="append", required=True)
    arguments = BootstrapArguments()
    parser.parse_args(argv, namespace=arguments)
    try:
        if not 1 <= len(arguments.family) <= 60:
            raise ValueError("Family names must contain 1 to 60 characters.")
        ZoneInfo(arguments.timezone)
        users = read_users(arguments.user)
        asyncio.run(bootstrap(Settings(), arguments.family, arguments.timezone, users))
    except ZoneInfoNotFoundError:
        print("Bootstrap refused: timezone must be an IANA name.", file=sys.stderr)
        return 1
    except ValidationError:
        print("Bootstrap refused: invalid server configuration.", file=sys.stderr)
        return 1
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (SQLAlchemyError, OSError):
        # Database exceptions may include bind parameters; never print them.
        print("Bootstrap failed: check the database configuration.", file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print("Bootstrap cancelled.", file=sys.stderr)
        return 1
    print("Family and users created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
