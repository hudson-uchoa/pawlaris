from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from pydantic import UUID4
from starlette.responses import StreamingResponse

from app.routers.auth import Configuration, Database, RequestClock, User
from app.schemas.assets import AssetKind
from app.schemas.rows import Asset

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
                "description": "Image byte count; missing or over 8 MB returns 413.",
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
) -> Asset:
    raise NotImplementedError


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
    raise NotImplementedError
