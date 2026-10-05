import pytest
from httpx import AsyncClient

from tests.conftest import ClientFor
from tests.factories import MakeFamily
from tests.security.matrix import PERMISSION_MATRIX


@pytest.mark.parametrize("role", ["member", "leader"])
@pytest.mark.parametrize("route", PERMISSION_MATRIX)
async def test_rb1_permission_row_returns_expected_status(
    make_family: MakeFamily,
    client_for: ClientFor,
    role: str,
    route: tuple[str, str],
) -> None:
    family = await make_family()
    actor = next(user for user in family.users if user.role == role)
    case = PERMISSION_MATRIX[route]
    request = await case.request(family, actor)
    response = await client_for(actor).request(
        *route, json=request.json, headers=request.headers
    )
    assert response.status_code == case.expected[role], (
        case.row,
        route,
        role,
        response.status_code,
    )


async def test_rb2_member_is_forbidden_on_every_implemented_leader_only_case(
    make_family: MakeFamily,
    client_for: ClientFor,
) -> None:
    # No leader-only routes exist in P2-5; future entries join this check.
    for route, case in PERMISSION_MATRIX.items():
        assert set(case.expected) == {"member", "leader"}
        if case.expected["member"] != 403:
            continue
        family = await make_family()
        actor = next(user for user in family.users if user.role == "member")
        request = await case.request(family, actor)
        client: AsyncClient = client_for(actor)
        response = await client.request(
            *route, json=request.json, headers=request.headers
        )
        assert response.status_code == 403, (case.row, route, response.status_code)
