from httpx import AsyncClient


async def test_r1_1_public_registration_does_not_exist(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/register", json={})
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
