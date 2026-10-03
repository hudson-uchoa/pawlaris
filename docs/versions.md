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
