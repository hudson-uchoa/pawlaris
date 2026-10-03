# Tool and dependency versions

## P0-3 — Shared package scaffold (2026-10-03)

Direct development dependencies of `@pawlaris/shared`; exact versions are
pinned in its manifest and the workspace lockfile. There are no runtime
dependencies.

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| TypeScript | 5.9.3 | Strict type-checking | Apache-2.0 |
| ESLint | 10.12.0 | Static checks and purity guards | MIT |
| `@eslint/js` | 10.0.1 | Recommended JavaScript rules | MIT |
| `typescript-eslint` | 8.71.0 | TypeScript parser and lint rules | MIT |
| Vitest | 5.0.3 | Pure-domain test runner | MIT |
| `@vitest/coverage-v8` | 5.0.3 | V8 coverage collection | MIT |
| `@types/node` | 24.19.1 | Node types for test tooling | MIT |

These are local, open-source tools with no accounts or paid services. Their
fallback is the pinned installation from the lockfile; no hosted service is
required. TypeScript 5.9.3 is within typescript-eslint's supported peer range
(`>=4.8.4 <6.1.0`). Node 24.15.0 and pnpm 12.4.1 ran the scaffold gates.

Configuration references: [typescript-eslint flat config](https://typescript-eslint.io/getting-started/)
and [Vitest coverage options](https://vitest.dev/config/coverage).

## P0-4 — API scaffold (2026-10-03)

Python 3.12.10 and uv 0.12.13 ran the API gates against native PostgreSQL
16.15. The resolved API dependencies are locked in `services/api/uv.lock`;
the TypeScript generator is pinned in the workspace manifest and lockfile.

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| FastAPI | 0.142.2 | Async HTTP framework | MIT |
| Pydantic | 2.13.5 | Wire validation | MIT |
| pydantic-settings | 2.15.0 | Environment configuration | MIT |
| Uvicorn | 0.54.0 | One-worker ASGI server | BSD-3-Clause |
| SQLAlchemy | 2.1.3 | Async sessions and transactions | MIT |
| asyncpg | 0.31.0 | PostgreSQL driver | Apache-2.0 |
| Alembic | 1.20.0 | Async migrations | MIT |
| PyJWT | 2.15.1 | Token tooling for the API stack | MIT |
| argon2-cffi | 25.1.0 | Password tooling for the API stack | MIT |
| Pillow | 12.3.0 | Image tooling for the API stack | MIT-CMU |
| tzdata | 2026.5 | IANA timezone database on Windows | Apache-2.0; bundled IANA data is public domain |
| httpx | 0.28.1 | HTTP integration tests and outbound HTTP | BSD-3-Clause |
| Ruff | 0.16.10 | Python lint and formatting | MIT |
| mypy | 2.4.0 | Strict Python type checks | MIT |
| pytest | 9.1.1 | API test runner | MIT |
| pytest-asyncio | 1.4.0 | Async fixtures and tests | Apache-2.0 |
| pytest-cov | 7.1.0 | Coverage at the full API gate | MIT |
| openapi-typescript | 7.13.0 | Generated shared wire types | MIT |

All are local, open-source packages with no accounts or paid services. The
fallback is installation from the checked-in lockfiles; no hosted service is
required. The Dockerfile uses Python 3.12 slim and copies uv 0.12.13 from its
official image. Image build verification belongs to P0-7.

Implementation references: [SQLAlchemy async sessions](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html),
[Alembic async migrations](https://alembic.sqlalchemy.org/en/latest/cookbook.html#using-asyncio-with-alembic),
and [pytest-asyncio loop configuration](https://pytest-asyncio.readthedocs.io/en/stable/reference/configuration.html).
