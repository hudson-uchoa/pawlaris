import json
import logging
import sys
import traceback
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.clock import Clock, SystemClock
from app.db import make_engine
from app.errors import problem_response, register_handlers
from app.routers import auth, family, health, pets, sync, tasks
from app.security.ratelimit import LoginRateLimiter
from app.settings import Settings


class TimingMiddleware:
    def __init__(self, app: ASGIApp, clock: Clock) -> None:
        self.app = app
        self.clock = clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = self.clock.monotonic()
        request_id = Headers(scope=scope).get("X-Request-ID") or str(uuid4())
        context: dict[str, object] = {
            "ts": self.clock.now().isoformat().replace("+00:00", "Z"),
            "level": "INFO",
            "msg": "Request completed",
            "request_id": request_id,
            "method": scope["method"],
            "path": scope["path"],
            "status": None,
            "ms": None,
            "user_id": None,
        }
        scope.setdefault("state", {})["log_context"] = context
        response_started = False
        status = 500
        elapsed_ms = 0.0
        error_traceback: str | None = None

        async def timed_send(message: Message) -> None:
            nonlocal response_started, status, elapsed_ms
            if message["type"] == "http.response.start":
                elapsed_ms = round((self.clock.monotonic() - started) * 1000, 3)
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["Server-Timing"] = f"app;dur={elapsed_ms:.3f}"
                headers["X-Request-ID"] = request_id
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        except Exception as exc:
            if scope["path"].startswith("/api/v1/auth/") or scope["path"] == (
                "/api/v1/me/password"
            ):
                # Library exceptions may carry credentials or SQL bind parameters.
                frames = traceback.walk_tb(exc.__traceback__)
                error_traceback = "\n".join(
                    [type(exc).__name__]
                    + [
                        f'  File "{frame.f_code.co_filename}", line {line}, '
                        f"in {frame.f_code.co_name}"
                        for frame, line in frames
                    ]
                )
            else:
                error_traceback = traceback.format_exc()
            if response_started:
                raise
            response = problem_response(500, "internal_error", "Internal server error.")
            await response(scope, receive, timed_send)
        finally:
            context.update(
                {
                    "ts": self.clock.now().isoformat().replace("+00:00", "Z"),
                    "status": status,
                    "ms": elapsed_ms,
                    "user_id": scope["state"].get("user_id"),
                }
            )
            logging.getLogger("pawlaris.request").info(json.dumps(context))
            if error_traceback is not None:
                logging.getLogger("pawlaris.request").error(
                    json.dumps(
                        {
                            **context,
                            "level": "ERROR",
                            "msg": "Unhandled request exception",
                            "exc": error_traceback,
                        }
                    )
                )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    try:
        yield
    finally:
        await cast(AsyncEngine, app.state.engine).dispose()


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:

    settings = settings or Settings()
    clock = clock or SystemClock()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.clock = clock
    app.state.login_limiter = LoginRateLimiter(clock)
    app.state.started_at = clock.monotonic()
    app.state.engine = make_engine(settings)
    app.state.session_factory = async_sessionmaker(
        app.state.engine, expire_on_commit=False
    )
    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(family.router, prefix="/api/v1")
    app.include_router(pets.router, prefix="/api/v1")
    app.include_router(tasks.router, prefix="/api/v1")
    app.include_router(sync.router, prefix="/api/v1")
    register_handlers(app)
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(TimingMiddleware, clock=clock)
    return app


app = create_app()
logging.basicConfig(
    stream=sys.stdout, format="%(message)s", level=app.state.settings.log_level
)
