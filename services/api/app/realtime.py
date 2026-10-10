from uuid import UUID

from fastapi import WebSocket


class Hub:
    async def register(self, family_id: UUID, ws: WebSocket) -> None:
        raise NotImplementedError

    async def unregister(self, family_id: UUID, ws: WebSocket) -> None:
        raise NotImplementedError

    async def poke(self, family_id: UUID, revision: int) -> None:
        raise NotImplementedError
