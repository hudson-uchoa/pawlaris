"""P2-15 Red: device ownership, event payloads and after-commit delivery."""

import asyncio
import json
import logging
from collections import Counter
from collections.abc import AsyncIterator, Callable, Sequence
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from typing import cast
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI
from pydantic import JsonValue
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.clock import FrozenClock
from app.deps import get_push_sender
from app.main import create_app
from app.models import AppUser, Family, PushDevice, TaskCompletion, TaskTemplate
from app.push import (
    ExpoPushSender,
    NoOpPushSender,
    PushMessage,
    completion_duplicate_message,
    completion_messages,
    walk_started_message,
)
from app.security.tokens import issue_access
from app.settings import Settings
from tests.api.test_walks import finish_body, start_body, stored_walk
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily
from tests.sync.test_completions import body_for, make_task

type Idem = Callable[[], dict[str, str]]


@pytest.fixture
def settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"push_enabled": True})


async def checkpoint() -> None:
    future = asyncio.get_running_loop().create_future()
    asyncio.get_running_loop().call_soon(future.set_result, None)
    await future


async def drain_pushes(app: FastAPI) -> None:
    # Let create_task and done callbacks run; no elapsed-time sleeps as proof.
    await checkpoint()
    tasks = set(cast(set[asyncio.Task[None]], app.state.push_tasks))
    if tasks:
        _, pending = await asyncio.wait(tasks, timeout=2)
        assert not pending, "Push tasks must finish or be released by the test"
        await asyncio.gather(*tasks, return_exceptions=True)
    await checkpoint()


class FakeSender:
    def __init__(self, app: FastAPI) -> None:
        self.app = app
        self.calls: list[list[PushMessage]] = []
        self.started = asyncio.Event()
        self.release: asyncio.Event | None = None
        self.fail = False
        self.visible_completion_ids: list[UUID] = []

    @property
    def messages(self) -> list[PushMessage]:
        return [message for call in self.calls for message in call]

    async def send(self, messages: Sequence[PushMessage]) -> None:
        self.calls.append(deepcopy(list(messages)))
        # A fresh connection cannot see another transaction's uncommitted row.
        async with self.app.state.session_factory() as session:
            for message in messages:
                data = cast(dict[str, JsonValue], message["data"])
                if data["type"] == "completion":
                    id = UUID(str(data["completion_id"]))
                    row = await session.get(TaskCompletion, id)
                    if row is not None:
                        self.visible_completion_ids.append(id)
        self.started.set()
        if self.release is not None:
            await self.release.wait()
        if self.fail:
            raise RuntimeError("Injected sender failure")


@pytest.fixture
async def sender(app: FastAPI) -> AsyncIterator[FakeSender]:
    fake = FakeSender(app)
    app.state.push_sender = fake
    yield fake
    if fake.release is not None:
        fake.release.set()
    await drain_pushes(app)


@dataclass
class Scenario:
    family: TestFamily
    other: TestFamily
    task: TaskTemplate
    devices: list[tuple[AppUser, str]]

    def tokens_for(self, user: AppUser) -> list[str]:
        return [token for owner, token in self.devices if owner.id == user.id]

    @property
    def targets(self) -> list[str]:
        return self.tokens_for(self.family.users[1]) + self.tokens_for(
            self.family.users[2]
        )


async def seed_devices(app: FastAPI, devices: Sequence[tuple[AppUser, str]]) -> None:
    async with app.state.session_factory() as session:
        session.add_all(
            PushDevice(token=token, user_id=user.id) for user, token in devices
        )
        await session.commit()


async def device_rows(app: FastAPI) -> dict[str, UUID]:
    async with app.state.session_factory() as session:
        return {
            row.token: row.user_id for row in await session.scalars(select(PushDevice))
        }


@pytest.fixture
async def scenario(
    app: FastAPI, make_family: MakeFamily, frozen_clock: FrozenClock
) -> Scenario:
    family, other = await make_family(members=4), await make_family()
    task = await make_task(app, family)
    devices = [
        (user, f"opaque-device-{uuid4()}")
        for user in [*family.users, family.users[1], other.users[0]]
    ]
    await seed_devices(app, devices)
    async with app.state.session_factory() as session:
        await session.execute(
            update(Family)
            .where(Family.id == family.id)
            .values(timezone="America/New_York")
        )
        await session.execute(
            update(AppUser)
            .where(AppUser.id == family.users[3].id)
            .values(disabled_at=frozen_clock.now())
        )
        await session.commit()
    return Scenario(family, other, task, devices)


def completion_data(body: dict[str, object]) -> dict[str, JsonValue]:
    return {
        "type": "completion",
        "task_id": str(body["task_id"]),
        "occurrence_key": str(body["occurrence_key"]),
        "pet_id": None if body["pet_id"] is None else str(body["pet_id"]),
        "completion_id": str(body["id"]),
    }


def duplicate_data(winner: dict[str, object]) -> dict[str, JsonValue]:
    """Q-22: identify the winning completion with the completion data fields."""
    return {**completion_data(winner), "type": "completion_duplicate"}


def walk_data(walk_id: str, pet_id: str) -> dict[str, JsonValue]:
    """Q-22: identify the walk and pet; no reminder-suppression payload."""
    return {"type": "walk_started", "walk_id": walk_id, "pet_id": pet_id}


def visible(
    token: str, title: str, body: str, data: dict[str, JsonValue]
) -> PushMessage:
    return {
        "to": token,
        "channelId": "family-activity",
        "priority": "high",
        "title": title,
        "body": body,
        "data": data,
    }


def assert_messages(
    actual: Sequence[PushMessage], expected: Sequence[PushMessage]
) -> None:
    # Target ordering is unspecified; message multiplicity and every field matter.
    assert Counter(json.dumps(m, sort_keys=True) for m in actual) == Counter(
        json.dumps(m, sort_keys=True) for m in expected
    )


@pytest.mark.parametrize("length", [1, 255])
async def test_q20_put_stores_opaque_token_exactly_for_caller(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, length: int
) -> None:
    family = await make_family()
    token = " " if length == 1 else " opaque " + "x" * 247
    assert len(token) == length
    before = await device_rows(app)
    response = await client_for(family.users[1]).put(
        "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 204 and response.content == b""
    assert await device_rows(app) == {**before, token: family.users[1].id}


@pytest.mark.parametrize("foreign_family", [False, True])
async def test_q20_put_repoints_one_token_to_caller(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, foreign_family: bool
) -> None:
    family, other = await make_family(), await make_family()
    previous = other.users[0] if foreign_family else family.users[0]
    token = f"repoint-{uuid4()}"
    await seed_devices(app, [(previous, token)])
    before = await device_rows(app)
    response = await client_for(family.users[1]).put(
        "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 204
    assert await device_rows(app) == {**before, token: family.users[1].id}


async def test_q20_put_twice_keeps_one_row(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    token = f"repeat-{uuid4()}"
    before = await device_rows(app)
    for _ in range(2):
        response = await client_for(family.users[0]).put(
            "/api/v1/me/push-token", json={"token": token}
        )
        assert response.status_code == 204
    assert await device_rows(app) == {**before, token: family.users[0].id}


@pytest.mark.parametrize("owner", ["caller", "unknown", "other_member", "other_family"])
async def test_q20_delete_only_callers_token_and_always_returns_204(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, owner: str
) -> None:
    family, other = await make_family(), await make_family()
    token, keep = f"delete-{uuid4()}", f"keep-{uuid4()}"
    await seed_devices(app, [(family.users[0], keep)])
    owners = {
        "caller": family.users[0],
        "other_member": family.users[1],
        "other_family": other.users[0],
    }
    if owner != "unknown":
        await seed_devices(app, [(owners[owner], token)])
    before = await device_rows(app)
    response = await client_for(family.users[0]).request(
        "DELETE", "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 204 and response.content == b""
    expected = {k: v for k, v in before.items() if owner != "caller" or k != token}
    assert await device_rows(app) == expected


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
@pytest.mark.parametrize("token", ["", "x" * 256])
async def test_q20_token_outside_length_bounds_is_422_without_writes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    method: str,
    token: str,
) -> None:
    family = await make_family()
    before = await device_rows(app)
    response = await client_for(family.users[0]).request(
        method, "/api/v1/me/push-token", json={"token": token}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await device_rows(app) == before


@pytest.mark.parametrize("method", ["PUT", "DELETE"])
async def test_rb1_push_token_routes_require_authentication(
    app: FastAPI, client: httpx.AsyncClient, method: str
) -> None:
    before = await device_rows(app)
    response = await client.request(
        method, "/api/v1/me/push-token", json={"token": f"anonymous-{uuid4()}"}
    )
    assert response.status_code == 401
    assert await device_rows(app) == before


@pytest.mark.parametrize("mode", ["together", "per_pet"])
async def test_r3_39_r3_40_completion_targets_devices_with_exact_payload(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    mode: str,
) -> None:
    task = scenario.task
    if mode == "per_pet":
        task = await make_task(app, scenario.family, mode)
    body = body_for(
        task,
        frozen_clock,
        completed_at=(frozen_clock.now() - timedelta(minutes=18)).isoformat(),
    )
    author = scenario.family.users[0]
    response = await client_for(author).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert response.status_code == 200
    await drain_pushes(app)
    pet_suffix = f" ({scenario.family.pets[0].name})" if mode == "per_pet" else ""
    expected: list[PushMessage] = []
    for token in scenario.targets:
        data = completion_data(body)
        expected.extend(
            [
                visible(
                    token,
                    author.display_name,
                    f'concluiu "{task.title}"{pet_suffix} às 06:12',
                    data,
                ),
                {"to": token, "priority": "high", "data": {**data, "silent": True}},
            ]
        )
    assert_messages(sender.messages, expected)
    assert Counter(str(m["to"]) for m in sender.messages) == {
        token: 2 for token in scenario.targets
    }


@pytest.mark.parametrize("same_person", [False, True])
async def test_r3_41_losing_completion_notifies_only_winner_and_never_as_completion(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    same_person: bool,
) -> None:
    winner = scenario.family.users[1]
    loser = winner if same_person else scenario.family.users[0]
    body = body_for(scenario.task, frozen_clock)
    first = await client_for(winner).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert first.status_code == 200
    await drain_pushes(app)
    sender.calls.clear()
    # Arrival wins the race even when the losing tap has an earlier timestamp.
    losing_body = {
        **body,
        "id": str(uuid4()),
        "completed_at": (frozen_clock.now() - timedelta(minutes=30)).isoformat(),
    }
    lost = await client_for(loser).post(
        "/api/v1/completions", json=losing_body, headers=idem()
    )
    assert lost.status_code == 200 and lost.content == first.content
    await drain_pushes(app)
    expected = (
        []
        if same_person
        else [
            visible(
                token,
                loser.display_name,
                f'também marcou "{scenario.task.title}"',
                duplicate_data(body),
            )
            for token in scenario.tokens_for(winner)
        ]
    )
    assert_messages(sender.messages, expected)


async def test_r3_42_walk_start_targets_all_other_enabled_devices_once(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    author = scenario.family.users[0]
    body = start_body(scenario.family, frozen_clock)
    response = await client_for(author).post("/api/v1/walks", json=body, headers=idem())
    assert response.status_code == 200
    await drain_pushes(app)
    assert_messages(
        sender.messages,
        [
            visible(
                token,
                author.display_name,
                f"saiu para passear com {scenario.family.pets[0].name}",
                walk_data(str(body["id"]), str(body["pet_id"])),
            )
            for token in scenario.targets
        ],
    )


@pytest.mark.parametrize("operation", ["undo", "finish", "discard"])
async def test_r3_39_r3_42_undo_finish_and_discard_send_nothing(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    operation: str,
) -> None:
    author = scenario.family.users[0]
    if operation == "undo":
        body = body_for(scenario.task, frozen_clock)
        made = await client_for(author).post(
            "/api/v1/completions", json=body, headers=idem()
        )
        assert made.status_code == 200
        id = str(body["id"])
        path = f"/api/v1/completions/{id}/undo"
    else:
        walk = await stored_walk(app, scenario.family, frozen_clock, owner=author)
        path = f"/api/v1/walks/{walk.id}/{operation}"
    await drain_pushes(app)
    sender.calls.clear()
    response = await client_for(author).post(
        path,
        json=finish_body(scenario.family, frozen_clock)
        if operation == "finish"
        else None,
        headers=idem(),
    )
    assert response.status_code == 200
    await drain_pushes(app)
    assert sender.messages == []


async def test_q21_finish_without_start_sends_nothing(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    response = await client_for(scenario.family.users[0]).post(
        f"/api/v1/walks/{uuid4()}/finish",
        json=finish_body(scenario.family, frozen_clock),
        headers=idem(),
    )
    assert response.status_code == 200 and response.json()["status"] == "finished"
    await drain_pushes(app)
    assert sender.messages == []


@pytest.mark.parametrize("event", ["completion", "walk_started"])
async def test_id2_replay_sends_no_additional_push(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    event: str,
) -> None:
    body = (
        body_for(scenario.task, frozen_clock)
        if event == "completion"
        else start_body(scenario.family, frozen_clock)
    )
    path = "/api/v1/completions" if event == "completion" else "/api/v1/walks"
    http = client_for(scenario.family.users[0])
    headers = idem()
    first = await http.post(path, json=body, headers=headers)
    assert first.status_code == 200
    await drain_pushes(app)
    sender.calls.clear()
    replay = await http.post(path, json=body, headers=headers)
    assert replay.status_code == 200 and replay.content == first.content
    await drain_pushes(app)
    assert sender.messages == []


@pytest.mark.parametrize("event", ["completion", "walk_started"])
async def test_r3_39_r3_42_existing_row_under_new_key_sends_nothing(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    event: str,
) -> None:
    body = (
        body_for(scenario.task, frozen_clock)
        if event == "completion"
        else start_body(scenario.family, frozen_clock)
    )
    path = "/api/v1/completions" if event == "completion" else "/api/v1/walks"
    http = client_for(scenario.family.users[0])
    first_headers, second_headers = idem(), idem()
    assert first_headers != second_headers
    first = await http.post(path, json=body, headers=first_headers)
    assert first.status_code == 200 and first.json()["id"] == body["id"]
    await drain_pushes(app)
    assert sender.messages, "The original creation must send a push"
    sender.calls.clear()

    repeated = await http.post(path, json=body, headers=second_headers)
    assert repeated.status_code == 200 and repeated.content == first.content
    await drain_pushes(app)
    assert sender.calls == []


@pytest.mark.parametrize("event", ["completion", "walk_started"])
async def test_cp5_r3_42_validation_failure_sends_nothing(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    event: str,
) -> None:
    body = (
        body_for(scenario.task, frozen_clock, pet_id=str(scenario.family.pets[0].id))
        if event == "completion"
        else start_body(scenario.family, frozen_clock, started_at="invalid")
    )
    path = "/api/v1/completions" if event == "completion" else "/api/v1/walks"
    response = await client_for(scenario.family.users[0]).post(
        path, json=body, headers=idem()
    )
    assert response.status_code == 422
    await drain_pushes(app)
    assert sender.messages == []


@pytest.mark.parametrize("event", ["completion", "walk_started"])
async def test_r5_9_commit_failure_returns_500_without_push_or_row(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    monkeypatch: pytest.MonkeyPatch,
    event: str,
) -> None:
    from app.models import WalkSession

    body = (
        body_for(scenario.task, frozen_clock)
        if event == "completion"
        else start_body(scenario.family, frozen_clock)
    )
    path = "/api/v1/completions" if event == "completion" else "/api/v1/walks"

    async def failed_commit(self: AsyncSession) -> None:
        raise RuntimeError("Injected commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", failed_commit)
        response = await client_for(scenario.family.users[0]).post(
            path, json=body, headers=idem()
        )
    assert response.status_code == 500
    await drain_pushes(app)
    assert sender.messages == []
    async with app.state.session_factory() as session:
        model = TaskCompletion if event == "completion" else WalkSession
        assert await session.get(model, UUID(str(body["id"]))) is None


async def test_r5_9_sender_sees_completion_on_fresh_connection_after_commit(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    body = body_for(scenario.task, frozen_clock)
    response = await client_for(scenario.family.users[0]).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert response.status_code == 200
    await drain_pushes(app)
    assert sender.started.is_set(), "The sender must be called after commit"
    assert sender.visible_completion_ids == [UUID(str(body["id"]))] * 6


async def test_r5_9_blocked_sender_does_not_delay_response_and_task_is_retained(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    sender.release = asyncio.Event()
    response_task = asyncio.create_task(
        client_for(scenario.family.users[0]).post(
            "/api/v1/completions",
            json=body_for(scenario.task, frozen_clock),
            headers=idem(),
        )
    )
    entered = asyncio.create_task(sender.started.wait())
    tracked: set[asyncio.Task[None]] = set()
    try:
        done, _ = await asyncio.wait(
            {response_task, entered}, timeout=2, return_when=asyncio.FIRST_COMPLETED
        )
        assert done, "Neither response nor sender started"
        await asyncio.wait({entered}, timeout=2)
        assert sender.started.is_set(), "Completion must launch a push task"
        done, _ = await asyncio.wait({response_task}, timeout=2)
        assert response_task in done, "Response waits for the blocked sender"
        assert response_task.result().status_code == 200
        tracked = set(cast(set[asyncio.Task[None]], app.state.push_tasks))
        assert tracked and all(not task.done() for task in tracked)
        assert not sender.release.is_set()
        sender.release.set()
        await drain_pushes(app)
        assert all(task.done() for task in tracked)
        assert app.state.push_tasks == set()
    finally:
        sender.release.set()
        for task in (response_task, entered):
            if not task.done():
                task.cancel()
        await asyncio.gather(response_task, entered, return_exceptions=True)
        await drain_pushes(app)


async def test_r3_43_sender_failure_preserves_response_and_logs_one_error_json_line(
    app: FastAPI,
    scenario: Scenario,
    sender: FakeSender,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sender.fail = True
    caplog.set_level(logging.ERROR)
    body = body_for(scenario.task, frozen_clock)
    response = await client_for(scenario.family.users[0]).post(
        "/api/v1/completions", json=body, headers=idem()
    )
    assert response.status_code == 200 and response.json()["id"] == body["id"]
    await drain_pushes(app)
    assert sender.started.is_set(), "The failure must exercise a called sender"
    records = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(records) == 1
    line = records[0].getMessage()
    assert "\n" not in line
    assert json.loads(line)["level"] == "ERROR"
    assert "Injected sender failure" in json.loads(line)["exc"]
    assert app.state.push_tasks == set()
    assert not any(token in caplog.text for _, token in scenario.devices)
    assert scenario.task.title not in caplog.text


@pytest.mark.parametrize("mode", ["together", "per_pet"])
async def test_r3_39_r3_40_builder_uses_completed_at_in_family_timezone(
    app: FastAPI,
    scenario: Scenario,
    frozen_clock: FrozenClock,
    mode: str,
) -> None:
    task = (
        scenario.task
        if mode == "together"
        else await make_task(app, scenario.family, mode)
    )
    body = body_for(
        task,
        frozen_clock,
        completed_at=(frozen_clock.now() - timedelta(minutes=18)).isoformat(),
    )
    row = TaskCompletion(
        id=UUID(str(body["id"])),
        family_id=scenario.family.id,
        task_id=task.id,
        occurrence_key=str(body["occurrence_key"]),
        pet_id=task.pet_ids[0] if mode == "per_pet" else None,
        completed_by=scenario.family.users[0].id,
        completed_at=frozen_clock.now() - timedelta(minutes=18),
        title_snapshot=task.title,
    )
    pet = scenario.family.pets[0].name if mode == "per_pet" else None
    data = completion_data(body)
    suffix = f" ({pet})" if pet is not None else ""
    assert completion_messages(
        "builder-device", "Alex", row, "America/New_York", pet
    ) == [
        visible(
            "builder-device", "Alex", f'concluiu "{task.title}"{suffix} às 06:12', data
        ),
        {"to": "builder-device", "priority": "high", "data": {**data, "silent": True}},
    ]


async def test_r3_41_duplicate_builder_uses_winner_identity_and_loser_name(
    scenario: Scenario, frozen_clock: FrozenClock
) -> None:
    body = body_for(scenario.task, frozen_clock)
    winner = TaskCompletion(
        id=UUID(str(body["id"])),
        task_id=scenario.task.id,
        occurrence_key=str(body["occurrence_key"]),
        pet_id=None,
        title_snapshot="Original title",
    )
    assert completion_duplicate_message("builder-device", "Blair", winner) == visible(
        "builder-device",
        "Blair",
        'também marcou "Original title"',
        duplicate_data(body),
    )


async def test_r3_42_walk_builder_uses_walker_and_pet_names(
    app: FastAPI, scenario: Scenario, frozen_clock: FrozenClock
) -> None:
    walk = await stored_walk(app, scenario.family, frozen_clock)
    assert walk_started_message("builder-device", "Alex", "Pet zero", walk) == visible(
        "builder-device",
        "Alex",
        "saiu para passear com Pet zero",
        walk_data(str(walk.id), str(walk.pet_id)),
    )


def expo_messages(tokens: Sequence[str]) -> list[PushMessage]:
    return [
        visible(token, "Alex", "Private notification body", {"type": "walk_started"})
        for token in tokens
    ]


def assert_one_push_error(
    caplog: pytest.LogCaptureFixture,
    messages: Sequence[PushMessage],
    request_id: str | None = None,
) -> dict[str, JsonValue]:
    records = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(records) == 1
    assert records[0].name == "pawlaris.push"
    line = records[0].getMessage()
    assert "\n" not in line
    payload = cast(dict[str, JsonValue], json.loads(line))
    assert payload["level"] == "ERROR"
    assert payload["msg"] == "Push delivery failed"
    assert payload["exc"]
    if request_id is not None:
        assert payload["request_id"] == request_id
    for message in messages:
        for key in ("to", "title", "body"):
            value = message.get(key)
            if isinstance(value, str):
                assert value not in caplog.text
    return payload


async def test_r3_43_expo_posts_batches_of_at_most_100_in_order(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    requests: list[httpx.Request] = []
    batches: list[list[PushMessage]] = []
    messages = expo_messages([f"batch-device-{i}" for i in range(205)])

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        batch = json.loads(request.content)
        batches.append(batch)
        return httpx.Response(
            200,
            json={"data": [{"status": "ok", "id": str(i)} for i in range(len(batch))]},
        )

    caplog.set_level(logging.DEBUG)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        await ExpoPushSender(app.state.session_factory, http).send(messages)
    assert len(requests) == 3
    assert all(
        r.method == "POST" and str(r.url) == "https://exp.host/--/api/v2/push/send"
        for r in requests
    )
    assert [len(batch) for batch in batches] == [100, 100, 5]
    assert [m for batch in batches for m in batch] == messages
    assert not any(str(m["to"]) in caplog.text for m in messages)
    assert "Private notification body" not in caplog.text


async def test_r3_43_httpx_emits_no_record_below_warning_during_send(
    app: FastAPI, caplog: pytest.LogCaptureFixture
) -> None:
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": [{"status": "ok"}]})

    # app.main has configured logging; capture without overriding httpx's level.
    caplog.set_level(logging.DEBUG)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        await ExpoPushSender(app.state.session_factory, http).send(
            expo_messages(["logger-test-device"])
        )
    assert len(requests) == 1
    assert not [
        record
        for record in caplog.records
        if record.name == "httpx" and record.levelno < logging.WARNING
    ]
    assert logging.getLogger("httpx").level == logging.WARNING


async def test_r3_43_device_not_registered_deletes_only_ticket_token(
    app: FastAPI, scenario: Scenario, caplog: pytest.LogCaptureFixture
) -> None:
    tokens = [token for _, token in scenario.devices]
    before = await device_rows(app)
    dead = tokens[1]

    def transport(request: httpx.Request) -> httpx.Response:
        batch = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "status": "error",
                        "message": "Unknown device",
                        "details": {"error": "DeviceNotRegistered"},
                    }
                    if message["to"] == dead
                    else {"status": "ok", "id": str(i)}
                    for i, message in enumerate(batch)
                ]
            },
        )

    caplog.set_level(logging.DEBUG)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        await ExpoPushSender(app.state.session_factory, http).send(
            expo_messages(tokens)
        )
    assert await device_rows(app) == {
        token: owner for token, owner in before.items() if token != dead
    }
    assert not any(token in caplog.text for token in tokens)
    assert "Private notification body" not in caplog.text
    assert not [record for record in caplog.records if record.levelno == logging.ERROR]


@pytest.mark.parametrize(
    "codes",
    [
        pytest.param(("MessageRateExceeded",), id="rate"),
        pytest.param(("DeviceNotRegistered", "MessageRateExceeded"), id="mixed"),
        pytest.param(
            ("MessageRateExceeded", "MessageRateExceeded", "MessageTooBig", None),
            id="counts-and-missing-code",
        ),
    ],
)
async def test_r3_43_refused_tickets_keep_tokens_and_log_one_batch_error(
    app: FastAPI,
    scenario: Scenario,
    caplog: pytest.LogCaptureFixture,
    codes: tuple[str | None, ...],
) -> None:
    tokens = [token for _, token in scenario.devices][: len(codes)]
    before = await device_rows(app)
    messages = expo_messages(tokens)
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "status": "error",
                        "message": request.content.decode(),
                        "details": {"error": code} if code is not None else {},
                    }
                    for code in codes
                ]
            },
        )

    caplog.set_level(logging.DEBUG)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        await ExpoPushSender(app.state.session_factory, http).send(messages)
    assert len(requests) == 1
    stale = {
        token
        for token, code in zip(tokens, codes, strict=True)
        if code == "DeviceNotRegistered"
    }
    assert await device_rows(app) == {
        token: owner for token, owner in before.items() if token not in stale
    }
    payload = assert_one_push_error(caplog, messages)
    detail = payload["exc"]
    assert isinstance(detail, str)
    assert detail.startswith("ValueError: Expo ticket errors: ")
    assert json.loads(detail.removeprefix("ValueError: Expo ticket errors: ")) == dict(
        Counter(
            code or "UnknownError" for code in codes if code != "DeviceNotRegistered"
        )
    )
    assert "DeviceNotRegistered" not in detail


@pytest.mark.parametrize("failure", ["http", "timeout", "malformed"])
async def test_r3_43_expo_error_is_contained_and_preserves_every_device(
    app: FastAPI,
    scenario: Scenario,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
    caplog: pytest.LogCaptureFixture,
    failure: str,
) -> None:
    tokens = [token for _, token in scenario.devices]
    before = await device_rows(app)
    requests: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout(request.content.decode(), request=request)
        if failure == "malformed":
            return httpx.Response(200, json={"data": request.content.decode()})
        return httpx.Response(503, text=request.content.decode())

    caplog.set_level(logging.DEBUG)
    request_id = str(uuid4())
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
        app.state.push_sender = ExpoPushSender(app.state.session_factory, http)
        response = await client_for(scenario.family.users[0]).post(
            "/api/v1/completions",
            json=body_for(scenario.task, frozen_clock),
            headers={**idem(), "X-Request-ID": request_id},
        )
        assert response.status_code == 200
        assert response.headers["X-Request-ID"] == request_id
        await drain_pushes(app)
    assert len(requests) == 1
    assert await device_rows(app) == before
    assert not any(token in caplog.text for token in tokens)
    assert scenario.task.title not in caplog.text
    assert app.state.push_tasks == set()
    messages = cast(list[PushMessage], json.loads(requests[0].content))
    payload = assert_one_push_error(caplog, messages, request_id)
    detail = payload["exc"]
    assert isinstance(detail, str)
    expected_error = {
        "http": "HTTPStatusError",
        "timeout": "ReadTimeout",
        "malformed": "ValueError",
    }[failure]
    assert f"{expected_error}:" in detail


async def test_r3_43_noop_sender_accepts_messages_without_http_calls() -> None:
    await NoOpPushSender().send(expo_messages(["noop-device"]))


async def test_r3_43_push_disabled_selects_noop_and_completion_makes_no_http_call(
    app: FastAPI,
    scenario: Scenario,
    settings: Settings,
    frozen_clock: FrozenClock,
    idem: Idem,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application = create_app(
        settings.model_copy(update={"push_enabled": False}), frozen_clock
    )
    calls: list[httpx.Request] = []

    async def forbidden(
        self: httpx.AsyncHTTPTransport, request: httpx.Request
    ) -> httpx.Response:
        calls.append(request)
        raise AssertionError("Disabled push must never make an HTTP call")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", forbidden)
    try:
        assert isinstance(application.state.push_sender, NoOpPushSender)
        assert (
            get_push_sender(Request({"type": "http", "app": application}))
            is application.state.push_sender
        )
        access = issue_access(scenario.family.users[0], frozen_clock, settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=application, raise_app_exceptions=False),
            base_url="http://test",
            headers={"Authorization": f"Bearer {access}"},
        ) as client:
            response = await client.post(
                "/api/v1/completions",
                json=body_for(scenario.task, frozen_clock),
                headers=idem(),
            )
        assert response.status_code == 200
        await drain_pushes(application)
        assert calls == [] and application.state.push_tasks == set()
    finally:
        await application.state.engine.dispose()


async def test_r3_43_enabled_app_exposes_injected_sender_and_task_set(
    app: FastAPI, settings: Settings, frozen_clock: FrozenClock
) -> None:
    assert isinstance(app.state.push_sender, ExpoPushSender)
    application = create_app(settings, frozen_clock, NoOpPushSender())
    try:
        assert isinstance(application.state.push_sender, NoOpPushSender)
        assert (
            get_push_sender(Request({"type": "http", "app": application}))
            is application.state.push_sender
        )
        assert application.state.push_tasks == set()
    finally:
        await application.state.engine.dispose()
