from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(health.router, prefix="/api/v1")
    return app


app = create_app()
