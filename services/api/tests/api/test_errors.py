import json
import logging
from uuid import uuid4

import pytest
from httpx import AsyncClient


@pytest.mark.parametrize("path", ["/missing", "/docs", "/redoc", "/openapi.json"])
async def test_unknown_route_is_not_found_problem(
    client: AsyncClient, path: str
) -> None:
    response = await client.get(path)
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == {
        "type": "about:blank",
        "title": "Not Found",
        "status": 404,
        "code": "not_found",
        "detail": "Not Found",
    }


@pytest.mark.parametrize(
    "body",
    [
        {"id": "invalid", "marker": "test"},
        {"id": str(uuid4()), "marker": "test", "unknown": True},
    ],
)
async def test_bad_body_is_validation_problem(
    client: AsyncClient,
    body: dict[str, object],
) -> None:
    response = await client.post("/probe/body", json=body)
    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    problem = response.json()
    assert problem["code"] == "validation_error"
    assert problem["type"] == "about:blank"
    assert problem["status"] == 422
    assert problem["errors"]
    assert all(set(error) == {"loc", "msg"} for error in problem["errors"])
    assert all(error["loc"][0] == "body" for error in problem["errors"])


async def test_api_error_preserves_status_code_and_detail(client: AsyncClient) -> None:
    response = await client.get("/probe/error")
    assert response.status_code == 409
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == {
        "type": "about:blank",
        "title": "Conflict",
        "status": 409,
        "code": "last_leader",
        "detail": "A family must keep an enabled leader.",
    }


async def test_r1_failed_commit_logs_cause_without_exposing_it(
    client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.ERROR, logger="pawlaris.request")
    response = await client.post(
        "/probe/write",
        json={"id": str(uuid4()), "marker": uuid4().hex, "fail_commit": True},
        headers={"X-Request-ID": "failed-commit-test"},
    )
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/problem+json"
    assert response.headers["Server-Timing"] == "app;dur=12.500"
    assert response.headers["X-Request-ID"] == "failed-commit-test"
    assert response.json() == {
        "type": "about:blank",
        "title": "Internal Server Error",
        "status": 500,
        "code": "internal_error",
        "detail": "Internal server error.",
    }
    records = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(records) == 1
    logged = json.loads(records[0].getMessage())
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
        "exc",
    }
    assert logged["level"] == "ERROR"
    assert logged["request_id"] == "failed-commit-test"
    assert logged["method"] == "POST"
    assert logged["path"] == "/probe/write"
    assert logged["status"] == 500
    assert logged["ms"] == 12.5
    assert logged["ts"] == "2026-09-14T10:30:00.012500Z"
    assert "Traceback (most recent call last):" in logged["exc"]
    assert "IntegrityError" in logged["exc"]
    assert "UniqueViolationError" in logged["exc"]
