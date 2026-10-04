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

## P0-6 — Local Android development client (2026-10-03)

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| `expo-dev-client` | 57.0.19 | Custom development launcher and native debugging | MIT |

The exact version matches Expo SDK 57's bundled native-module range
(`~57.0.19`) and is pinned in the mobile manifest and workspace lockfile.
Its runtime dependencies are `expo-dev-launcher` 57.0.20,
`expo-dev-menu` 57.0.18, `expo-dev-menu-interface` 57.0.0,
`expo-manifests` 57.0.2 and `expo-updates-interface` 57.0.2; the lockfile
also records their `expo-json-utils` 57.0.2 dependency. These Expo packages
use MIT licences. Internal launcher assets are recorded in
`apps/mobile/assets/LICENSES.md`.

The client and local Android build tools need no account or billing.
The fallback is the pinned lockfile installation and local builds;
EAS cloud builds are optional. Build commands and owner signing-key
preparation are in [build.md](build.md).

Implementation reference: [Expo local development builds](https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-locally).

## P0-7 — GitHub Actions CI (2026-10-03)

Actions are pinned to immutable commits in `.github/workflows/ci.yml`.
No application dependency or lockfile changes are required.

| Action | Release line | Pinned commit | Licence |
|---|---|---|---|
| `actions/checkout` | v7 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | MIT |
| `actions/setup-node` | v7 | `820762786026740c76f36085b0efc47a31fe5020` | MIT |
| `pnpm/action-setup` | v6 | `0977fd99725f1db4007ccb2928dbb4e90d06cc86` | MIT |
| `astral-sh/setup-uv` | v7 | `37802adc94f370d6bfd71619e3f0bf239e1f3b78` | MIT |
| `docker/setup-qemu-action` | v4 | `99012661954931238ded8c8b007157a8430204e1` | Apache-2.0 |
| `docker/setup-buildx-action` | v4 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` | Apache-2.0 |
| `docker/login-action` | v4 | `dbcb813823bdd20940b903addbd779551569679f` | Apache-2.0 |
| `docker/build-push-action` | v7 | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` | Apache-2.0 |

The hosted runner is Ubuntu 24.04. Checks reuse Node 24.15.0, pnpm 12.4.1
from `packageManager`, uv 0.12.13, Python 3.12 and the frozen lockfiles.
The API job uses the `postgres:16` image with trust authentication only
inside its disposable runner, and generates a masked signing key per run.
The secrets job runs the existing Gitleaks 8.30.1 CLI image over Git history
with redacted output. It uses no Gitleaks action licence or account.

GitHub Actions and GHCR use the public repository's free tier. No payment
method is needed; the fallback is `pnpm verify` locally and a local Docker
Buildx image build, as specified in `spec/00-constitution.md` P1.

Implementation references: [checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[pnpm setup](https://github.com/pnpm/action-setup),
[uv setup](https://github.com/astral-sh/setup-uv),
[Gitleaks CLI](https://github.com/gitleaks/gitleaks), and
[Docker Buildx publishing](https://github.com/docker/build-push-action).

## P0-9 — App icon and splash (2026-10-03)

| Dependency | Version | Purpose | Licence |
|---|---|---|---|
| `expo-splash-screen` | 57.0.9 | Native splash config plugin | MIT |

The exact version matches the installed Expo SDK 57's bundled range
(`~57.0.9`). The plugin uses the supplied project-authored paw-star image
on the night sky in both themes. Its pinned package contains the MIT
licence text. It needs no account, remote service or billing; the fallback
is the same native splash built locally from the frozen lockfile.

## P1-1 — Shared and mobile compiler alignment (2026-10-04)

`@pawlaris/shared` now pins TypeScript 6.0.3, the exact version already used
by `apps/mobile`. The workspace lockfile records this alignment so both
packages check shared source with the same compiler. This replaces the
shared scaffold's TypeScript 5.9.3 entry above. No runtime dependency is
added; the licence and local-tool fallback remain Apache-2.0 and the
pinned lockfile installation.
