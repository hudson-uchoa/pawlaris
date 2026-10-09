import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import ClientFor
from tests.factories import MakeFamily
from tests.security.matrix import PERMISSION_MATRIX, PermissionCase


async def test_rb1_runs_two_cases_for_one_parameterized_route(
    app: FastAPI,
    make_family: MakeFamily,
    client_for: ClientFor,
) -> None:
    from app.models import AppUser
    from tests.factories import TestFamily
    from tests.security.matrix import MatrixRequest, PermissionCase

    assert isinstance(PERMISSION_MATRIX, list), "RB-1 requires a list of cases"
    seen: list[tuple[str, str]] = []

    async def probe(item_id: str, body: dict[str, str]) -> dict[str, str]:
        seen.append((item_id, body["case"]))
        return body

    app.add_api_route("/matrix/probe/{item_id}", probe, methods=["POST"])

    async def first(fam: TestFamily, actor: AppUser) -> MatrixRequest:
        return MatrixRequest(url=f"/matrix/probe/{actor.id}", json={"case": "first"})

    async def second(fam: TestFamily, actor: AppUser) -> MatrixRequest:
        return MatrixRequest(url=f"/matrix/probe/{fam.id}", json={"case": "second"})

    cases = [
        PermissionCase(
            11, "POST", "/matrix/probe/{item_id}", first, {"member": 200, "leader": 200}
        ),
        PermissionCase(
            12,
            "POST",
            "/matrix/probe/{item_id}",
            second,
            {"member": 200, "leader": 200},
        ),
    ]
    for role in ("member", "leader"):
        for case in cases:
            await test_rb1_permission_row_returns_expected_status(
                make_family, client_for, role, case
            )
    assert len(seen) == 4
    assert [label for _, label in seen] == ["first", "second", "first", "second"]
    assert all("{" not in item_id for item_id, _ in seen)


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize("case", PERMISSION_MATRIX)
async def test_rb1_permission_row_returns_expected_status(
    make_family: MakeFamily,
    client_for: ClientFor,
    role: str,
    case: PermissionCase,
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    request = await case.request(family, actor)
    response = await client_for(actor).request(
        case.method, request.url, json=request.json, headers=request.headers
    )
    assert response.status_code == case.expected[role], (
        case.row,
        case.template,
        role,
        response.status_code,
    )


async def test_rb2_member_is_forbidden_on_every_implemented_leader_only_case(
    make_family: MakeFamily,
    client_for: ClientFor,
) -> None:
    for case in PERMISSION_MATRIX:
        assert set(case.expected) == {"member", "leader"}
        if case.expected["member"] != 403:
            continue
        family = await make_family()
        actor = next(user for user in family.users if user.role == "member")
        request = await case.request(family, actor)
        client: AsyncClient = client_for(actor)
        response = await client.request(
            case.method, request.url, json=request.json, headers=request.headers
        )
        assert response.status_code == 403, (
            case.row,
            case.template,
            response.status_code,
        )
