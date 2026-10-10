from collections.abc import Iterator
from typing import Annotated, BinaryIO
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from pydantic import UUID4
from starlette.responses import StreamingResponse

from app.routers.auth import Configuration, Database, Poke, RequestClock, User
from app.schemas.assets import AssetKind
from app.schemas.rows import Asset
from app.services import assets
from app.storage.local import LocalStorage

router = APIRouter()


@router.put(
    "/assets/{id}",
    response_model=Asset,
    status_code=201,
    responses={
        200: {"model": Asset, "description": "Existing asset with the same hash."}
    },
    openapi_extra={
        "parameters": [
            {
                "name": "Content-Length",
                "in": "header",
                "required": True,
                "description": (
                    "Image byte count; missing or over 8 MiB "
                    "(8 388 608 bytes) returns 413."
                ),
                "schema": {"type": "integer", "minimum": 0},
            },
            {
                "name": "X-Content-SHA256",
                "in": "header",
                "required": True,
                "description": "SHA-256 of the raw image bytes, in hexadecimal.",
                "schema": {"type": "string", "pattern": "^[0-9a-fA-F]{64}$"},
            },
        ],
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        },
    },
)
async def upload_asset(
    id: UUID4,
    request: Request,
    response: Response,
    user: User,
    session: Database,
    clock: RequestClock,
    settings: Configuration,
    kind: Annotated[AssetKind, Query()],
    poke: Poke,
) -> Asset:
    row, created = await assets.upload_asset(
        session, user, id, kind, request, clock, LocalStorage(settings.blob_dir), poke
    )
    response.status_code = 201 if created else 200
    return row


@router.get(
    "/assets/{id}/file",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Stored image bytes.",
            "content": {
                mime: {"schema": {"type": "string", "format": "binary"}}
                for mime in ("image/jpeg", "image/png", "image/webp")
            },
            "headers": {
                "Cache-Control": {
                    "schema": {
                        "type": "string",
                        "enum": ["private, max-age=31536000, immutable"],
                    }
                }
            },
        }
    },
)
async def download_asset(
    id: UUID, user: User, session: Database, settings: Configuration
) -> StreamingResponse:
    file, mime = await assets.download_asset(
        session, user, id, LocalStorage(settings.blob_dir)
    )
    return StreamingResponse(
        file_chunks(file),
        media_type=mime,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


def file_chunks(file: BinaryIO) -> Iterator[bytes]:
    with file:
        while chunk := file.read(64 * 1024):
            yield chunk
