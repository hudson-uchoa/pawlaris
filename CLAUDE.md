# Pawlaris — Orchestrator Manual

> Loaded into every Claude session in this repo. If anything here conflicts with
> a prompt, ask before deviating.

## What this is

A self-hosted, $0/month pet-care app for one family (2 users: Hudson, Duda;
5 pets: Aurora, Asteria, Aelin, Andrômeda — cats; Katarina — dog).
Android-first, React Native + Expo. Python/FastAPI + PostgreSQL backend.

## Who does what *(ADR-026)*

| | Orchestrator — **you, Claude** | Implementer — Codex |
|---|---|---|
| Owns | `spec/`, `AGENTS.md`, `CLAUDE.md`, the fixtures, and the harness scripts `verify.mjs`, `validate-vectors.mjs`, `check-spec.mjs` | feature code and its tests |
| Does | writes and corrects the spec; answers `spec/QUESTIONS.md`; reviews tasks; accepts or returns them | one backlog task per session, on the phase branch, following `AGENTS.md` |
| Never | writes feature code unless the owner asks for it | edits `spec/` (beyond its checkbox, `QUESTIONS.md`, `contracts/`) |

The implementer's rules, layout and commands are in `AGENTS.md`, imported below.
They bind you too whenever you touch code.

@AGENTS.md

## Working with the owner

The owner speaks Portuguese: talk to them in Portuguese, and keep everything
written to the repository in English. Product decisions are theirs — when a
question is really "what should the app do?", ask instead of deciding. Commit,
merge and push only when they say to.

Your own commits follow `AGENTS.md` §5: `docs(spec): …` for the spec,
`feat(harness): …` / `fix(harness): …` for `scripts/`, with a `Task:` footer
when the change belongs to a task and `Refs:` naming the ADR or question it
settles. Set `PAWLARIS_ROLE=orchestrator` in the environment of a commit that
changes `spec/` on a phase branch, so the spec guard lets it through.

## Changing the spec

The spec is the source of truth, so a change to it must be whole.

1. Change every file the decision touches in the same commit: pillar or
   principle (`00`), requirement (`02`), schema (`03`), contract (`04`),
   architecture (`05`), identity and motion (`06`), gates (`07`), screens
   (`09`), client algorithm (`10`), and the affected tasks' **Read**, **Build**
   and **Tests** lines (`08`).
2. Record the decision as an ADR in `spec/05-architecture.md` §10 when it
   changes behaviour or reverses an earlier decision. Say who decided it.
3. If it affects a task that is already `[~]` or `[x]`, add a follow-up task to
   `08` rather than silently invalidating accepted work.
4. Run `pnpm verify --only vectors,spec-refs`: the fixture validator, and the
   cross-reference check (every `Rn.n`, `ADR-nnn`, task id and invariant code
   that is cited exists; no task depends on a later one; no gate uses `&&`).
5. Answer the question in `spec/QUESTIONS.md` in place, with the date.
6. While a phase branch is active, commit the change **on that branch**, so the
   implementer's next session sees it.

## Reviewing a task

A task arrives as a run of commits on the phase branch, ending with
`docs(spec): mark <ID> as awaiting review`. Its range is everything after the
previous task's mark commit: find both with
`git log --oneline --grep "^docs(spec): mark P"`.

Never switch branches in the working tree while an implementer session may be
running. Review from a separate worktree:
`git worktree add ../Pawlaris-review <phase branch>`.

1. **Read the task** in `08` and the sections on its **Read** line — review
   against the spec, not against what the code seems to intend.
2. **Diff:** `git diff <previous mark>..<this mark>`; read all of it.
3. **Run the gates yourself:** every command in the task's Gate and
   `pnpm verify --allow-pending`. Do not trust pasted output.
4. **Check, in this order:**
   - *Boundary* — nothing under `spec/` changed except the checkbox,
     `QUESTIONS.md` and `contracts/`; fixtures untouched.
   - *Tests* — every test on the task's **Tests** line exists, is named after
     its invariant, asserts what the spec says, and could actually fail. Look
     for weakened assertions, skipped tests, mocks of the thing under test,
     real clocks and real network.
   - *Spec fidelity* — status codes, field names, algorithms (`03` §5, §9 and
     `10` verbatim), copy and `testID`s match.
   - *Pillars* — nothing waits on the network before paint; no per-frame
     JavaScript; no animation without a Reduce Motion path or left running
     off-screen; both themes; no dependency outside `05` §1.
   - *Hard rules* — `AGENTS.md` §3, each one.
   - *Scope* — nothing from **Not here**; no drive-by refactors.
   - *Language and history* — everything is English except the two places
     `AGENTS.md` §5 allows; the task's commits read as a clean sequence of
     atomic Conventional Commits, each with its `Task:` footer, the last code
     commit carrying the gate summary. A sloppy history is a `major` finding.
   - *Device evidence* — `docs/evidence/<ID>.md` lists real steps; results are
     recorded only for steps someone actually ran.
5. **Write the review** to `docs/reviews/<ID>.md` on the phase branch:

   ```
   # Review <ID> — <ACCEPTED | CHANGES REQUESTED> — <date>
   ## R1 — <severity: blocker | major | minor> — <title>            OPEN
   **Where:** path:line   **Spec:** 03 §5 CP-4
   **Problem:** …        **Fix:** …
   ```

6. **Verdict.** No blocker or major open → accepted: set the checkbox to `[x]`
   (`docs(spec): accept P2-10`). Otherwise → return it; the implementer fixes
   on the same branch before starting anything new.
7. **Device line.** Flip `**Device:** [ ]` to `[x]` only when every step in the
   evidence file has a recorded result. This is independent of step 6.
8. Anything the implementer listed under *Assumptions* or *Noticed* is either
   answered in `QUESTIONS.md`, turned into a spec change, or added to `08`.
9. **Moving `main`.** When the owner says so, fast-forward `main` to the last
   accepted task of the phase (`git merge --ff-only <sha>`), and push if a
   remote exists. `main` only ever contains accepted work.

## Definition of done (per task) — `spec/07-test-harness.md` §1.1

- [ ] The task's tests exist and were red before the implementation
- [ ] Every command in the task's Gate passes
- [ ] `pnpm verify --allow-pending` exits 0 (zero FAIL)
- [ ] No new `TODO`/`FIXME` without an issue reference
- [ ] The commits follow `AGENTS.md` §5
- [ ] Reviewed and accepted by the orchestrator → `[x]`
