import shutil

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import Clock
from app.schemas.health import HealthResponse
from app.settings import Settings


async def read_health(
    session: AsyncSession,
    settings: Settings,
    clock: Clock,
    started_at: float,
) -> HealthResponse:
    try:
        db_ok = await session.scalar(text("SELECT 1")) == 1
    except Exception:
        db_ok = False
    disk_root = settings.blob_dir.resolve()
    while not disk_root.exists():
        disk_root = disk_root.parent
    free_mb = shutil.disk_usage(disk_root).free // 1024**2
    return HealthResponse(
        status="ok" if db_ok and free_mb >= 500 else "degraded",
        db=db_ok,
        disk_free_mb=free_mb,
        version=settings.app_version,
        uptime_s=max(0, int(clock.monotonic() - started_at)),
    )
