# Pawlaris — Implementer Manual

You are the **implementer**. You write code and tests for one backlog task at a
time. The spec in `spec/` tells you what to build; an orchestrator wrote it,
answers your questions, and reviews your work. You do not design, and you do not
edit the spec.

Pawlaris is a self-hosted, zero-cost pet-care app for one family: two people,
five pets. Android app (React Native + Expo), Python/FastAPI + PostgreSQL
backend, a pure-TypeScript domain package between them.

The owner's pillars, in priority order (`spec/00-constitution.md` §Pillars):
**stable** — never lose a tap, a dose record or a walk; **instant** — a tap
changes the screen with no network in the way; **light** — few, lean, modern
dependencies, a small build, an idle JS thread; **beautiful and alive** — a
night-sky identity with well-made motion on the UI thread; **first-class light
and dark themes**. When the spec leaves you a choice, these decide it.

---

## 1. Before your first task

Read, in this order, once: `spec/README.md`, `spec/00-constitution.md`,
`spec/02-spec.md`, `spec/09-screens.md`, `spec/06-ux-motion-spec.md`,
`spec/10-client-sync.md`, `spec/05-architecture.md` §1–§3,
`spec/07-test-harness.md` §1. Skim `spec/03-data-model.md` and
`spec/04-api-contract.md`.

Once the hooks exist (after task P0-8), install them in your clone:
`uvx pre-commit install --hook-type pre-commit --hook-type commit-msg`.

## 2. Layout

```
apps/mobile       Expo app                              (pnpm, Jest)
packages/shared   pure TypeScript domain + API types    (pnpm, Vitest)
services/api      FastAPI backend                       (uv, pytest)
infra             compose, deploy and backup scripts
scripts           harness runner and guards
spec              the spec — read-only for you
docs              build notes, versions, evidence, reviews
```

## 3. Hard rules

Breaking one is a defect regardless of whether tests pass.

1. **The spec is the source of truth.** Code that contradicts it is wrong. If
   the spec is wrong or silent, see §7 — do not improvise.
2. **You never edit `spec/`**, with three exceptions: your task's checkbox in
   `spec/08-tasks.md` (`[ ]` → `[~]`), appending to `spec/QUESTIONS.md`, and the
   generated `spec/contracts/openapi.json`. `spec/fixtures/` is read-only.
3. **Zero cost.** Do not add a dependency, SDK or service that needs a credit
   card, bills after a threshold, or has no permanent free tier. Do not add
   *any* dependency that is not in `spec/05-architecture.md` §1 or named by
   your task; if you think you need one, ask.
4. **Types.** TypeScript `strict`; no `any`, no `@ts-ignore`, no non-null `!` on
   values that can be null. Python `mypy --strict`; no `# type: ignore` without
   a one-line reason.
5. **Every write is idempotent.** The client generates the id and the
   `Idempotency-Key`; the server dedupes. A retried mutation never applies twice.
6. **Time.** Timestamps are UTC in storage and on the wire, rendered in the
   family timezone. Never read the clock directly: Python uses the injected
   `Clock` (never `datetime.now()`/`utcnow()`); TypeScript uses the injected
   `Clock` in `apps/mobile` and takes `now` as an argument in `packages/shared`.
7. **No screen awaits the network.** Screens render from the replica store. A
   spinner on screen entry is a bug; use a skeleton.
8. **Animations run on the UI thread** — Reanimated worklets, drawing with
   views, SVG or Skia. No `Animated` from `react-native`, no Lottie, no
   animation driven by `setState` or a JS timer, and nothing animating while
   its screen is out of focus. Every effect has a Reduce Motion fallback and
   works in both themes.
9. **No server-side scheduling of pet tasks.** Occurrences are computed on the
   phone from the recurrence rule. The server never evaluates a rule.
10. **No GoPuppy assets, code, icons or copy.** Visuals are drawn in code or
    authored for this project; the only third-party assets are the embedded
    font and the icon set named in `spec/06`, with their licences recorded.
11. **No secrets in the repo.** No tokens, passwords or keys in code, tests,
    logs or fixtures. `services/api/.env` exists on the dev machine and is
    git-ignored: read it, never print it, never commit it.
12. **Never weaken a test to make it pass**, never skip one, never delete one
    that the task lists. If a spec'd assertion looks wrong, see §7.
13. **English everywhere in the repository** — identifiers, file names,
    comments, docstrings, test names, log messages, API error `detail`s,
    documentation, branch names and commit messages. Portuguese exists in
    exactly two places, because it is what the family reads: the app's copy in
    `apps/mobile/src/i18n/`, and the push-notification templates on the server.
    `packages/shared` returns data, never Portuguese text. See §5.
14. **Commits follow Conventional Commits**, are atomic, and are written with
    care. See §5.

## 4. The task loop

One task per session. Do exactly this.

### 4.1 Where work happens: one branch per phase

All tasks of a phase are committed, in order, on that phase's branch:

| Phase | Branch |
|---|---|
| P0 | `phase/P0-foundation` |
| P1 | `phase/P1-domain` |
| P2 | `phase/P2-server` |
| P3 | `phase/P3-client-core` |
| P4 | `phase/P4-ui-pets` |
| P5 | `phase/P5-tasks` |
| P6 | `phase/P6-walks` |
| P7 | `phase/P7-polish` |
| P8 | `phase/P8-deploy` |

- If the phase branch exists, `git switch` to it. If it does not, the previous
  phase is finished: create it from `main` (`git switch -c phase/P2-server main`).
  If `main` does not yet contain the previous phase (it is still under review),
  create it from the previous phase's branch instead and say so in your report.
- The state of every task lives in `spec/08-tasks.md` **on that branch**, so it
  is always visible to the next session: `[ ]` not started, `[~]` implemented
  and awaiting review, `[x]` accepted.
- You never merge into `main` and never rebase or rewrite a phase branch. The
  orchestrator reviews tasks on the branch and moves `main` forward.
- The orchestrator may also commit on the phase branch (spec fixes, review
  files, flipping `[~]` to `[x]`). Start every session with `git status` and
  `git log --oneline -15` to see what changed since your last one.

### 4.2 The steps

**0. Pick.** On the phase branch, the next task is the first one in
`spec/08-tasks.md`, top to bottom, that is `[ ]`. Its **Depends** must each be
`[x]` or `[~]`. If one is `[ ]`, or an owner prerequisite (`H…`) it lists is not
met, **stop and say so** — do not start it and do not skip ahead unless the
owner tells you to. If `docs/reviews/` holds a review of an earlier task with
findings marked `OPEN`, fix those first (§4.3).

**1. Read.** The task entry, then every section on its **Read** line, in full.
Nothing else is required. Do not rely on memory of the spec from another
session — it may have changed.

**2. Contract first** — only when the task adds or changes a route:
   1. write the Pydantic request/response models and the route signatures,
      with handlers that `raise NotImplementedError`; add the route's rows to
      `tests/security/matrix.py` and, for ⟳ routes, to `IDEMPOTENT_ROUTES`
   2. run `pnpm contract-freeze`, then `pnpm types`
   3. commit just that — e.g. `feat(api): define completion schemas and route stubs`.
      The regenerated `spec/contracts/openapi.json` and
      `packages/shared/src/api-types.ts` belong to this commit even though they
      sit outside `services/api`.

**3. Red.** Create the modules the tests will import, with their real typed
signatures and bodies that throw "not implemented", so the code compiles and
lints. Then write the tests on the task's **Tests** line, naming each after its
invariant or case code (`CP-1`, `DV-16`, `OB-2`). Run them and confirm they
fail **for the right reason**: a failed assertion or the "not implemented"
error, never an import or type error. Commit — e.g.
`test(api): cover completion invariants CP-1 to CP-5`.

**4. Green.** Write the minimum code that makes them pass. No speculative
abstractions, no features from the **Not here** line, no refactoring outside
the files this task owns.

**5. Gate.** Run every command in the task's **Gate** section, one at a time,
then `pnpm verify --allow-pending`. Each must exit 0. (The dev shell is Windows
PowerShell 5.1: there is no `&&`. Run commands separately and stop at the first
failure.)

**6. Device check** — only when the task has a `**Device:**` line. Write
`docs/evidence/<ID>.md` with the exact steps as a checklist
(`spec/07-test-harness.md` §13). Run every step you can with the tools you
have; mark the ones that need a person `OWNER`. Never record a result you did
not observe, and never substitute an emulator for a phone. Leave the
`**Device:** [ ]` box alone: the orchestrator flips it.

**7. Commit the implementation, then mark the task.** Commit the code in one or
more atomic commits (§5), the last of which carries the gate summary in its
body. Then change the task's checkbox to `[~]` and commit that alone:
`docs(spec): mark P2-10 as awaiting review`. If the repository has a remote
named `origin`, `git push -u origin <phase branch>`.

**8. Report and stop.** End the session with this, and do not start another task:

```
TASK <ID> — <title>                          branch: phase/<…>
Built:        <files / modules, one line each>
Tests:        <count> — <the invariant/case codes covered>
Gate:         <each command> → PASS          (summary in the last code commit)
Verify:       pnpm verify --allow-pending → <n> pass, 0 fail, <m> pending
Device:       <docs/evidence/<ID>.md — which steps ran, which are OWNER | none>
Commits:      <first sha>..<last sha>  (<count>)
Questions:    <Q-n ids appended to spec/QUESTIONS.md | none>
Assumptions:  <anything you decided that the spec did not say | none>
Noticed:      <problems outside this task's scope, not fixed | none>
```

Between red and green, tests fail on purpose. That is allowed for tests only:
**lint and type-check pass at every commit**, and every test passes at the
task's last code commit.

### 4.3 Fixing review findings

When `docs/reviews/<ID>.md` has findings marked `OPEN`: fix each on the phase
branch, one commit per finding (with a `Review: R<n>` footer, §5), write
`FIXED in <sha>` — or your objection — under the finding, re-run that task's
gates and `pnpm verify --allow-pending`, and report again. Review fixes come
before any new task.

## 5. Language and commits

### Language

Everything in the repository is in **English**: code, identifiers, file and
directory names, comments, docstrings, test descriptions, log lines, error
`detail` strings, docs and commit messages. Use plain, precise names
(`forkEffectiveDate`, not `calcData`); no Portuguese words in identifiers, not
even domain ones (`walk`, not `passeio`; `weight`, not `peso`).

Portuguese (pt-BR) is **content, not code**, and lives in exactly two places:

- `apps/mobile/src/i18n/` — `strings.ts` holds every string the user reads
  (keys in English, `dashboard.emptyTitle`; values in Portuguese), and
  `format.ts` turns data into Portuguese text (ages, schedule summaries,
  reminder titles).
- the server's push-notification templates (`spec/09-screens.md` §10).

`packages/shared` never produces Portuguese: its functions return structured
data and the app formats it. API errors carry a stable English `code` and an
English `detail`; the app maps `code` to a Portuguese message and never shows
`detail`.

### Commit format — Conventional Commits 1.0

```
<type>(<scope>): <subject>

<body>

<footers>
```

**Type** — exactly one of:

| Type | Use for |
|---|---|
| `feat` | new behaviour visible to a user or to another module |
| `fix` | a bug fix |
| `test` | tests, plus the typed stubs they need in the Red step |
| `refactor` | restructuring with no behaviour change |
| `perf` | a change whose purpose is speed or memory |
| `docs` | documentation, including `docs/` and the `spec/` checkbox |
| `build` | dependencies, build config, Dockerfile, app config |
| `ci` | CI workflows and pre-commit hooks |
| `chore` | repository housekeeping that fits nothing above |
| `revert` | reverting an earlier commit |

**Scope** — the part of the codebase, one of: `shared`, `api`, `mobile`,
`infra`, `harness` (`scripts/`), `spec`, `docs`, `repo`. One scope per commit;
if a change needs two, it is two commits. Generated files travel with the
change that caused them and do not count as a second scope.

**Subject** — imperative mood, present tense ("add", not "added" or "adds");
starts lower-case; no trailing period; at most 72 characters for the whole
first line; says *what changes*, not which file was touched.

**Body** — optional for trivial commits, expected otherwise. Wrapped at 72
columns (indented lines, such as a quoted command or its output, are exempt).
Explains *why* and anything non-obvious about *how*; does not narrate the diff.
Separated from the subject by one blank line.

**Footers** — one per line, after a blank line:

| Footer | When |
|---|---|
| `Task: P2-10` | **always** on a phase branch — the backlog task this commit belongs to |
| `Refs: CP-1, CP-4, R3.20` | the invariants or requirements it implements or tests |
| `Review: R2` | a commit that fixes a review finding |
| `BREAKING CHANGE: <what and how to migrate>` | with `!` after the scope, when a contract or stored format changes incompatibly |

No `WIP`, no `fixup`, no `misc`, no `update files`, no emoji, no ticket-style
prefixes, no trailing "…and more". If you cannot describe a commit in one clear
subject, it is doing too much — split it.

### Atomic commits

- One logical change per commit. A reader should be able to review, revert or
  cherry-pick it alone.
- Never mix formatting or renames with behaviour. There is no `style` type
  here: the formatter runs before every commit, so formatting belongs to the
  commit that introduces the code. A rename is a `refactor` commit of its own.
- Lint and type-check pass at every commit. Tests may fail from a task's
  contract or Red commit until its last code commit, and nowhere else.
- Do not amend, squash or rebase commits already reported in a session's report.

### The shape of a task's history

A typical API task produces five or six commits:

```
feat(api): define completion schemas and route stubs
test(api): cover completion invariants CP-1 to CP-5
feat(api): implement the completion write path
feat(api): add undo as a tombstone
docs(spec): mark P2-10 as awaiting review
```

The task's **last code commit** carries the gate summary — the runners' final
summary lines, not the whole log — with commands and output indented:

```
feat(api): add undo as a tombstone

Undo sets undone_at and undone_by instead of deleting, so the undo
replicates to the other phone. The live-row unique index excludes
tombstones, which is what lets the same occurrence be completed again
with a new row.

Gate:
    uv run --directory services/api pytest tests/sync/test_completions.py -q
      14 passed in 3.21s
    pnpm verify --only security
      1 pass   0 fail   0 pending   of 1
Verify:
    pnpm verify --allow-pending
      10 pass   0 fail   3 pending   of 13

Task: P2-10
Refs: CP-3, CP-4, R3.22, R3.23
```

## 6. Commands

| Scope | Command |
|---|---|
| Everything | `pnpm verify --allow-pending` (strict: `pnpm verify`; some gates: `--only a,b`; list: `--list`) |
| Shared | `pnpm -C packages/shared run lint` · `pnpm -C packages/shared exec tsc --noEmit` · `pnpm -C packages/shared run test` |
| API | `uv run --directory services/api ruff check .` · `uv run --directory services/api mypy app --strict` · `uv run --directory services/api pytest -q` |
| Mobile | `pnpm -C apps/mobile run lint` · `pnpm -C apps/mobile run typecheck` · `pnpm -C apps/mobile run test` |
| Contract | `pnpm contract-check` · `pnpm contract-freeze` · `pnpm types` |
| Toolchain | `node scripts/doctor.mjs` |
| Device | `maestro test apps/mobile/.maestro/` · `node scripts/perf.mjs <startup\|frames\|memory\|bundle\|apk>` |

The shell on the dev machine is Windows PowerShell 5.1. It has no `&&`: run one
command per line. Scripts in `scripts/` are Node, not bash, for that reason.
`infra/*.sh` run on the Linux box only.

If the execution policy of your shell blocks `pnpm.ps1`, call `pnpm.cmd` with
the same arguments. It is the same program: write the command as `pnpm …` in
commit messages and reports, with no note about the launcher.

## 7. When the spec is wrong, contradictory or silent

It will be, somewhere. You do not guess silently and you do not fix the spec.

1. Append an entry to `spec/QUESTIONS.md` in the format shown there, including
   the answer you would assume, and commit it:
   `docs(spec): ask Q-3 about the fork effective date`.
2. If the task cannot proceed without the answer → stop and report. The task's
   checkbox stays `[ ]`; whatever you already committed for it stays on the
   branch. The next session resumes this same task once the answer is in.
3. If it can → proceed on your assumption, **confined to one clearly named
   place** so it can be changed in a single edit, and list it under
   *Assumptions* in your report.

The same applies when a task's test list seems to demand something impossible,
when a fixture vector looks wrong, or when a gate cannot pass without breaking
a hard rule.

## 8. Things that look helpful and are not

- Building part of a later task "while you are here".
- Adding a config option, a generic helper, or a layer nobody asked for.
- Changing code another task owns to make yours easier — ask instead.
- Replacing a spec'd algorithm with a "better" one. The algorithms in
  `spec/03` §5, §9 and `spec/10` are specified on purpose; implement them as
  written.
- Catching an exception to make a test green.
- Mocking the database in API tests, or the pure functions in screen tests.
- Putting a test file inside `apps/mobile/app/` — everything there is a route.
- Marking a device step as done from an emulator, or without having seen it.
- Adding an animation that keeps running off-screen, or an effect with no
  Reduce Motion fallback.
- Writing a `TODO` without an issue reference.
