# Pawlaris — Spec Index

Read in order. `CLAUDE.md` at the repo root is the operating manual and is loaded
every session; this directory is the source of truth it points at.

| File | What it settles |
|---|---|
| `00-constitution.md` | Non-negotiable principles (P1–P10) and the SDD loop |
| `01-audit.md` | Audit of the original PRD — 27 findings, severities, corrections |
| `02-spec.md` | Corrected functional spec. Every requirement is `Rn.n` and testable |
| `03-data-model.md` | PostgreSQL + client SQLite schema, and the invariants (`CP-1`, `OB-1`, …) |
| `04-api-contract.md` | REST + WebSocket contract; contract-drift governance |
| `05-architecture.md` | Stack, infrastructure for 1 OCPU / 2 GB, ADR-001…011 |
| `06-ux-motion-spec.md` | Design tokens, the signature animations, performance budgets |
| `07-test-harness.md` | The harness — the executable definition of done |
| `08-tasks.md` | Ordered backlog, P0→P8, with acceptance criteria per task |
| `contracts/openapi.json` | Generated, committed, drift-gated |
| `fixtures/recurrence-vectors.json` | Shared truth for the TS↔Python parity gate |

## Where to start

1. `00-constitution.md` — how we work and what we will not trade away
2. `01-audit.md` — what was wrong with the original plan and why
3. `08-tasks.md` — pick the next unchecked task
4. The spec file that task cites
5. `07-test-harness.md` — write the failing test first

## Reference codes used throughout

- `A-nn` — an audit finding in `01-audit.md`
- `Pn` — a constitutional principle in `00-constitution.md`
- `Rn.n` — a functional requirement in `02-spec.md`
- `ADR-nnn` — a decision record in `05-architecture.md`
- `CP-n`, `OB-n`, `WK-n`, `SY-n`, `RC-n`, `TM-n`, `AS-n`, `ID-n`, `MO-n` —
  invariants with a named gate test. **These are the real definition of done.**

A test failure should name an invariant, so it points at a spec line rather than
at a function.
