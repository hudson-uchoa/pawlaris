# Pawlaris — Spec Index

This directory is the source of truth. `AGENTS.md` (for the implementer) and
`CLAUDE.md` (for the orchestrator) at the repo root say how to work with it.

| File | What it settles |
|---|---|
| `00-constitution.md` | **The five pillars**, the principles P1–P11, and who does what |
| `01-audit.md` | History: the audit of the original PRD and the 2026-10-03 second review |
| `02-spec.md` | **What the app does.** Every requirement is `Rn.n` and testable |
| `03-data-model.md` | PostgreSQL schema, the phone's SQLite schema, and the invariants |
| `04-api-contract.md` | Every route, row shape, status code and permission |
| `05-architecture.md` | Stack, code layout, infrastructure, security, backup, ADR-001…036 |
| `06-ux-motion-spec.md` | **The identity** (night sky, light and dark), tokens, the motion kit, and the budgets for speed and weight |
| `07-test-harness.md` | The gates — the executable definition of done |
| `08-tasks.md` | **The backlog.** Ordered tasks, each with what to read, build, test and run |
| `09-screens.md` | **What the finished app looks like**, screen by screen, with copy and test ids |
| `10-client-sync.md` | The phone's replica, outbox, pull, socket and engine, as algorithms |
| `QUESTIONS.md` | Where the implementer asks and the orchestrator answers |
| `contracts/openapi.json` | Generated from the API, committed, drift-gated |
| `fixtures/*.json` | Golden vectors — read-only for the implementer |

## Reading order

**Once, before the first task** (about an hour):
`00` → `02` → `09` → `06` → `10` → `05` §1–§3 → `07` §1. Skim `03` and `04`; they are
reference, read in depth when a task cites them.

**For each task:** its entry in `08`, then exactly the sections its **Read**
line names. Nothing else is needed, and nothing else should be assumed.

`01-audit.md` explains *why* the design is what it is. It is not needed to
implement anything; where it and another file disagree, the other file wins.

## Reference codes

| Code | Meaning | Defined in |
|---|---|---|
| `Pn` | constitutional principle | `00` |
| `Rn.n` | functional requirement | `02` |
| `ADR-nnn` | decision record | `05` §10 |
| `Pn-n` (e.g. `P2-10`) | backlog task — always with a hyphen | `08` |
| `Hn` | something only the owner can do | `08` |
| `A-nn`, `B-nn` | audit findings (history) | `01` |
| `SY` `FM` `ID` `TK` `RC` `TZ` `CP` `TM` `WK` `AS` | server and domain invariants | `03` |
| `RB` `WS` | permission and socket gates | `04` |
| `MO` | motion gates | `06` |
| `RP` `OB` `PL` `SE` `AF` | client-sync invariants | `10` |
| `DV` `FK` `RM` | named pure-domain test cases | `07` §4 |

Each invariant has a named test. **Those tests are the real definition of
done** — a failure should name an invariant, so it points at a spec line rather
than at a function.

## When the spec is wrong or silent

It will be, somewhere. The implementer does not guess and does not patch the
spec: they write the question in `QUESTIONS.md` with the answer they would
assume, and either stop (if the task cannot proceed) or continue on that
assumption, isolated in one place (`AGENTS.md` §7). Only the orchestrator edits
this directory.
