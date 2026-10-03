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
