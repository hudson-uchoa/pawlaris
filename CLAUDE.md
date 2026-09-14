# Pawlaris — Agent Operating Manual

> This file is loaded into every session. It is the harness contract.
> If anything here conflicts with a prompt, ask before deviating.

## What this is

A self-hosted, $0/month pet-care app for one family (2 users: Hudson, Duda;
5 pets: Aurora, Asteria, Aelin, Andrômeda — cats; Katarina — dog).
Android-first, React Native + Expo. Python/FastAPI + PostgreSQL backend.

## Spec-Driven Development (SDD) — the only accepted workflow

The spec is the source of truth. Code that contradicts the spec is a defect.

```
1. READ    spec/ for the task you were given (tasks are in spec/08-tasks.md)
2. CONTRACT  if the task changes an API/schema/recurrence behavior:
             update spec/contracts/* FIRST, regenerate clients, commit that alone
3. RED     write the failing test(s) named in the task's Acceptance Criteria
4. GREEN   implement the minimum that makes them pass
5. GATE    run the task's Harness Command. Not green = not done. No exceptions.
6. ADR     if you had to deviate from the spec, append an ADR to spec/05-architecture.md
           and update the affected spec file in the SAME commit
```

Never mark a task complete in `spec/08-tasks.md` without pasting the passing
harness output into the commit body.

## Hard rules

- **Zero cost is a correctness requirement.** Do not introduce any dependency,
  SDK, or service that (a) requires a credit card, (b) bills after a free
  threshold, or (c) has no documented permanent free tier. If unavoidable,
  stop and ask.
- **TypeScript `strict: true`. Python `mypy --strict`.** No `any`, no `# type: ignore`
  without a one-line justification comment.
- **Every write is idempotent.** Client generates `client_mutation_id` (UUIDv4);
  server dedupes. Retrying a mutation must never double-apply.
- **All timestamps are UTC in storage (`timestamptz`), rendered in the family
  timezone (`America/Sao_Paulo`).** Never store naive datetimes. Never use
  `datetime.now()` — use the injected `Clock` so tests can freeze time.
- **Navigation never awaits the network.** Screens render from cache first,
  revalidate in background. A spinner on screen entry is a bug; use a skeleton.
- **Animations run on the UI thread.** Any animation driven by `setState`,
  `Animated` (non-native driver), or a JS timer is a defect.
- **No cron for recurring tasks.** Occurrences are computed deterministically
  from a recurrence rule. See spec/03-data-model.md §4.
- **Do not copy GoPuppy assets, code, icons, copy text, or Lottie files.**
  Functionality may be reimplemented; assets and brand may not. Use CC0/owned art.

## Layout

```
apps/mobile      Expo app          (pnpm)
services/api     FastAPI backend   (uv)
packages/shared  TS types + recurrence engine, generated from spec/contracts
infra            docker-compose, Caddyfile, backup scripts
spec             THE SPEC. Read before writing code.
```

## Harness commands (memorize these)

> Canonical runner is `pnpm verify` (ADR-014). `make` delegates to it on Linux/CI.

| Scope     | Command                                                        |
|-----------|----------------------------------------------------------------|
| Everything| `pnpm verify`  (one gate: `--only <id>`, list: `--list`)        |
| Mobile    | `pnpm -C apps/mobile lint && typecheck && test`                 |
| Mobile E2E| `maestro test apps/mobile/.maestro/`                            |
| API       | `uv run ruff check && uv run mypy app --strict && uv run pytest`|
| Contract  | `pnpm contract-check`  (fails on undeclared OpenAPI drift)      |
| Parity    | `pnpm parity`  (recurrence golden vectors: TS output == PY output)|

## Definition of Done (per task)

- [ ] Acceptance criteria tests exist and were red before the implementation
- [ ] `pnpm verify` green (PENDING counts as not-green)
- [ ] No new `TODO`/`FIXME` without an issue reference
- [ ] Spec updated if behavior changed
- [ ] Task checked off in spec/08-tasks.md with harness output in commit body
