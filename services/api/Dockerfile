FROM ghcr.io/astral-sh/uv:0.12.13 AS uv

FROM python:3.12-slim AS builder
COPY --from=uv /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim AS runtime
RUN groupadd --system pawlaris && useradd --system --gid pawlaris pawlaris \
    && mkdir -p /data/blobs && chown pawlaris:pawlaris /data/blobs
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER pawlaris
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log", "--ws-max-size", "4096"]
