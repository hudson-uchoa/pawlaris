from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from uuid import UUID

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.locks import lock_family as lock_family
from app.models import AppUser
from app.schemas.assets import AssetKind
from app.schemas.rows import Asset
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
    raise NotImplementedError


async def upload_asset(
    session: AsyncSession,
    user: AppUser,
    id: UUID,
    kind: AssetKind,
    request: Request,
    clock: Clock,
    storage: StorageAdapter,
) -> tuple[Asset, bool]:
    raise NotImplementedError


async def download_asset(
    session: AsyncSession, user: AppUser, id: UUID, storage: StorageAdapter
) -> tuple[BinaryIO, str]:
    raise NotImplementedError
