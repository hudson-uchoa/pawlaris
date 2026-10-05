from typing import Annotated, cast

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from starlette.routing import Route, WebSocketRoute

from app.deps import current_user
from app.models import AppUser
from tests.security.matrix import PERMISSION_MATRIX, PUBLIC_ROUTES, PermissionCase


def requires_authentication(dependency: Dependant) -> bool:
    return dependency.call is current_user or any(
        requires_authentication(child) for child in dependency.dependencies
    )


def assert_route_census(application: FastAPI) -> None:
    violations: list[str] = []
    if any(
        url is not None
        for url in (
            application.docs_url,
            application.redoc_url,
            application.openapi_url,
        )
    ):
        violations.append("documentation routes must be disabled")
    sockets: list[str] = []
    registered: set[tuple[str, str]] = set()
    # FastAPI keeps included routers lazy; contexts expose their effective
    # paths and dependencies, including router-level authentication.
    for context in iter_route_contexts(application.routes):
        route = context.original_route
        if isinstance(route, WebSocketRoute):
            assert context.path is not None
            sockets.append(context.path)
            continue
        if not isinstance(route, Route):
            violations.append(f"Unexamined route: {route}")
            continue
        assert context.path is not None
        for method in context.methods or set():
            key = (method, context.path)
            registered.add(key)
            if key in PUBLIC_ROUTES:
                continue
            label = f"{method} {context.path}"
            dependency = (
                cast(Dependant | None, context.dependant)
                if isinstance(route, APIRoute)
                else None
            )
            if dependency is None or not requires_authentication(dependency):
                violations.append(f"{label} requires authentication")
            if key not in PERMISSION_MATRIX:
                violations.append(f"{label} requires a permission matrix row")
    if len(sockets) > 1 or any(path != "/ws" for path in sockets):
        violations.append(f"WebSocket routes must be at most one /ws: {sockets}")
    for key in PERMISSION_MATRIX.keys() - registered:
        violations.append(f"{key[0]} {key[1]} matrix row has no route")
    assert not violations, "\n".join(violations)


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


def test_census_rejects_hidden_route_in_included_router(
    production_app: FastAPI,
) -> None:
    router = APIRouter()

    async def dummy() -> None:
        pass

    router.add_api_route("/unsafe", dummy, methods=["GET"], include_in_schema=False)
    production_app.include_router(router, prefix="/hidden")
    with pytest.raises(AssertionError, match="GET /hidden/unsafe.*authentication"):
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


def test_census_accepts_authentication_applied_when_including_router(
    production_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    router = APIRouter()

    async def dummy() -> None:
        pass

    router.add_api_route("/protected", dummy, methods=["GET"])
    production_app.include_router(
        router, prefix="/included", dependencies=[Depends(current_user)]
    )
    monkeypatch.setitem(
        PERMISSION_MATRIX,
        ("GET", "/included/protected"),
        PERMISSION_MATRIX[("GET", "/api/v1/me")],
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
