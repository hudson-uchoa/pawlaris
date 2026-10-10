from fastapi import APIRouter, WebSocket

router = APIRouter()


@router.websocket("/ws")
async def socket(ws: WebSocket) -> None:
    raise NotImplementedError
