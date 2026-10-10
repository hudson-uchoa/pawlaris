import asyncio
import hashlib
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

from fastapi import Request
from PIL import Image
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.db import transactional
from app.deps import get_settings
from app.errors import ApiError
from app.locks import lock_family
from app.models import AppUser
from app.models import Asset as AssetModel
from app.schemas.assets import AssetKind
from app.schemas.rows import Asset
from app.services.common import get_owned
from app.storage.base import StorageAdapter

# Q-18: keep the byte interpretation of the documented limit in one place.
UPLOAD_MAX_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ImageMetadata:
    mime: str
    extension: str
    width: int
    height: int


def validate_image(path: Path) -> ImageMetadata:
    formats = {
        "JPEG": ("image/jpeg", "jpg"),
        "PNG": ("image/png", "png"),
        "WEBP": ("image/webp", "webp"),
    }
    try:
        with Image.open(path, formats=("JPEG", "PNG", "WEBP")) as image:
            detected = formats.get(image.format or "")
            width, height = image.size
            if detected is None or not (1 <= width <= 4096 and 1 <= height <= 4096):
                raise ApiError(
                    422, "validation_error", "Unsupported image format or size."
                )
            image.verify()
            return ImageMetadata(*detected, width, height)
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise ApiError(422, "validation_error", "Invalid image content.") from exc


async def upload_asset(
    session: AsyncSession,
    user: AppUser,
    id: UUID,
    kind: AssetKind,
    request: Request,
    clock: Clock,
    storage: StorageAdapter,
) -> tuple[Asset, bool]:
    temporary: Path | None = None
    storage_key: str | None = None

    async def write() -> tuple[Asset, bool]:
        nonlocal storage_key
        await lock_family(session, user.family_id)
        actor = await session.scalar(
            select(AppUser)
            .where(AppUser.id == user.id, AppUser.family_id == user.family_id)
            .execution_options(populate_existing=True)
        )
        if actor is None or actor.disabled_at is not None:
            raise ApiError(401, "token_invalid", "Invalid or expired access token.")

        existing = await session.scalar(
            select(AssetModel).where(
                AssetModel.family_id == actor.family_id, AssetModel.id == id
            )
        )
        if existing is not None:
            if existing.sha256 != sha256:
                raise ApiError(409, "asset_conflict", "Asset id has different content.")
            return Asset.model_validate(existing), False

        storage_key = f"{actor.family_id}/{id}.{metadata.extension}"
        await asyncio.to_thread(storage.put_file, storage_key, temporary_path)
        row = await session.scalar(
            insert(AssetModel)
            .values(
                id=id,
                family_id=actor.family_id,
                kind=kind,
                storage_key=storage_key,
                mime=metadata.mime,
                bytes=count,
                width=metadata.width,
                height=metadata.height,
                sha256=sha256,
                uploaded_by=actor.id,
                created_at=clock.now(),
            )
            .on_conflict_do_nothing(index_elements=[AssetModel.id])
            .returning(AssetModel)
        )
        if row is None:
            # The scoped lookup hides a globally occupied id in another family.
            await get_owned(session, AssetModel, id, actor)
            raise ApiError(409, "asset_conflict", "Asset id has different content.")
        return Asset.model_validate(row), True

    try:
        raw_length = request.headers.get("Content-Length")
        try:
            length = int(raw_length) if raw_length is not None else -1
        except ValueError:
            length = -1
        if not 0 <= length <= UPLOAD_MAX_BYTES:
            raise ApiError(413, "payload_too_large", "Image exceeds the upload limit.")

        directory = get_settings(request).blob_dir
        await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
        digest = hashlib.sha256()
        count = 0
        with tempfile.NamedTemporaryFile(
            dir=directory, delete=False, buffering=0
        ) as file:
            temporary_path = Path(file.name)
            temporary = temporary_path
            async for chunk in request.stream():
                count += len(chunk)
                if count > UPLOAD_MAX_BYTES:
                    raise ApiError(
                        413, "payload_too_large", "Image exceeds the upload limit."
                    )
                digest.update(chunk)
                await asyncio.to_thread(file.write, chunk)
        sha256 = digest.hexdigest()
        claimed_hash = request.headers.get("X-Content-SHA256", "")
        if (
            re.fullmatch(r"[0-9a-fA-F]{64}", claimed_hash) is None
            or claimed_hash.lower() != sha256
        ):
            raise ApiError(
                422, "validation_error", "Image hash does not match the body."
            )
        metadata = await asyncio.to_thread(validate_image, temporary)

        return await transactional(session, write)
    except BaseException:
        if storage_key is not None:
            await asyncio.to_thread(storage.delete, storage_key)
        raise
    finally:
        if temporary is not None:
            await asyncio.to_thread(temporary.unlink, missing_ok=True)


async def download_asset(
    session: AsyncSession, user: AppUser, id: UUID, storage: StorageAdapter
) -> tuple[BinaryIO, str]:
    row = await get_owned(session, AssetModel, id, user, include_deleted=False)
    try:
        file = await asyncio.to_thread(storage.open, row.storage_key)
    except FileNotFoundError:
        raise ApiError(404, "not_found", "Asset file not found.") from None
    return file, row.mime
