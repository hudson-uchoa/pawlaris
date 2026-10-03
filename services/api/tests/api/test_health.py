from datetime import timedelta
from pathlib import Path
from shutil import _ntuple_diskusage

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from sqlalchemy.engine import make_url

from app.clock import FrozenClock
from app.main import create_app
from app.settings import Settings


async def test_health_reports_ok_and_real_database(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["db"] is True
    assert body["status"] == "ok"
    assert body["disk_free_mb"] >= 500
    assert body["version"] == "dev"
    assert body["uptime_s"] == 0
    assert set(body) == {"status", "db", "disk_free_mb", "version", "uptime_s"}


async def test_health_uptime_uses_injected_monotonic_clock(
    client: AsyncClient,
    frozen_clock: FrozenClock,
) -> None:
    frozen_clock.advance(timedelta(seconds=42))
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["uptime_s"] == 42


@pytest.mark.parametrize("free_mb,status", [(499, "degraded"), (500, "ok")])
async def test_health_disk_threshold(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    free_mb: int,
    status: str,
) -> None:
    def disk_usage(path: Path) -> _ntuple_diskusage:
        return _ntuple_diskusage(
            1000 * 1024**2, (1000 - free_mb) * 1024**2, free_mb * 1024**2
        )

    monkeypatch.setattr("shutil.disk_usage", disk_usage)
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["disk_free_mb"] == free_mb
    assert response.json()["status"] == status
    assert response.json()["db"] is True


async def test_health_failed_database_is_degraded_and_still_200(
    settings: Settings,
    frozen_clock: FrozenClock,
) -> None:
    from uuid import uuid4

    missing_url = make_url(settings.database_url.get_secret_value()).set(
        database=f"pawlaris_missing_{uuid4().hex}"
    )
    unavailable = settings.model_copy(
        update={
            "database_url": SecretStr(
                missing_url.render_as_string(hide_password=False)
            ),
        }
    )
    application = create_app(unavailable, frozen_clock)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=application, raise_app_exceptions=False),
            base_url="http://test",
        ) as http:
            response = await http.get("/api/v1/health")
        assert response.status_code == 200
        assert response.json()["db"] is False
        assert response.json()["status"] == "degraded"
    finally:
        await application.state.engine.dispose()
