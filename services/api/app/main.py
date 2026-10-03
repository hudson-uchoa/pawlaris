from fastapi import FastAPI

from app.clock import Clock, SystemClock
from app.db import make_engine
from app.routers import health
from app.settings import Settings


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    settings = settings or Settings()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.clock = clock or SystemClock()
    app.state.started_at = app.state.clock.monotonic()
    app.state.engine = make_engine(settings)
    app.state.session_factory = async_sessionmaker(
        app.state.engine, expire_on_commit=False
    )
    app.include_router(health.router, prefix="/api/v1")
    return app


app = create_app()
