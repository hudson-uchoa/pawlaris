import json
import logging
import re
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.parametrize("path", ["/api/v1/health", "/missing", "/probe/error"])
async def test_r5_9_every_response_has_numeric_timing(
    client: AsyncClient,
    path: str,
) -> None:
    response = await client.get(path)
    assert "Server-Timing" in response.headers
    assert re.fullmatch(r"app;dur=\d+(\.\d+)?", response.headers["Server-Timing"])
    assert response.headers["X-Request-ID"]


async def test_r5_9_timing_matches_log_and_echoes_request_id(
    client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="pawlaris.request")
    response = await client.post(
        "/probe/write",
        json={
            "id": str(uuid4()),
            "marker": uuid4().hex,
        },
        headers={"X-Request-ID": "timing-test"},
    )
    assert response.status_code == 200
    assert response.headers["Server-Timing"] == "app;dur=12.500"
    assert response.headers["X-Request-ID"] == "timing-test"
    record = next(
        record for record in caplog.records if record.name == "pawlaris.request"
    )
    logged = json.loads(record.getMessage())
    assert set(logged) == {
        "ts",
        "level",
        "msg",
        "request_id",
        "method",
        "path",
        "status",
        "ms",
        "user_id",
    }
    assert logged["ts"] == "2026-09-14T10:30:00.012500Z"
    assert logged["ms"] == 12.5
    assert logged["status"] == 200
    assert logged["method"] == "POST"
    assert logged["path"] == "/probe/write"
    assert logged["request_id"] == "timing-test"
    assert logged["user_id"] is None


async def test_r5_9_large_response_uses_gzip(client: AsyncClient) -> None:
    response = await client.post(
        "/probe/body",
        json={
            "id": str(uuid4()),
            "marker": "x" * 2000,
        },
        headers={"Accept-Encoding": "gzip"},
    )
    assert response.status_code == 200
    assert "content-encoding" in response.headers
    assert response.headers["content-encoding"] == "gzip"
    assert response.json()["marker"] == "x" * 2000


async def test_r5_9_small_response_is_not_compressed(client: AsyncClient) -> None:
    response = await client.post(
        "/probe/body",
        json={
            "id": str(uuid4()),
            "marker": "small",
        },
        headers={"Accept-Encoding": "gzip"},
    )
    assert response.status_code == 200
    assert "content-encoding" not in response.headers
