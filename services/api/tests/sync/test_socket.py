"""WS-1 and WS-2 over one TestClient event loop and real PostgreSQL."""

import hashlib
import json
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import cast
from uuid import UUID, uuid4

import anyio
import pytest
from fastapi import FastAPI, WebSocket
from fastapi.routing import iter_route_contexts
from sqlalchemy import event, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.routing import WebSocketRoute
from starlette.testclient import TestClient, WebSocketTestSession
from starlette.types import Message
from starlette.websockets import WebSocketDisconnect
from uvicorn.protocols.websockets.auto import AutoWebSocketsProtocol

from app.clock import FrozenClock
from app.locks import lock_family
from app.main import create_app
from app.models import AppUser, FamilyRevision, Pet
from app.realtime import Hub
from app.security.tokens import issue_access
from app.settings import Settings
from tests.api.test_assets import image_bytes
from tests.factories import MakeFamily, TestFamily
from tests.security.test_route_census import assert_route_census


@pytest.fixture
def sweep_seconds() -> float:
    return 3600


@pytest.fixture
def socket_client(
    settings: Settings,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    sweep_seconds: float,
) -> Iterator[TestClient]:
    settings.ws_auth_timeout_seconds = 0.05
    # Traffic tests must exercise the frame checks without help from the sweep.
    settings.ws_sweep_seconds = sweep_seconds

    def bounded_receive(socket: WebSocketTestSession) -> Message:
        async def receive() -> Message:
            try:
                with anyio.fail_after(1):
                    return cast(Message, await socket._send_rx.receive())
            except TimeoutError:
                pytest.fail("WS frame did not arrive within one second")

        # TestClient has no public receive timeout. Bound its existing in-memory
        # stream, including the handshake, without creating another event loop.
        return socket.portal.call(receive)

    monkeypatch.setattr(WebSocketTestSession, "receive", bounded_receive)
    with TestClient(create_app(settings, frozen_clock)) as client:
        yield client


@pytest.fixture
def socket_family(socket_client: TestClient, make_family: MakeFamily) -> TestFamily:
    assert socket_client.portal is not None
    return socket_client.portal.call(make_family)


def application(client: TestClient) -> FastAPI:
    return cast(FastAPI, client.app)


def token(client: TestClient, user: AppUser) -> str:
    app = application(client)
    return issue_access(user, app.state.clock, app.state.settings)


def headers(client: TestClient, user: AppUser) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(client, user)}"}


def revision(client: TestClient, user: AppUser) -> int:
    response = client.get("/api/v1/sync?since=0", headers=headers(client, user))
    assert response.status_code == 200
    return cast(int, response.json()["revision"])


@contextmanager
def authenticated(client: TestClient, user: AppUser) -> Iterator[WebSocketTestSession]:
    with client.websocket_connect("/ws") as socket:
        socket.send_json({"type": "auth", "access_token": token(client, user)})
        assert socket.receive_json() == {
            "type": "ready",
            "revision": revision(client, user),
        }
        yield socket


def mutate(client: TestClient, user: AppUser, key: str | None = None) -> int:
    response = client.post(
        "/api/v1/pets",
        json={"id": str(uuid4()), "name": "Socket pet", "species": "cat"},
        headers={**headers(client, user), "Idempotency-Key": key or str(uuid4())},
    )
    assert response.status_code == 200
    return cast(int, response.json()["revision"])


def assert_pong(socket: WebSocketTestSession, current: int) -> None:
    # Pokes are awaited by the mutation, so this pong is also a queue barrier:
    # an unwanted poke would be the next frame and fail this exact assertion.
    socket.send_json({"type": "ping"})
    assert socket.receive_json() == {"type": "pong", "revision": current}


def assert_close(socket: WebSocketTestSession, code: int) -> None:
    with pytest.raises(WebSocketDisconnect) as closed:
        socket.receive_json()
    assert closed.value.code == code


def advance(client: TestClient, delta: timedelta) -> None:
    assert client.portal is not None
    client.portal.call(application(client).state.clock.advance, delta)


def test_ws1_reconnect_ready_catches_mutation_while_disconnected(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    user = socket_family.users[0]
    before = revision(socket_client, user)
    with authenticated(socket_client, user):
        pass
    current = mutate(socket_client, user)
    assert current > before
    with authenticated(socket_client, user) as socket:
        assert_pong(socket, current)
        response = socket_client.get(
            f"/api/v1/sync?since={before}", headers=headers(socket_client, user)
        )
        assert response.status_code == 200
        assert response.json()["revision"] == current
        assert len(response.json()["changes"]) == 1


def test_ws1_ready_and_pong_repeat_current_revision_after_mutation(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    user = socket_family.users[0]
    with authenticated(socket_client, user) as socket:
        assert_pong(socket, revision(socket_client, user))
        current = mutate(socket_client, user)
        assert socket.receive_json() == {"type": "poke", "revision": current}
        assert_pong(socket, current)


def test_ws1_member_a_mutation_pokes_author_and_member_b(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    author, other = socket_family.users
    with (
        authenticated(socket_client, author) as a,
        authenticated(socket_client, other) as b,
    ):
        current = mutate(socket_client, author)
        assert current == revision(socket_client, author)
        assert a.receive_json() == {"type": "poke", "revision": current}
        assert b.receive_json() == {"type": "poke", "revision": current}
        assert_pong(a, current)
        assert_pong(b, current)


def test_ws1_validation_failure_pokes_nobody(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    author, other = socket_family.users
    before = revision(socket_client, author)
    with (
        authenticated(socket_client, author) as a,
        authenticated(socket_client, other) as b,
    ):
        response = socket_client.post(
            "/api/v1/pets",
            json={"id": str(uuid4()), "name": "Invalid", "species": "unknown"},
            headers={
                **headers(socket_client, author),
                "Idempotency-Key": str(uuid4()),
            },
        )
        assert response.status_code == 422
        assert revision(socket_client, author) == before
        assert_pong(a, before)
        assert_pong(b, before)


def test_ws1_idempotent_replay_pokes_nobody(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    author, other = socket_family.users
    key = str(uuid4())
    body = {"id": str(uuid4()), "name": "Replayed pet", "species": "dog"}
    request_headers = {**headers(socket_client, author), "Idempotency-Key": key}
    with (
        authenticated(socket_client, author) as a,
        authenticated(socket_client, other) as b,
    ):
        first = socket_client.post("/api/v1/pets", json=body, headers=request_headers)
        assert first.status_code == 200
        current = revision(socket_client, author)
        for socket in (a, b):
            assert socket.receive_json() == {"type": "poke", "revision": current}
        replay = socket_client.post("/api/v1/pets", json=body, headers=request_headers)
        assert replay.status_code == 200
        assert replay.content == first.content
        assert revision(socket_client, author) == current
        assert_pong(a, current)
        assert_pong(b, current)


@pytest.mark.parametrize("writer", ["patch_me", "redeem", "upload"])
def test_ws1_non_wrapped_synced_writer_pokes(
    socket_client: TestClient, socket_family: TestFamily, writer: str
) -> None:
    user = socket_family.users[0]
    request_headers = headers(socket_client, user)
    code = ""
    if writer == "redeem":
        invitation = socket_client.post(
            "/api/v1/invites", json={"role": "member"}, headers=request_headers
        )
        assert invitation.status_code == 200
        code = invitation.json()["code"]
    before = revision(socket_client, user)
    with authenticated(socket_client, user) as socket:
        if writer == "patch_me":
            response = socket_client.patch(
                "/api/v1/me",
                json={"display_name": "Updated member"},
                headers=request_headers,
            )
        elif writer == "redeem":
            response = socket_client.post(
                "/api/v1/auth/redeem",
                json={
                    "code": code,
                    "email": f"{uuid4().hex}@example.invalid",
                    "password": secrets.token_urlsafe(24),
                    "display_name": "New member",
                },
            )
        else:
            content = image_bytes()
            response = socket_client.put(
                f"/api/v1/assets/{uuid4()}?kind=task_proof",
                content=content,
                headers={
                    **request_headers,
                    "Content-Length": str(len(content)),
                    "X-Content-SHA256": hashlib.sha256(content).hexdigest(),
                },
            )
        assert response.status_code == (201 if writer == "upload" else 200)
        current = revision(socket_client, user)
        assert current > before
        assert socket.receive_json() == {"type": "poke", "revision": current}
        assert_pong(socket, current)


def test_ws2_missing_auth_closes_4408(
    socket_client: TestClient,
) -> None:
    with socket_client.websocket_connect("/ws") as socket:
        assert_close(socket, 4408)


def test_ws2_foreign_family_never_receives_poke(
    socket_client: TestClient, socket_family: TestFamily, make_family: MakeFamily
) -> None:
    assert socket_client.portal is not None
    foreign = socket_client.portal.call(make_family)
    user = socket_family.users[0]
    stranger = foreign.users[0]
    before = revision(socket_client, stranger)
    with (
        authenticated(socket_client, user) as own_socket,
        authenticated(socket_client, stranger) as foreign_socket,
    ):
        current = mutate(socket_client, user)
        assert own_socket.receive_json() == {"type": "poke", "revision": current}
        assert revision(socket_client, stranger) == before
        assert_pong(foreign_socket, before)


@pytest.mark.parametrize(
    "frame", ["not_auth", "bad_json", "bad_token", "expired_token", "disabled"]
)
def test_ws2_invalid_first_frame_closes_4401(
    socket_client: TestClient, socket_family: TestFamily, frame: str
) -> None:
    user = socket_family.users[0]
    access = token(socket_client, user)
    if frame == "expired_token":
        advance(socket_client, timedelta(minutes=15))
    if frame == "disabled":

        async def disable() -> None:
            async with application(socket_client).state.session_factory() as session:
                await lock_family(session, socket_family.id)
                await session.execute(
                    update(AppUser)
                    .where(AppUser.id == user.id)
                    .values(disabled_at=application(socket_client).state.clock.now())
                )
                await session.commit()

        assert socket_client.portal is not None
        socket_client.portal.call(disable)
    with socket_client.websocket_connect("/ws") as socket:
        if frame == "bad_json":
            socket.send_text("{")
        elif frame == "not_auth":
            socket.send_json({"type": "ping"})
        else:
            socket.send_json(
                {
                    "type": "auth",
                    "access_token": "invalid" if frame == "bad_token" else access,
                }
            )
        assert_close(socket, 4401)


def test_ws2_url_token_does_not_authenticate(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    access = token(socket_client, socket_family.users[0])
    with socket_client.websocket_connect(f"/ws?access_token={access}") as socket:
        assert_close(socket, 4408)


def test_ws2_expired_token_closes_on_next_inbound_frame(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    with authenticated(socket_client, socket_family.users[0]) as socket:
        advance(socket_client, timedelta(minutes=15))
        socket.send_json({"type": "ping"})
        assert_close(socket, 4401)


def test_ws2_expired_token_closes_before_outbound_poke(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    with authenticated(socket_client, socket_family.users[0]) as socket:
        advance(socket_client, timedelta(minutes=15))
        mutate(socket_client, socket_family.users[1])
        # A poke as the next frame would fail; no inbound frame prompts expiry.
        assert_close(socket, 4401)


@pytest.mark.parametrize("sweep_seconds", [0.02])
def test_ws2_sweep_alone_closes_expired_socket_without_traffic(
    socket_client: TestClient, socket_family: TestFamily
) -> None:
    with authenticated(socket_client, socket_family.users[0]) as socket:
        advance(socket_client, timedelta(minutes=15))
        assert_close(socket, 4401)


def test_ws1_hub_registers_before_reading_ready_revision(
    socket_client: TestClient,
    socket_family: TestFamily,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = application(socket_client)
    hub = cast(Hub, app.state.hub)
    registered = False
    revision_reads = 0
    original = hub.register

    async def register(family_id: UUID, ws: WebSocket) -> None:
        nonlocal registered
        assert family_id == socket_family.id
        await original(family_id, ws)
        registered = True

    def observe(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        nonlocal revision_reads
        if statement.lstrip().upper().startswith("SELECT") and (
            "family_revision" in statement
        ):
            assert registered, "Ready revision was read before hub registration"
            revision_reads += 1

    monkeypatch.setattr(hub, "register", register)
    engine = app.state.engine.sync_engine
    event.listen(engine, "before_cursor_execute", observe)
    try:
        with socket_client.websocket_connect("/ws") as socket:
            socket.send_json(
                {
                    "type": "auth",
                    "access_token": token(socket_client, socket_family.users[0]),
                }
            )
            ready = socket.receive_json()
            assert ready["type"] == "ready"
            assert registered
            assert revision_reads >= 1
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert ready["revision"] == revision(socket_client, socket_family.users[0])


def test_ws1_poke_observes_committed_row_and_revision(
    socket_client: TestClient,
    socket_family: TestFamily,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = application(socket_client)
    before = revision(socket_client, socket_family.users[0])
    pokes: list[int] = []

    async def poke(family_id: UUID, current: int) -> None:
        assert family_id == socket_family.id
        # This fresh connection cannot see an uncommitted mutation or revision.
        async with app.state.engine.connect() as connection:
            visible = await connection.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family_id
                )
            )
            count = await connection.scalar(
                select(Pet.id).where(
                    Pet.family_id == family_id, Pet.name == "Socket pet"
                )
            )
        assert count is not None
        assert visible == current
        assert current > before
        pokes.append(current)

    monkeypatch.setattr(app.state.hub, "poke", poke)
    current = mutate(socket_client, socket_family.users[0])
    assert pokes == [current]
    assert current == revision(socket_client, socket_family.users[0])


def test_ws1_failed_commit_never_pokes(
    socket_client: TestClient,
    socket_family: TestFamily,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = application(socket_client)
    before = revision(socket_client, socket_family.users[0])
    pokes: list[int] = []
    commits: list[str] = []

    async def poke(family_id: UUID, current: int) -> None:
        pokes.append(current)

    async def fail_commit(session: AsyncSession) -> None:
        commits.append("attempted")
        raise RuntimeError("Injected commit failure")

    monkeypatch.setattr(app.state.hub, "poke", poke)
    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    response = socket_client.post(
        "/api/v1/pets",
        json={"id": str(uuid4()), "name": "Rolled back", "species": "cat"},
        headers={
            **headers(socket_client, socket_family.users[0]),
            "Idempotency-Key": str(uuid4()),
        },
    )
    assert response.status_code == 500
    assert commits == ["attempted"]
    assert pokes == []
    assert revision(socket_client, socket_family.users[0]) == before


def test_ws1_failing_poke_preserves_successful_http_response(
    socket_client: TestClient,
    socket_family: TestFamily,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempted: list[int] = []

    async def fail(family_id: UUID, current: int) -> None:
        attempted.append(current)
        raise RuntimeError("Injected poke failure")

    monkeypatch.setattr(application(socket_client).state.hub, "poke", fail)
    current = mutate(socket_client, socket_family.users[0])
    assert attempted == [current]
    assert revision(socket_client, socket_family.users[0]) == current


def test_ws1_dead_socket_does_not_stop_other_family_sockets(
    socket_client: TestClient,
    socket_family: TestFamily,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = WebSocket.send
    sends: list[str] = []

    async def fail_dead(ws: WebSocket, message: Message) -> None:
        if message["type"] == "websocket.send":
            data = json.loads(message.get("text") or message["bytes"].decode())
        else:
            data = {}
        if data.get("type") == "poke":
            if ws.query_params.get("dead") == "1":
                sends.append("dead")
                raise WebSocketDisconnect(1006)
            sends.append("live")
        await original(ws, message)

    user = socket_family.users[0]
    with socket_client.websocket_connect("/ws?dead=1") as dead:
        dead.send_json({"type": "auth", "access_token": token(socket_client, user)})
        assert dead.receive_json() == {
            "type": "ready",
            "revision": revision(socket_client, user),
        }
        with authenticated(socket_client, socket_family.users[1]) as live:
            monkeypatch.setattr(WebSocket, "send", fail_dead)
            current = mutate(socket_client, user)
            assert live.receive_json() == {"type": "poke", "revision": current}
            assert sorted(sends) == ["dead", "live"]


def test_ws1_uvicorn_finds_websocket_protocol() -> None:
    assert AutoWebSocketsProtocol is not None


def test_ws2_route_census_has_exactly_one_ws(
    socket_client: TestClient,
) -> None:
    app = application(socket_client)
    paths = [
        context.path
        for context in iter_route_contexts(app.routes)
        if isinstance(context.original_route, WebSocketRoute)
    ]
    assert paths == ["/ws"]
    assert_route_census(app)
