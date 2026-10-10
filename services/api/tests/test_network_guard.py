"""Prove the suite-wide HTTP guard stops requests before network access."""

import socket
from typing import NoReturn

import httpx
import pytest


async def test_plain_http_client_fails_before_dns_or_socket_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts: list[tuple[object, ...]] = []

    def attempted(*args: object, **kwargs: object) -> NoReturn:
        attempts.append(args)
        raise AssertionError("A network operation reached the socket layer")

    monkeypatch.setattr(socket, "getaddrinfo", attempted)
    monkeypatch.setattr(socket.socket, "connect", attempted)
    monkeypatch.setattr(socket.socket, "connect_ex", attempted)

    async with httpx.AsyncClient() as client:
        with pytest.raises(
            AssertionError,
            match="^API tests must use ASGITransport or MockTransport$",
        ):
            await client.get("https://example.com/network-guard-proof")

    assert attempts == []
