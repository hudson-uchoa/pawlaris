from typing import Annotated

import pytest
from fastapi import Depends, FastAPI

from app.deps import current_user
from app.models import AppUser
from tests.security.matrix import PERMISSION_MATRIX, PermissionCase


def assert_route_census(application: FastAPI) -> None:
    raise NotImplementedError("not implemented")


def test_census_every_production_route_is_public_or_authenticated_and_listed(
    production_app: FastAPI,
) -> None:
    assert_route_census(production_app)


def test_census_rejects_dummy_unauthenticated_route_on_fresh_app(
    production_app: FastAPI,
) -> None:
    async def dummy() -> dict[str, str]:
        return {"status": "unsafe"}

    production_app.add_api_route("/unsafe", dummy, methods=["GET"])
    with pytest.raises(AssertionError, match="GET /unsafe.*authentication"):
        assert_route_census(production_app)


def test_census_rejects_listed_route_without_authentication(
    production_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def dummy() -> dict[str, str]:
        return {"status": "unsafe"}

    production_app.add_api_route("/unsafe", dummy, methods=["GET"])
    existing = PERMISSION_MATRIX[("GET", "/api/v1/me")]
    monkeypatch.setitem(PERMISSION_MATRIX, ("GET", "/unsafe"), existing)
    with pytest.raises(AssertionError, match="GET /unsafe.*authentication"):
        assert_route_census(production_app)


def test_census_rejects_authenticated_route_without_matrix_row(
    production_app: FastAPI,
) -> None:
    async def dummy(user: Annotated[AppUser, Depends(current_user)]) -> None:
        pass

    production_app.add_api_route("/unlisted", dummy, methods=["GET"])
    with pytest.raises(AssertionError, match="GET /unlisted.*matrix"):
        assert_route_census(production_app)


def test_census_accepts_transitive_authentication_dependency(
    production_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def nested(user: Annotated[AppUser, Depends(current_user)]) -> AppUser:
        return user

    async def dummy(user: Annotated[AppUser, Depends(nested)]) -> None:
        pass

    production_app.add_api_route("/nested", dummy, methods=["GET"])
    existing = PERMISSION_MATRIX[("GET", "/api/v1/me")]
    monkeypatch.setitem(
        PERMISSION_MATRIX,
        ("GET", "/nested"),
        PermissionCase(existing.row, existing.request, existing.expected),
    )
    assert_route_census(production_app)


@pytest.mark.parametrize("attribute", ["docs_url", "redoc_url", "openapi_url"])
def test_census_rejects_documentation_configuration(
    production_app: FastAPI, attribute: str
) -> None:
    setattr(production_app, attribute, "/documentation")
    with pytest.raises(AssertionError, match="documentation"):
        assert_route_census(production_app)


@pytest.mark.parametrize("paths", [["/other"], ["/ws", "/ws"]])
def test_census_rejects_wrong_or_multiple_websocket_routes(
    production_app: FastAPI, paths: list[str]
) -> None:
    async def socket() -> None:
        pass

    for path in paths:
        production_app.add_api_websocket_route(path, socket)
    with pytest.raises(AssertionError, match="WebSocket"):
        assert_route_census(production_app)


def test_census_allows_one_ws_route_until_ws2_arrives(
    production_app: FastAPI,
) -> None:
    async def socket() -> None:
        pass

    production_app.add_api_websocket_route("/ws", socket)
    assert_route_census(production_app)
