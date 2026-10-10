import asyncio
import json
from typing import cast
from uuid import UUID

from fastapi import APIRouter, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocketDisconnect

from app.clock import Clock
from app.errors import ApiError
from app.realtime import Hub, enabled_user, family_revision
from app.security.tokens import decode_access
from app.settings import Settings

router = APIRouter()


@router.websocket("/ws")
async def socket(ws: WebSocket) -> None:
    settings = cast(Settings, ws.app.state.settings)
    clock = cast(Clock, ws.app.state.clock)
    hub = cast(Hub, ws.app.state.hub)
    factory = cast(async_sessionmaker[AsyncSession], ws.app.state.session_factory)
    family_id: UUID | None = None
    await ws.accept()
    try:
        try:
            async with asyncio.timeout(settings.ws_auth_timeout_seconds):
                frame: object = await ws.receive_json()
        except TimeoutError:
            await ws.close(code=4408)
            return
        except (ValueError, KeyError):
            await ws.close(code=4401)
            return
        if not isinstance(frame, dict) or frame.get("type") != "auth":
            await ws.close(code=4401)
            return
        access = frame.get("access_token")
        if not isinstance(access, str):
            await ws.close(code=4401)
            return
        try:
            claims = decode_access(access, clock, settings)
        except ApiError:
            await ws.close(code=4401)
            return
        async with factory() as session:
            valid = await enabled_user(session, claims)
        if not valid:
            await ws.close(code=4401)
            return
        family_id = claims.fam
        ws.state.access_expires_at = claims.exp
        await hub.register(family_id, ws)
        async with factory() as session:
            revision = await family_revision(session, family_id)
        if not await hub.send(family_id, ws, "ready", revision):
            return
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            if not await hub.check_expiry(family_id, ws):
                return
            text = message.get("text")
            if text is None:
                await ws.close(code=4401)
                return
            frame = json.loads(text)
            if isinstance(frame, dict) and frame.get("type") == "ping":
                async with factory() as session:
                    revision = await family_revision(session, family_id)
                if not await hub.send(family_id, ws, "pong", revision):
                    return
    except WebSocketDisconnect:
        pass
    except (ValueError, KeyError):
        await ws.close(code=4401)
    finally:
        if family_id is not None:
            await hub.unregister(family_id, ws)
