import secrets
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from sqlalchemy import update

from app.clock import FrozenClock
from app.models import AppUser, RefreshToken
from app.security.passwords import hash_password
from app.security.tokens import issue_access, new_refresh_token
from app.settings import Settings
from tests.factories import MakeFamily, TestFamily


@dataclass(repr=False)
class LoginAccount:
    family: TestFamily
    credential: str

    @property
    def user(self) -> AppUser:
        return self.family.users[0]

    def body(self) -> dict[str, str]:
        return {"email": self.user.email, "password": self.credential}


@pytest.fixture
async def account(make_family: MakeFamily, app: FastAPI) -> LoginAccount:
    family = await make_family()
    credential = secrets.token_urlsafe(24)
    encoded = await hash_password(credential)
    async with app.state.session_factory() as session:
        await session.execute(
            update(AppUser)
            .where(AppUser.id == family.users[0].id)
            .values(password_hash=encoded)
        )
        await session.commit()
    return LoginAccount(family, credential)


@pytest.fixture
async def logged_in(
    app: FastAPI, account: LoginAccount, frozen_clock: FrozenClock, settings: Settings
) -> dict[str, str]:
    token, digest = new_refresh_token()
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=uuid4(),
                user_id=account.user.id,
                chain_id=uuid4(),
                token_hash=digest,
                expires_at=frozen_clock.now() + timedelta(days=30),
            )
        )
        await session.commit()
    return {
        "access_token": issue_access(account.user, frozen_clock, settings),
        "refresh_token": token,
    }
