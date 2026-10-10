"""RS-6: reserve account writes are refused without changing any rows."""

import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import MetaData, select

from app.clock import FrozenClock
from app.models import Family, InviteCode, PushDevice, RefreshToken, TaskTemplate
from app.security.tokens import new_refresh_token
from app.settings import Settings
from tests.auth.conftest import LoginAccount
from tests.auth.conftest import account as account
from tests.auth.conftest import logged_in as logged_in
from tests.conftest import ClientFor

type Idem = Callable[[], dict[str, str]]
OPERATIONS = ("invite", "redeem", "profile", "password", "role", "remove")


@pytest.fixture
def server_role(request: pytest.FixtureRequest) -> str:
    return str(getattr(request, "param", "reserve"))


@pytest.fixture
def settings(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, server_role: str
) -> Settings:
    monkeypatch.setenv("SERVER_ROLE", server_role)
    configured = Settings(
        database_url=settings.database_url,
        jwt_secret=settings.jwt_secret,
        blob_dir=settings.blob_dir,
        push_enabled=False,
    )
    assert configured.server_role == server_role
    return configured


@dataclass(repr=False)
class AccountOperation:
    method: str
    path: str
    body: dict[str, str] | None
    success: int = 200


@pytest.fixture
async def account_operation(
    request: pytest.FixtureRequest,
    app: FastAPI,
    account: LoginAccount,
    frozen_clock: FrozenClock,
    logged_in: dict[str, str],
) -> AccountOperation:
    # Keep existing invites, sessions, devices and assignments in the snapshot.
    target = account.family.users[1]
    code = uuid4().hex[:10].upper()
    _, digest = new_refresh_token()
    assert logged_in["refresh_token"]
    async with app.state.session_factory() as session:
        task_values = await account.family.row_values(session, "task_template")
        session.add(TaskTemplate(**{**task_values, "assigned_to": target.id}))
        session.add(
            InviteCode(
                code=code,
                family_id=account.family.id,
                role="member",
                created_by=account.user.id,
                expires_at=frozen_clock.now() + timedelta(hours=24),
            )
        )
        session.add(
            RefreshToken(
                id=uuid4(),
                user_id=target.id,
                chain_id=uuid4(),
                token_hash=digest,
                expires_at=frozen_clock.now() + timedelta(days=30),
            )
        )
        session.add(PushDevice(token=secrets.token_urlsafe(24), user_id=target.id))
        await session.commit()
    return {
        "invite": AccountOperation("POST", "/invites", {"role": "member"}),
        "redeem": AccountOperation(
            "POST",
            "/auth/redeem",
            {
                "code": code,
                "email": f"{uuid4().hex}@example.invalid",
                "password": secrets.token_urlsafe(24),
                "display_name": "New member",
            },
        ),
        "profile": AccountOperation("PATCH", "/me", {"display_name": "Changed"}),
        "password": AccountOperation(
            "POST",
            "/me/password",
            {
                "current_password": account.credential,
                "new_password": secrets.token_urlsafe(24),
            },
            204,
        ),
        "role": AccountOperation(
            "PATCH", f"/family/members/{target.id}", {"role": "leader"}
        ),
        "remove": AccountOperation("DELETE", f"/family/members/{target.id}", None),
    }[str(request.param)]


async def database_rows(app: FastAPI) -> dict[str, list[dict[str, object]]]:
    rows: dict[str, list[dict[str, object]]] = {}
    metadata = MetaData()
    async with app.state.engine.connect() as connection:
        await connection.run_sync(metadata.reflect)
        for name, table in sorted(metadata.tables.items()):
            result = await connection.execute(
                select(table).order_by(*table.primary_key.columns)
            )
            rows[name] = [dict(row) for row in result.mappings()]
    return rows


@pytest.mark.parametrize("account_operation", OPERATIONS, indirect=True)
async def test_rs6_reserve_refuses_account_write_and_keeps_database_rows(
    app: FastAPI,
    account: LoginAccount,
    account_operation: AccountOperation,
    client: AsyncClient,
    client_for: ClientFor,
    idem: Idem,
) -> None:
    operation = account_operation
    http = client if operation.path == "/auth/redeem" else client_for(account.user)
    before = await database_rows(app)
    response = await http.request(
        operation.method,
        f"/api/v1{operation.path}",
        json=operation.body,
        headers=idem(),
    )
    after = await database_rows(app)
    code = response.json().get("code") if response.content else None
    assert (response.status_code, code == "reserve_read_only", after == before) == (
        409,
        True,
        True,
    )


@pytest.mark.parametrize("server_role", ["primary"], indirect=True)
@pytest.mark.parametrize("account_operation", OPERATIONS, indirect=True)
async def test_rs6_primary_allows_each_account_write(
    app: FastAPI,
    account: LoginAccount,
    account_operation: AccountOperation,
    client: AsyncClient,
    client_for: ClientFor,
    idem: Idem,
) -> None:
    operation = account_operation
    http = client if operation.path == "/auth/redeem" else client_for(account.user)
    before = await database_rows(app)
    response = await http.request(
        operation.method,
        f"/api/v1{operation.path}",
        json=operation.body,
        headers=idem(),
    )
    assert response.status_code == operation.success
    assert not response.content or response.json().get("code") != "reserve_read_only"
    assert await database_rows(app) != before


@pytest.mark.parametrize(
    "account_operation", [op for op in OPERATIONS if op != "redeem"], indirect=True
)
async def test_rs6_reserve_requires_session_before_role_check(
    app: FastAPI,
    account_operation: AccountOperation,
    client: AsyncClient,
    idem: Idem,
) -> None:
    operation = account_operation
    before = await database_rows(app)
    response = await client.request(
        operation.method,
        f"/api/v1{operation.path}",
        json=operation.body,
        headers=idem(),
    )
    assert response.status_code == 401
    assert response.json()["code"] == "token_invalid"
    assert await database_rows(app) == before


async def test_rs6_reserve_allows_login(
    client: AsyncClient, account: LoginAccount
) -> None:
    response = await client.post("/api/v1/auth/login", json=account.body())
    assert response.status_code == 200
    assert response.json()["user"]["id"] == str(account.user.id)


async def test_rs6_reserve_allows_refresh(
    client: AsyncClient, logged_in: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": logged_in["refresh_token"]}
    )
    assert response.status_code == 200
    assert response.json()["refresh_token"] != logged_in["refresh_token"]


async def test_rs6_reserve_allows_logout(
    app: FastAPI, client: AsyncClient, logged_in: dict[str, str], account: LoginAccount
) -> None:
    response = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": logged_in["refresh_token"]}
    )
    assert response.status_code == 204
    async with app.state.session_factory() as session:
        token = await session.scalar(
            select(RefreshToken).where(RefreshToken.user_id == account.user.id)
        )
        assert token is not None and token.revoked_at is not None


async def test_rs6_reserve_allows_put_push_token(
    app: FastAPI, account: LoginAccount, client_for: ClientFor
) -> None:
    token = secrets.token_urlsafe(24)
    response = await client_for(account.user).put(
        "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 204
    async with app.state.session_factory() as session:
        device = await session.get(PushDevice, token)
        assert device is not None and device.user_id == account.user.id


async def test_rs6_reserve_allows_delete_push_token(
    app: FastAPI, account: LoginAccount, client_for: ClientFor
) -> None:
    token = secrets.token_urlsafe(24)
    async with app.state.session_factory() as session:
        session.add(PushDevice(token=token, user_id=account.user.id))
        await session.commit()
    response = await client_for(account.user).request(
        "DELETE", "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 204
    async with app.state.session_factory() as session:
        assert await session.get(PushDevice, token) is None


async def test_rs6_reserve_allows_family_patch(
    app: FastAPI, account: LoginAccount, client_for: ClientFor, idem: Idem
) -> None:
    response = await client_for(account.user).patch(
        "/api/v1/family", json={"name": "Reserve family"}, headers=idem()
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Reserve family"
    async with app.state.session_factory() as session:
        family = await session.get(Family, account.family.id)
        assert family is not None and family.name == "Reserve family"


@pytest.mark.parametrize("server_role", ["primary", "reserve"], indirect=True)
async def test_rs6_health_reports_configured_role(
    client: AsyncClient, server_role: str
) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["role"] == server_role


def test_rs6_default_role_is_primary(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("SERVER_ROLE")
    configured = Settings(
        _env_file=None,
        database_url=settings.database_url,
        jwt_secret=settings.jwt_secret,
    )
    assert configured.server_role == "primary"


@pytest.mark.parametrize("invalid_role", ["secondary", "PRIMARY", ""])
def test_rs6_invalid_server_role_refuses_startup(
    settings: Settings, monkeypatch: pytest.MonkeyPatch, invalid_role: str
) -> None:
    monkeypatch.setenv("SERVER_ROLE", invalid_role)
    with pytest.raises(ValidationError) as caught:
        Settings(database_url=settings.database_url, jwt_secret=settings.jwt_secret)
    assert any(error["loc"] == ("server_role",) for error in caught.value.errors())
