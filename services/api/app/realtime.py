import asyncio
import json
import logging
import traceback
from collections.abc import Awaitable, Callable
from typing import cast
from uuid import UUID

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect, WebSocketDisconnected

from app.clock import Clock
from app.models import AppUser, FamilyRevision
from app.security.tokens import AccessClaims

type PokeAfterCommit = Callable[[UUID], Awaitable[None]]


async def enabled_user(session: AsyncSession, claims: AccessClaims) -> bool:
    return (
        await session.scalar(
            select(AppUser.id).where(
                AppUser.id == claims.sub,
                AppUser.family_id == claims.fam,
                AppUser.disabled_at.is_(None),
            )
        )
    ) is not None


async def family_revision(session: AsyncSession, family_id: UUID) -> int:
    return (
        await session.execute(
            select(FamilyRevision.value).where(FamilyRevision.family_id == family_id)
        )
    ).scalar_one()


class Hub:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.sockets: dict[UUID, set[WebSocket]] = {}

    async def register(self, family_id: UUID, ws: WebSocket) -> None:
        self.sockets.setdefault(family_id, set()).add(ws)

    async def unregister(self, family_id: UUID, ws: WebSocket) -> None:
        sockets = self.sockets.get(family_id)
        if sockets is not None:
            sockets.discard(ws)
            if not sockets:
                del self.sockets[family_id]

    async def check_expiry(self, family_id: UUID, ws: WebSocket) -> bool:
        if ws not in self.sockets.get(family_id, set()):
            return False
        if cast(int, ws.state.access_expires_at) <= self.clock.now().timestamp():
            await self.unregister(family_id, ws)
            await ws.close(code=4401)
            return False
        return True

    async def send(
        self, family_id: UUID, ws: WebSocket, kind: str, revision: int
    ) -> bool:
        try:
            if not await self.check_expiry(family_id, ws):
                return False
            await ws.send_json({"type": kind, "revision": revision})
            return True
        except (WebSocketDisconnect, WebSocketDisconnected):
            await self.unregister(family_id, ws)
            return False
        except Exception:
            await self.unregister(family_id, ws)
            logging.getLogger("pawlaris.realtime").error(
                json.dumps(
                    {
                        "level": "ERROR",
                        "msg": "WebSocket delivery failed",
                        "exc": traceback.format_exc(),
                    }
                )
            )
            return False

    async def poke(self, family_id: UUID, revision: int) -> None:
        for ws in tuple(self.sockets.get(family_id, ())):
            await self.send(family_id, ws, "poke", revision)

    async def sweep(self, seconds: float) -> None:
        while True:
            await asyncio.sleep(seconds)
            for family_id, sockets in tuple(self.sockets.items()):
                for ws in tuple(sockets):
                    try:
                        await self.check_expiry(family_id, ws)
                    except (WebSocketDisconnect, WebSocketDisconnected):
                        await self.unregister(family_id, ws)
                    except Exception:
                        await self.unregister(family_id, ws)
                        logging.getLogger("pawlaris.realtime").error(
                            json.dumps(
                                {
                                    "level": "ERROR",
                                    "msg": "WebSocket expiry close failed",
                                    "exc": traceback.format_exc(),
                                }
                            )
                        )
