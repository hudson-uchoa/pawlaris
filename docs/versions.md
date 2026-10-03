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

## P0-5 — Expo app scaffold (2026-10-03)

Created with `create-expo-app` 5.0.0 and `expo-template-default` 57.0.28.
The app pins SDK 57 and keeps only the single-route boot dependencies and
the task's test and lint tooling. Node 24.15.0 and pnpm 12.4.1 ran the checks.

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| Expo | 57.0.26 | Android runtime and local build tooling | MIT |
| `expo-router` | 57.0.24 | Typed routes and native stack | MIT |
| `expo-constants` | 57.0.20 | Router configuration peer | MIT |
| `expo-linking` | 57.0.11 | Router linking peer | MIT |
| `expo-build-properties` | 57.0.22 | Conditional Android cleartext traffic | MIT |
| `expo-system-ui` | 57.0.4 | System light/dark appearance | MIT |
| React | 19.2.3 | Component runtime | MIT |
| React Native | 0.86.3 | Android UI, Hermes and New Architecture | MIT |
| `react-native-safe-area-context` | 5.7.0 | Router safe-area peer | MIT |
| `react-native-screens` | 4.26.0 | Native-stack screens | MIT |
| TypeScript | 6.0.3 | Strict mobile type checks | Apache-2.0 |
| `@types/react` | 19.2.2 | React type declarations | MIT |
| ESLint | 9.39.5 | Expo-compatible static checks | MIT |
| `eslint-config-expo` | 57.0.2 | Expo flat lint configuration | MIT |
| Jest | 29.7.0 | Component test runner and coverage | MIT |
| `jest-expo` | 57.0.5 | SDK-compatible native test mocks | MIT |
| `@types/jest` | 29.5.14 | Test type declarations | MIT |
| `@testing-library/react-native` | 14.0.1 | Component render assertions | MIT |

`@pawlaris/shared` is linked through `workspace:*`. The workspace lockfile
records all transitive versions. Explicit peer overrides pin
`@react-native/metro-config` 0.86.3, `react-dom` 19.2.3,
`react-native-worklets` 0.10.1 and `react-reconciler` 0.33.0 to compatible
versions. Testing Library 14 uses its `test-renderer` peer (1.3.0), rather
than the deprecated `react-test-renderer`. The shared package retains
ESLint 10; Expo's React/import plugins still require ESLint 9. The
`unrs-resolver` install script is disabled because its native resolver
binary is distributed as a platform package.

All packages are local, open-source tools without accounts or billing.
The fallback is the pinned lockfile installation and local Expo/Android
tooling; no cloud build or hosted service is required. The template's
sample UI, images and optional libraries are not part of the scaffold.
SDK 57 uses Hermes and the mandatory New Architecture without the removed
`jsEngine` and `newArchEnabled` app configuration fields.

Implementation references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
[Expo monorepos](https://docs.expo.dev/guides/monorepos/),
[Expo unit testing](https://docs.expo.dev/develop/unit-testing/), and
[Android build properties](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/).

## P0-8 — Commit hooks and guards (2026-10-03)

| Tool | Version | Purpose | Licence |
|---|---|---|---|
| pre-commit | 4.6.2 | Install and run both Git hook stages through `uvx` | MIT |
| Gitleaks | 8.30.1 | Scan staged changes for secrets with redacted output | MIT |

The Gitleaks hook is pinned to `v8.30.1` in `.pre-commit-config.yaml`.
Pre-commit manages its Go build in a machine-local cache, so a separate
system Gitleaks installation is unnecessary. The other hooks reuse the
locked workspace versions of Ruff, mypy, TypeScript and ESLint recorded
above. The three guards use Node built-ins only.

Both tools are local open-source software without accounts or billing.
The fallback is a local installation of the recorded versions and the
same commands; no hosted service is required. Install once per clone:

```text
uvx pre-commit install --hook-type pre-commit --hook-type commit-msg
```

The pre-commit stage runs static checks only. The commit-msg stage reads
Git's message file and enforces the format in `AGENTS.md` section 5.

Implementation references: [pre-commit hook configuration](https://pre-commit.com/#new-hooks)
and [Gitleaks hooks at the pinned release](https://github.com/gitleaks/gitleaks/blob/v8.30.1/.pre-commit-hooks.yaml).
