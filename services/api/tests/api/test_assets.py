import asyncio
import hashlib
import os
import struct
import zlib
from collections.abc import AsyncIterator, Callable
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from threading import get_ident
from uuid import UUID, uuid1, uuid4

import pytest
from fastapi import FastAPI
from httpx import AsyncByteStream, AsyncClient, Response
from PIL import Image
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app import cli
from app.clock import FrozenClock
from app.errors import ApiError
from app.locks import lock_family
from app.models import (
    AppliedMutation,
    AppUser,
    FamilyRevision,
    HealthEvent,
    InviteCode,
    Pet,
    RefreshToken,
    TaskCompletion,
)
from app.models import (
    Asset as AssetModel,
)
from app.schemas.rows import Asset
from app.services import assets, maintenance
from app.settings import Settings
from app.storage.base import StorageAdapter
from app.storage.local import LocalStorage
from tests.conftest import ClientFor
from tests.factories import MakeFamily, TestFamily
from tests.security.matrix import task_body

type Idem = Callable[[], dict[str, str]]
CACHE_CONTROL = "private, max-age=31536000, immutable"


def image_bytes(
    format: str = "PNG", size: tuple[int, int] = (2, 2), color: str = "white"
) -> bytes:
    with BytesIO() as buffer, Image.new("RGB", size, color) as image:
        image.save(buffer, format=format)
        return buffer.getvalue()


def png_with_header_size(width: int, height: int) -> bytes:
    payload = bytearray(image_bytes())
    payload[16:24] = struct.pack(">II", width, height)
    payload[29:33] = struct.pack(">I", zlib.crc32(payload[12:29]))
    return bytes(payload)


def file_state(directory: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


async def database_state(app: FastAPI, family: TestFamily) -> dict[str, object]:
    async with app.state.session_factory() as session:
        rows = list(
            await session.scalars(
                select(AssetModel)
                .where(AssetModel.family_id == family.id)
                .order_by(AssetModel.id)
            )
        )
        return {
            "assets": [
                (
                    Asset.model_validate(row).model_dump(mode="json"),
                    row.storage_key,
                    row.sha256,
                )
                for row in rows
            ],
            "revision": await session.scalar(
                select(FamilyRevision.value).where(
                    FamilyRevision.family_id == family.id
                )
            ),
            "mutations": list(
                await session.scalars(
                    select(AppliedMutation.client_mutation_id)
                    .where(AppliedMutation.family_id == family.id)
                    .order_by(AppliedMutation.client_mutation_id)
                )
            ),
        }


async def seed_asset(
    app: FastAPI,
    family: TestFamily,
    clock: FrozenClock,
    *,
    age: timedelta = timedelta(0),
    deleted: bool = False,
    content: bytes | None = None,
) -> AssetModel:
    content = image_bytes() if content is None else content
    id = uuid4()
    key = f"{family.id}/{id}.png"
    target = family.blob_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    async with app.state.session_factory() as session:
        values = await family.row_values(session, "asset")
        values.update(
            id=id,
            storage_key=key,
            mime="image/png",
            bytes=len(content),
            width=2,
            height=2,
            sha256=hashlib.sha256(content).hexdigest(),
            created_at=clock.now() - age,
            deleted_at=clock.now() if deleted else None,
        )
        row = AssetModel(**values)
        session.add(row)
        await session.commit()
        return row


async def upload(
    client: AsyncClient,
    content: bytes,
    *,
    id: UUID | None = None,
    kind: str = "task_proof",
    headers: dict[str, str] | None = None,
) -> Response:
    return await client.put(
        f"/api/v1/assets/{id or uuid4()}?kind={kind}",
        content=content,
        headers={
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(content)),
            "X-Content-SHA256": hashlib.sha256(content).hexdigest(),
            **(headers or {}),
        },
    )


class TrackedStream(AsyncByteStream):
    def __init__(
        self, chunks: list[bytes], before_read: Callable[[int], None] | None = None
    ) -> None:
        self.chunks = chunks
        self.consumed: list[int] = []
        self.before_read = before_read

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for index, chunk in enumerate(self.chunks):
            if self.before_read is not None:
                self.before_read(index)
            self.consumed.append(index)
            yield chunk


class PausedStream(AsyncByteStream):
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.waiting = asyncio.Event()
        self.resume = asyncio.Event()

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self.payload[:32]
        self.waiting.set()
        await self.resume.wait()
        yield self.payload[32:]


async def test_as1_family_lock_is_free_while_an_upload_chunk_is_pending(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    payload = image_bytes()
    stream = PausedStream(payload)
    pending = asyncio.create_task(
        client_for(family.users[0]).put(
            f"/api/v1/assets/{uuid4()}?kind=task_proof",
            content=stream,
            headers={
                "Content-Length": str(len(payload)),
                "X-Content-SHA256": hashlib.sha256(payload).hexdigest(),
            },
        )
    )
    try:
        await asyncio.wait_for(stream.waiting.wait(), timeout=5)
        assert list(file_state(family.blob_dir).values()) == [payload[:32]]
        async with app.state.session_factory() as session:
            locked = await session.scalar(
                select(FamilyRevision.value)
                .where(FamilyRevision.family_id == family.id)
                .with_for_update(nowait=True)
            )
            assert locked is not None
            assert not pending.done()
            await session.rollback()
        stream.resume.set()
        response = await asyncio.wait_for(pending, timeout=10)
        assert response.status_code == 201
        assert list(file_state(family.blob_dir).values()) == [payload]
    finally:
        if not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)


async def test_as1_actor_removed_while_body_arrives_leaves_no_row_or_file(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    await seed_asset(app, family, frozen_clock)
    files = file_state(family.blob_dir)
    actor = family.users[1]
    payload = image_bytes(color="black")
    stream = PausedStream(payload)
    pending = asyncio.create_task(
        client_for(actor).put(
            f"/api/v1/assets/{uuid4()}?kind=task_proof",
            content=stream,
            headers={
                "Content-Length": str(len(payload)),
                "X-Content-SHA256": hashlib.sha256(payload).hexdigest(),
            },
        )
    )
    try:
        await asyncio.wait_for(stream.waiting.wait(), timeout=5)
        async with app.state.session_factory() as session:
            await session.execute(text("SET LOCAL lock_timeout = '1s'"))
            await lock_family(session, family.id)
            await session.execute(
                update(AppUser)
                .where(AppUser.id == actor.id)
                .values(disabled_at=frozen_clock.now())
            )
            await session.commit()
        before = await database_state(app, family)
        stream.resume.set()
        response = await asyncio.wait_for(pending, timeout=10)
        assert response.status_code == 401
        assert response.json()["code"] == "token_invalid"
        assert await database_state(app, family) == before
        assert file_state(family.blob_dir) == files
        async with app.state.session_factory() as session:
            removed = await session.get(AppUser, actor.id)
            assert removed is not None and removed.disabled_at == frozen_clock.now()
    finally:
        if not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)


@pytest.mark.parametrize("kind", ["pet_avatar", "task_proof", "health_attachment"])
@pytest.mark.parametrize(
    "format,mime,extension",
    [
        ("JPEG", "image/jpeg", "jpg"),
        ("PNG", "image/png", "png"),
        ("WEBP", "image/webp", "webp"),
    ],
)
async def test_as1_upload_stores_detected_metadata_clock_and_sync_row(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    kind: str,
    format: str,
    mime: str,
    extension: str,
) -> None:
    family = await make_family()
    actor = family.users[1]
    frozen_clock.advance(timedelta(days=2))
    id = uuid4()
    payload = image_bytes(format, (3, 5))
    before = await database_state(app, family)
    response = await upload(client_for(actor), payload, id=id, kind=kind)
    assert response.status_code == 201
    row = response.json()
    assert set(row) == set(Asset.model_fields)
    assert row["id"] == str(id) and row["kind"] == kind
    assert row["mime"] == mime and row["bytes"] == len(payload)
    assert (row["width"], row["height"]) == (3, 5)
    assert row["uploaded_by"] == str(actor.id)
    assert row["created_at"] == frozen_clock.now().isoformat().replace("+00:00", "Z")
    assert row["deleted_at"] is None
    key = f"{family.id}/{id}.{extension}"
    assert file_state(family.blob_dir) == {str(Path(key)): payload}
    async with app.state.session_factory() as session:
        stored = await session.get(AssetModel, id)
        assert stored is not None and stored.family_id == family.id
        assert stored.storage_key == key
        assert stored.sha256 == hashlib.sha256(payload).hexdigest()
        assert Asset.model_validate(stored).model_dump(mode="json") == row
    after = await database_state(app, family)
    assert after["mutations"] == before["mutations"]
    synced = await client_for(family.users[0]).get("/api/v1/sync?since=0")
    assert {"entity": "assets", "row": row} in synced.json()["changes"]


async def test_as1_completion_soft_reference_resolves_after_upload(
    make_family: MakeFamily,
    client_for: ClientFor,
    idem: Idem,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    client = client_for(family.users[0])
    task = await client.post("/api/v1/tasks", json=task_body(family), headers=idem())
    assert task.status_code == 200
    asset_id = uuid4()
    completion = await client.post(
        "/api/v1/completions",
        json={
            "id": str(uuid4()),
            "task_id": task.json()["id"],
            "occurrence_key": "2026-09-14",
            "completed_at": frozen_clock.now().isoformat(),
            "photo_asset_id": str(asset_id),
        },
        headers=idem(),
    )
    assert completion.status_code == 200
    uploaded = await upload(client, image_bytes(), id=asset_id)
    assert uploaded.status_code == 201
    sync = await client_for(family.users[1]).get("/api/v1/sync?since=0")
    assert {"entity": "task_completions", "row": completion.json()} in sync.json()[
        "changes"
    ]
    assert {"entity": "assets", "row": uploaded.json()} in sync.json()["changes"]


async def test_as1_png_claimed_as_jpeg_is_stored_and_downloaded_as_png(
    make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    payload = image_bytes()
    response = await upload(
        client_for(family.users[0]), payload, headers={"Content-Type": "image/jpeg"}
    )
    assert response.status_code == 201 and response.json()["mime"] == "image/png"
    downloaded = await client_for(family.users[1]).get(
        f"/api/v1/assets/{response.json()['id']}/file"
    )
    assert downloaded.status_code == 200 and downloaded.content == payload
    assert downloaded.headers["Content-Type"] == "image/png"
    assert downloaded.headers["Cache-Control"] == CACHE_CONTROL


@pytest.mark.parametrize(
    "payload",
    [
        b"not an image",
        image_bytes("GIF"),
        image_bytes("BMP"),
        image_bytes("TIFF"),
        image_bytes()[:-8],
    ],
)
async def test_as1_invalid_format_or_truncated_image_leaves_no_row_or_file(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, payload: bytes
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    response = await upload(client_for(family.users[0]), payload)
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


@pytest.mark.parametrize(
    "width,height,expected",
    [
        (1, 2, 201),
        (4096, 2, 201),
        (0, 2, 422),
        (4097, 2, 422),
        (2, 1, 201),
        (2, 4096, 201),
        (2, 0, 422),
        (2, 4097, 422),
        (5000, 5000, 422),
    ],
)
async def test_as1_image_dimension_bounds_use_the_header(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    width: int,
    height: int,
    expected: int,
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    payload = png_with_header_size(width, height)
    response = await upload(client_for(family.users[0]), payload)
    assert response.status_code == expected
    if expected == 201:
        assert (response.json()["width"], response.json()["height"]) == (width, height)
    else:
        assert response.json()["code"] == "validation_error"
        assert await database_state(app, family) == before
        assert file_state(family.blob_dir) == {}


async def test_as1_hash_mismatch_precedes_image_validation_and_cleans_temp_file(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    validated = False

    def forbidden_validation(path: Path) -> assets.ImageMetadata:
        nonlocal validated
        validated = True
        raise AssertionError("Hash mismatch must be rejected before image validation")

    monkeypatch.setattr(assets, "validate_image", forbidden_validation)
    response = await upload(
        client_for(family.users[0]),
        b"not an image",
        headers={"X-Content-SHA256": "0" * 64},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert not validated
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


@pytest.mark.parametrize("bad_hash", [None, "wrong", "g" * 64])
async def test_as1_missing_or_malformed_hash_is_validation_error(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, bad_hash: str | None
) -> None:
    family = await make_family()
    payload = image_bytes()
    headers = {"Content-Length": str(len(payload))}
    if bad_hash is not None:
        headers["X-Content-SHA256"] = bad_hash
    before = await database_state(app, family)
    response = await client_for(family.users[0]).put(
        f"/api/v1/assets/{uuid4()}?kind=task_proof", content=payload, headers=headers
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


@pytest.mark.parametrize("length", [None, str(8 * 1024 * 1024 + 1)])
async def test_as1_missing_or_over_limit_length_rejects_before_reading(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, length: str | None
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    stream = TrackedStream([b"unread body"])
    headers = {"X-Content-SHA256": "0" * 64}
    if length is not None:
        headers["Content-Length"] = length
    response = await client_for(family.users[0]).put(
        f"/api/v1/assets/{uuid4()}?kind=task_proof", content=stream, headers=headers
    )
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"
    assert stream.consumed == []
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


@pytest.mark.parametrize("length", [None, "1", str(8 * 1024 * 1024 + 1)])
async def test_as1_unauthenticated_upload_never_reads_a_body(
    client: AsyncClient, settings: Settings, length: str | None
) -> None:
    stream = TrackedStream([b"unread body"])
    headers = {"X-Content-SHA256": "0" * 64}
    if length is not None:
        headers["Content-Length"] = length
    response = await client.put(
        f"/api/v1/assets/{uuid4()}?kind=task_proof", content=stream, headers=headers
    )
    assert response.status_code == 401 and response.json()["code"] == "token_invalid"
    assert stream.consumed == []
    assert file_state(settings.blob_dir) == {}


async def test_as1_stream_count_aborts_at_the_first_byte_over_the_limit(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    stream = TrackedStream([b"x" * (8 * 1024 * 1024), b"y", b"unread tail"])
    response = await client_for(family.users[0]).put(
        f"/api/v1/assets/{uuid4()}?kind=task_proof",
        content=stream,
        headers={"Content-Length": "1", "X-Content-SHA256": "0" * 64},
    )
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"
    assert stream.consumed == [0, 1]
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


async def test_as1_exactly_eight_megabytes_is_accepted(
    make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    payload = image_bytes().ljust(8 * 1024 * 1024, b"\x00")
    response = await upload(client_for(family.users[0]), payload)
    assert response.status_code == 201
    assert response.json()["bytes"] == 8 * 1024 * 1024
    assert list(file_state(family.blob_dir).values()) == [payload]


async def test_as1_upload_writes_chunks_to_disk_before_asking_for_more(
    make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    payload = image_bytes().ljust(256 * 1024, b"\x00")
    chunk_size = 64 * 1024
    checked: list[int] = []

    def check_written(index: int) -> None:
        if index:
            files = [path for path in family.blob_dir.rglob("*") if path.is_file()]
            assert len(files) == 1, "Chunks must already be in one temporary file"
            assert files[0].read_bytes() == payload[: index * chunk_size]
            checked.append(index)

    stream = TrackedStream(
        [
            payload[offset : offset + chunk_size]
            for offset in range(0, len(payload), chunk_size)
        ],
        check_written,
    )
    response = await client_for(family.users[0]).put(
        f"/api/v1/assets/{uuid4()}?kind=task_proof",
        content=stream,
        headers={
            "Content-Length": str(len(payload)),
            "X-Content-SHA256": hashlib.sha256(payload).hexdigest(),
        },
    )
    assert response.status_code == 201
    assert checked == [1, 2, 3]
    assert list(file_state(family.blob_dir).values()) == [payload]


async def test_as1_validation_runs_in_a_thread_verifies_and_never_decodes(
    make_family: MakeFamily, client_for: ClientFor, monkeypatch: pytest.MonkeyPatch
) -> None:
    family = await make_family()
    payload = image_bytes()
    loop_thread = get_ident()
    validator_threads: list[int] = []
    verified: list[int] = []
    original_validate = assets.validate_image
    original_open = Image.open

    def observed_validation(path: Path) -> assets.ImageMetadata:
        validator_threads.append(get_ident())
        return original_validate(path)

    def header_only_open(file: object, *args: object, **kwargs: object) -> Image.Image:
        image = original_open(file, *args, **kwargs)
        original_verify = image.verify

        def verify() -> None:
            verified.append(get_ident())
            original_verify()

        def forbidden_decode(*args: object, **kwargs: object) -> None:
            raise AssertionError("Image validation must never fully decode pixels")

        monkeypatch.setattr(image, "verify", verify)
        monkeypatch.setattr(image, "load", forbidden_decode)
        return image

    monkeypatch.setattr(assets, "validate_image", observed_validation)
    monkeypatch.setattr(Image, "open", header_only_open)
    response = await upload(client_for(family.users[0]), payload)
    assert response.status_code == 201
    assert len(validator_threads) == 1 and validator_threads[0] != loop_thread
    assert verified == validator_threads


async def test_as1_image_validation_precedes_storage_and_storage_precedes_insert(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    family = await make_family()
    payload = image_bytes()
    order: list[str] = []
    original_validate = assets.validate_image
    original_put = LocalStorage.put_file

    def validate(path: Path) -> assets.ImageMetadata:
        assert path.read_bytes() == payload
        order.append("validate")
        return original_validate(path)

    def move(storage: LocalStorage, key: str, path: Path) -> None:
        assert order == ["validate"]
        order.append("storage")
        original_put(storage, key, path)

    def inserting(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        if statement.lstrip().startswith("INSERT INTO asset "):
            assert order == ["validate", "storage"]
            order.append("insert")

    monkeypatch.setattr(assets, "validate_image", validate)
    monkeypatch.setattr(LocalStorage, "put_file", move)
    event.listen(app.state.engine.sync_engine, "before_cursor_execute", inserting)
    try:
        response = await upload(client_for(family.users[0]), payload)
    finally:
        event.remove(app.state.engine.sync_engine, "before_cursor_execute", inserting)
    assert response.status_code == 201
    assert order == ["validate", "storage", "insert"]


@pytest.mark.parametrize("failure", ["stream", "validation", "storage", "commit"])
async def test_as1_every_upload_failure_rolls_back_and_removes_temporary_files(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    payload = image_bytes()
    reached = False
    expected = 500

    class BrokenStream(AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            nonlocal reached
            yield payload[:32]
            reached = True
            raise OSError("Injected stream failure")

    def broken_validation(path: Path) -> assets.ImageMetadata:
        nonlocal reached
        reached = True
        raise ApiError(422, "validation_error", "Injected invalid image")

    def broken_move(storage: LocalStorage, key: str, path: Path) -> None:
        nonlocal reached
        reached = True
        raise OSError("Injected storage failure")

    async def broken_commit(session: AsyncSession) -> None:
        nonlocal reached
        reached = True
        raise SQLAlchemyError("Injected commit failure")

    if failure == "validation":
        monkeypatch.setattr(assets, "validate_image", broken_validation)
        expected = 422
    elif failure == "storage":
        monkeypatch.setattr(LocalStorage, "put_file", broken_move)
    elif failure == "commit":
        monkeypatch.setattr(AsyncSession, "commit", broken_commit)
    client = client_for(family.users[0])
    if failure == "stream":
        response = await client.put(
            f"/api/v1/assets/{uuid4()}?kind=task_proof",
            content=BrokenStream(),
            headers={
                "Content-Length": str(len(payload)),
                "X-Content-SHA256": hashlib.sha256(payload).hexdigest(),
            },
        )
    else:
        response = await upload(client, payload)
    assert response.status_code == expected
    assert reached, "The injected failure must be reached, not an earlier error"
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


async def test_as1_same_id_and_hash_returns_original_row_without_new_revision(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    original = await seed_asset(app, family, frozen_clock)
    before = await database_state(app, family)
    files = file_state(family.blob_dir)
    frozen_clock.advance(timedelta(days=2))
    response = await upload(
        client_for(family.users[1]),
        image_bytes(),
        id=original.id,
        kind="pet_avatar",
        headers={"Idempotency-Key": "deliberately ignored"},
    )
    assert response.status_code == 200
    assert response.json() == Asset.model_validate(original).model_dump(mode="json")
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == files


async def test_as1_same_id_with_other_bytes_is_asset_conflict_without_changes(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    original = await seed_asset(app, family, frozen_clock)
    before = await database_state(app, family)
    files = file_state(family.blob_dir)
    response = await upload(
        client_for(family.users[1]), image_bytes(color="black"), id=original.id
    )
    assert response.status_code == 409 and response.json()["code"] == "asset_conflict"
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == files


@pytest.mark.parametrize("same_hash", [True, False])
async def test_as1_another_familys_asset_id_returns_404_and_leaks_nothing(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    same_hash: bool,
) -> None:
    family, other = await make_family(), await make_family()
    foreign = await seed_asset(app, other, frozen_clock)
    before = await database_state(app, family)
    foreign_before = await database_state(app, other)
    files = file_state(family.blob_dir)
    response = await upload(
        client_for(family.users[0]),
        image_bytes(color="white" if same_hash else "black"),
        id=foreign.id,
    )
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    for private_value in (
        str(foreign.id),
        str(other.id),
        foreign.sha256,
        foreign.storage_key,
    ):
        assert private_value not in response.text
    assert await database_state(app, family) == before
    assert await database_state(app, other) == foreign_before
    assert file_state(family.blob_dir) == files


async def test_as1_concurrent_same_id_uploads_create_one_row_and_one_file(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    id = uuid4()
    payload = image_bytes()
    before = await database_state(app, family)
    responses = await asyncio.gather(
        *(upload(client_for(actor), payload, id=id) for actor in family.users)
    )
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert responses[0].json() == responses[1].json()
    after = await database_state(app, family)
    assert len(after["assets"]) == 1
    assert after["revision"] == before["revision"] + 1
    assert after["mutations"] == before["mutations"]
    assert list(file_state(family.blob_dir).values()) == [payload]


@pytest.mark.parametrize("kind", [None, "unknown"])
async def test_as1_asset_kind_is_required_and_restricted(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor, kind: str | None
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    path = f"/api/v1/assets/{uuid4()}" + ("" if kind is None else f"?kind={kind}")
    payload = image_bytes()
    response = await client_for(family.users[0]).put(
        path,
        content=payload,
        headers={"X-Content-SHA256": hashlib.sha256(payload).hexdigest()},
    )
    assert response.status_code == 422
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


async def test_as1_upload_id_is_client_generated_uuid4(
    app: FastAPI, make_family: MakeFamily, client_for: ClientFor
) -> None:
    family = await make_family()
    before = await database_state(app, family)
    response = await upload(client_for(family.users[0]), image_bytes(), id=uuid1())
    assert response.status_code == 422
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == {}


@pytest.mark.parametrize("actor_index", [0, 1])
async def test_as1_download_is_family_wide_and_returns_exact_bytes_mime_and_cache(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    actor_index: int,
) -> None:
    family = await make_family()
    row = await seed_asset(app, family, frozen_clock)
    before = await database_state(app, family)
    response = await client_for(family.users[actor_index]).get(
        f"/api/v1/assets/{row.id}/file", headers={"Accept-Encoding": "identity"}
    )
    assert response.status_code == 200 and response.content == image_bytes()
    assert response.headers["Content-Type"] == row.mime
    assert response.headers["Cache-Control"] == CACHE_CONTROL
    assert await database_state(app, family) == before


@pytest.mark.parametrize("target", ["unknown", "deleted", "another_family"])
async def test_as1_download_hides_unknown_deleted_and_other_family_assets(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
    target: str,
) -> None:
    family = await make_family()
    owner = await make_family() if target == "another_family" else family
    row = await seed_asset(app, owner, frozen_clock, deleted=target == "deleted")
    id = uuid4() if target == "unknown" else row.id
    response = await client_for(family.users[0]).get(f"/api/v1/assets/{id}/file")
    assert response.status_code == 404 and response.json()["code"] == "not_found"
    assert str(id) not in response.text and row.sha256 not in response.text


async def test_as1_download_requires_authentication(
    app: FastAPI,
    make_family: MakeFamily,
    client: AsyncClient,
    frozen_clock: FrozenClock,
) -> None:
    family = await make_family()
    row = await seed_asset(app, family, frozen_clock)
    response = await client.get(f"/api/v1/assets/{row.id}/file")
    assert response.status_code == 401 and response.json()["code"] == "token_invalid"


@pytest.mark.parametrize(
    "format,mime,extension",
    [
        ("JPEG", "image/jpeg", "jpg"),
        ("PNG", "image/png", "png"),
        ("WEBP", "image/webp", "webp"),
    ],
)
def test_as1_header_validation_returns_detected_image_metadata(
    tmp_path: Path, format: str, mime: str, extension: str
) -> None:
    path = tmp_path / "image.bin"
    path.write_bytes(image_bytes(format, (3, 5)))
    assert assets.validate_image(path) == assets.ImageMetadata(mime, extension, 3, 5)


@pytest.mark.parametrize("fault", ["format", "truncated", "width", "height"])
def test_as1_header_validation_rejects_bad_content(tmp_path: Path, fault: str) -> None:
    path = tmp_path / "image.bin"
    path.write_bytes(
        {
            "format": image_bytes("GIF"),
            "truncated": image_bytes()[:-8],
            "width": png_with_header_size(4097, 1),
            "height": png_with_header_size(1, 4097),
        }[fault]
    )
    with pytest.raises(ApiError) as error:
        assets.validate_image(path)
    assert error.value.status == 422 and error.value.code == "validation_error"


ESCAPING_KEYS = [
    "../escape.bin",
    "family/../../escape.bin",
    "family/../file.bin",
    "/absolute.bin",
    "\\absolute.bin",
    "family\\file.bin",
    "C:/absolute.bin",
    "C:relative.bin",
]


@pytest.mark.parametrize("key", ESCAPING_KEYS)
@pytest.mark.parametrize("operation", ["put_file", "open", "delete", "exists"])
def test_as1_storage_rejects_traversal_absolute_backslash_and_drive_keys(
    tmp_path: Path, key: str, operation: str
) -> None:
    root = tmp_path / "blobs"
    root.mkdir()
    source = tmp_path / "source.bin"
    source.write_bytes(b"source")
    sentinel = tmp_path / "escape.bin"
    sentinel.write_bytes(b"preserve")
    storage: StorageAdapter = LocalStorage(root)
    with pytest.raises(ValueError):
        if operation == "put_file":
            storage.put_file(key, source)
        elif operation == "open":
            storage.open(key)
        elif operation == "delete":
            storage.delete(key)
        else:
            storage.exists(key)
    assert source.read_bytes() == b"source" and sentinel.read_bytes() == b"preserve"
    assert file_state(root) == {}


def test_as1_storage_put_file_uses_atomic_rename_and_moves_the_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "blobs"
    target = root / "family" / "asset.bin"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"previous image")
    source = root / "temporary.bin"
    source.write_bytes(b"new image")
    moves: list[tuple[Path, Path]] = []
    original_replace, original_rename = os.replace, os.rename

    def observe(
        operation: Callable[[Path, Path], None], source_path: Path, target_path: Path
    ) -> None:
        assert target.read_bytes() == b"previous image"
        assert Path(source_path).read_bytes() == b"new image"
        moves.append((Path(source_path), Path(target_path)))
        operation(source_path, target_path)

    def replace(source_path: Path, target_path: Path) -> None:
        observe(original_replace, source_path, target_path)

    def rename(source_path: Path, target_path: Path) -> None:
        observe(original_rename, source_path, target_path)

    monkeypatch.setattr(os, "replace", replace)
    monkeypatch.setattr(os, "rename", rename)
    storage: StorageAdapter = LocalStorage(root)
    storage.put_file("family/asset.bin", source)
    assert moves == [(source, target)]
    assert not source.exists() and target.read_bytes() == b"new image"


def test_as1_storage_open_returns_a_binary_file_with_exact_bytes(
    tmp_path: Path,
) -> None:
    root = tmp_path / "blobs"
    path = root / "family" / "asset.bin"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"\x00\xff\x80image")
    storage: StorageAdapter = LocalStorage(root)
    with storage.open("family/asset.bin") as file:
        assert file.read(3) == b"\x00\xff\x80"
        assert file.read() == b"image"
    assert file.closed


@pytest.mark.parametrize("present", [True, False])
def test_as1_storage_exists_reports_the_named_file(
    tmp_path: Path, present: bool
) -> None:
    root = tmp_path / "blobs"
    root.mkdir()
    if present:
        (root / "asset.bin").write_bytes(b"image")
    storage: StorageAdapter = LocalStorage(root)
    assert storage.exists("asset.bin") is present


@pytest.mark.parametrize("present", [True, False])
def test_as1_storage_delete_is_idempotent_and_preserves_other_files(
    tmp_path: Path, present: bool
) -> None:
    root = tmp_path / "blobs"
    root.mkdir()
    (root / "other.bin").write_bytes(b"preserve")
    if present:
        (root / "asset.bin").write_bytes(b"delete")
    storage: StorageAdapter = LocalStorage(root)
    storage.delete("asset.bin")
    storage.delete("asset.bin")
    assert file_state(root) == {"other.bin": b"preserve"}


async def run_jobs(app: FastAPI, clock: FrozenClock, storage: StorageAdapter) -> None:
    async with app.state.session_factory() as session:
        await maintenance.run_maintenance(session, clock, storage)


AGES = [
    (timedelta(days=29), False),
    (timedelta(days=30) - timedelta(seconds=1), False),
    (timedelta(days=30), False),
    (timedelta(days=30) + timedelta(seconds=1), True),
    (timedelta(days=31), True),
]


@pytest.mark.parametrize("age,swept", AGES)
async def test_as2_orphan_age_is_created_at_and_strictly_older_than_thirty_days(
    app: FastAPI,
    make_family: MakeFamily,
    frozen_clock: FrozenClock,
    age: timedelta,
    swept: bool,
) -> None:
    family = await make_family()
    row = await seed_asset(app, family, frozen_clock, age=age)
    old_revision = row.revision
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    async with app.state.session_factory() as session:
        stored = await session.get(AssetModel, row.id)
        assert stored is not None
        assert stored.created_at == frozen_clock.now() - age
        if swept:
            assert stored.deleted_at == frozen_clock.now()
            assert stored.revision > old_revision
        else:
            assert stored.deleted_at is None and stored.revision == old_revision
    assert (family.blob_dir / row.storage_key).exists() is not swept


@pytest.mark.parametrize("reference", ["pet", "health_event", "task_completion"])
@pytest.mark.parametrize("inactive", [False, True])
async def test_as2_any_pet_health_event_or_completion_reference_prevents_sweep(
    app: FastAPI,
    make_family: MakeFamily,
    frozen_clock: FrozenClock,
    reference: str,
    inactive: bool,
) -> None:
    family = await make_family()
    row = await seed_asset(app, family, frozen_clock, age=timedelta(days=31))
    async with app.state.session_factory() as session:
        if reference == "pet":
            await session.execute(
                update(Pet)
                .where(Pet.id == family.pets[0].id)
                .values(
                    avatar_asset_id=row.id,
                    archived_at=frozen_clock.now() if inactive else None,
                    deleted_at=frozen_clock.now() if inactive else None,
                )
            )
        else:
            values = await family.row_values(session, reference)
            if reference == "health_event":
                values.update(
                    attachment_asset_id=row.id,
                    deleted_at=frozen_clock.now() if inactive else None,
                )
                session.add(HealthEvent(**values))
            else:
                values.update(
                    photo_asset_id=row.id,
                    undone_at=frozen_clock.now() if inactive else None,
                    undone_by=family.users[0].id if inactive else None,
                )
                session.add(TaskCompletion(**values))
        await session.commit()
    before = await database_state(app, family)
    files = file_state(family.blob_dir)
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    assert await database_state(app, family) == before
    assert file_state(family.blob_dir) == files


async def test_as2_a_soft_reference_in_another_family_still_protects_the_asset(
    app: FastAPI, make_family: MakeFamily, frozen_clock: FrozenClock
) -> None:
    family, other = await make_family(), await make_family()
    row = await seed_asset(app, family, frozen_clock, age=timedelta(days=31))
    async with app.state.session_factory() as session:
        await session.execute(
            update(Pet).where(Pet.id == other.pets[0].id).values(avatar_asset_id=row.id)
        )
        await session.commit()
    before = await database_state(app, family)
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    assert await database_state(app, family) == before
    assert (family.blob_dir / row.storage_key).read_bytes() == image_bytes()


async def test_as2_sweep_syncs_tombstones_for_all_families_and_is_idempotent(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
    frozen_clock: FrozenClock,
) -> None:
    families = [await make_family(), await make_family()]
    rows = [
        await seed_asset(app, family, frozen_clock, age=timedelta(days=31))
        for family in families
    ]
    await run_jobs(app, frozen_clock, LocalStorage(families[0].blob_dir))
    for family, row in zip(families, rows, strict=True):
        response = await client_for(family.users[0]).get("/api/v1/sync?since=0")
        matching = [
            change["row"]
            for change in response.json()["changes"]
            if change["entity"] == "assets" and change["row"]["id"] == str(row.id)
        ]
        assert len(matching) == 1
        assert matching[0]["deleted_at"] == frozen_clock.now().isoformat().replace(
            "+00:00", "Z"
        )
        assert not (family.blob_dir / row.storage_key).exists()
    before = [await database_state(app, family) for family in families]
    frozen_clock.advance(timedelta(days=1))
    await run_jobs(app, frozen_clock, LocalStorage(families[0].blob_dir))
    assert [await database_state(app, family) for family in families] == before
    assert file_state(families[0].blob_dir) == {}


@pytest.mark.parametrize("age,pruned", AGES)
async def test_as2_maintenance_prunes_refresh_tokens_by_expiry_with_injected_clock(
    app: FastAPI,
    make_family: MakeFamily,
    frozen_clock: FrozenClock,
    age: timedelta,
    pruned: bool,
) -> None:
    family = await make_family()
    id = uuid4()
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=id,
                user_id=family.users[0].id,
                chain_id=uuid4(),
                token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                expires_at=frozen_clock.now() - age,
            )
        )
        await session.commit()
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    async with app.state.session_factory() as session:
        assert (await session.get(RefreshToken, id) is None) is pruned


async def test_as2_expired_refresh_parent_is_pruned_without_losing_retained_child(
    app: FastAPI, make_family: MakeFamily, frozen_clock: FrozenClock
) -> None:
    family = await make_family()
    parent_id, child_id, chain_id = uuid4(), uuid4(), uuid4()
    child_hash = hashlib.sha256(uuid4().bytes).hexdigest()
    child_expiry = frozen_clock.now() + timedelta(days=10)
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=parent_id,
                user_id=family.users[0].id,
                chain_id=chain_id,
                token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                expires_at=frozen_clock.now() - timedelta(days=31),
            )
        )
        await session.flush()
        session.add(
            RefreshToken(
                id=child_id,
                user_id=family.users[0].id,
                chain_id=chain_id,
                parent_id=parent_id,
                token_hash=child_hash,
                expires_at=child_expiry,
            )
        )
        await session.commit()
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    async with app.state.session_factory() as session:
        assert await session.get(RefreshToken, parent_id) is None
        child = await session.get(RefreshToken, child_id)
        assert child is not None and child.parent_id is None
        assert child.chain_id == chain_id and child.token_hash == child_hash
        assert child.expires_at == child_expiry


@pytest.mark.parametrize("age,pruned", AGES)
@pytest.mark.parametrize("used", [True, False])
async def test_as2_maintenance_prunes_used_or_expired_invites_after_thirty_days(
    app: FastAPI,
    make_family: MakeFamily,
    frozen_clock: FrozenClock,
    age: timedelta,
    pruned: bool,
    used: bool,
) -> None:
    family = await make_family()
    code = uuid4().hex[:10].upper()
    async with app.state.session_factory() as session:
        session.add(
            InviteCode(
                code=code,
                family_id=family.id,
                role="member",
                created_by=family.users[0].id,
                expires_at=(frozen_clock.now() + timedelta(days=1))
                if used
                else frozen_clock.now() - age,
                used_at=frozen_clock.now() - age if used else None,
                used_by=family.users[0].id if used else None,
            )
        )
        await session.commit()
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    async with app.state.session_factory() as session:
        assert (await session.get(InviteCode, code) is None) is pruned


async def test_as2_maintenance_preserves_live_tokens_and_unused_unexpired_invites(
    app: FastAPI, make_family: MakeFamily, frozen_clock: FrozenClock
) -> None:
    family = await make_family()
    token_id = uuid4()
    code = uuid4().hex[:10].upper()
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=token_id,
                user_id=family.users[0].id,
                chain_id=uuid4(),
                token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                expires_at=frozen_clock.now() + timedelta(days=1),
            )
        )
        session.add(
            InviteCode(
                code=code,
                family_id=family.id,
                role="member",
                created_by=family.users[0].id,
                expires_at=frozen_clock.now() + timedelta(days=1),
            )
        )
        await session.commit()
    await run_jobs(app, frozen_clock, LocalStorage(family.blob_dir))
    async with app.state.session_factory() as session:
        assert await session.get(RefreshToken, token_id) is not None
        assert await session.get(InviteCode, code) is not None


async def test_as2_maintenance_cli_function_runs_all_three_jobs_with_its_clock(
    app: FastAPI, settings: Settings, make_family: MakeFamily, frozen_clock: FrozenClock
) -> None:
    family = await make_family()
    row = await seed_asset(app, family, frozen_clock, age=timedelta(days=31))
    token_id = uuid4()
    code = uuid4().hex[:10].upper()
    async with app.state.session_factory() as session:
        session.add(
            RefreshToken(
                id=token_id,
                user_id=family.users[0].id,
                chain_id=uuid4(),
                token_hash=hashlib.sha256(uuid4().bytes).hexdigest(),
                expires_at=frozen_clock.now() - timedelta(days=31),
            )
        )
        session.add(
            InviteCode(
                code=code,
                family_id=family.id,
                role="member",
                created_by=family.users[0].id,
                expires_at=frozen_clock.now() - timedelta(days=31),
            )
        )
        await session.commit()
    await cli.maintenance(settings, frozen_clock)
    async with app.state.session_factory() as session:
        stored = await session.get(AssetModel, row.id)
        assert stored is not None and stored.deleted_at == frozen_clock.now()
        assert await session.get(RefreshToken, token_id) is None
        assert await session.get(InviteCode, code) is None
    assert not (family.blob_dir / row.storage_key).exists()


def test_as2_maintenance_command_dispatches_with_the_injected_clock(
    settings: Settings, frozen_clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "Settings", lambda: settings)
    monkeypatch.setattr(cli, "SystemClock", lambda: frozen_clock)
    assert cli.main(["maintenance"]) == 0
