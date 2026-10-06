# 07 — The Test Harness

The harness is the executable definition of done. A task without a passing gate
is an opinion about whether something looks finished.

---

## 1. The one command

```
pnpm verify                        every gate; strict
pnpm verify --allow-pending        every gate; PENDING does not fail the run
pnpm verify --only <id>[,<id>…]    one gate, or several (comma-separated, no spaces)
pnpm verify --list                 gates, their group, and the task that makes each real
```

`scripts/verify.mjs` uses Node built-ins only, so it runs before a single
dependency is installed. Each gate reports:

| Status | Meaning |
|---|---|
| `PASS` | ran and succeeded |
| `FAIL` | ran and broke — fix the code |
| `PENDING` | the gate's tooling does not exist yet — a later task creates it |

### 1.1 Definition of done *(ADR-026)*

A **task** is done — ready to be marked `[~]` — when all of these hold:

1. the tests named in its *Tests* section exist and were seen failing first
2. every command in its *Gate* section exits 0
3. `pnpm verify --allow-pending` exits 0 — **zero FAIL**; PENDING is allowed
   only for gates that belong to tasks not yet started
4. the task's last code commit carries the summary lines of 2 and 3 in its
   body, and the task's commits follow `AGENTS.md` §5

A task becomes **accepted** (`[x]`) when the orchestrator has reviewed it.

A task's **device check** (§13), when it has one, is tracked on its own line
and does not block acceptance of the code or the tasks that depend on it.

A **release** (P8-7) needs the strict `pnpm verify` to exit 0, every task
`[x]`, and every device check done.

### 1.2 Gates run by `verify`

| Gate id | Command (from the repo root) | Created by |
|---|---|---|
| `vectors` | `node scripts/validate-vectors.mjs` | orchestrator (exists) |
| `spec-refs` | `node scripts/check-spec.mjs` — every cited requirement, ADR, task and invariant exists; no task depends on a later one | orchestrator (exists) |
| `lint:shared` | `pnpm -C packages/shared run lint` | P0-3 |
| `typecheck:shared` | `pnpm -C packages/shared exec tsc --noEmit` | P0-3 |
| `test:shared` | `pnpm -C packages/shared run test` (= `vitest run --coverage`) | P0-3 |
| `lint:api` | `uv run --directory services/api ruff check .` | P0-4 |
| `format:api` | `uv run --directory services/api ruff format --check .` | P0-4 |
| `typecheck:api` | `uv run --directory services/api mypy app --strict` | P0-4 |
| `test:api` | `uv run --directory services/api pytest -q --cov=app --cov-fail-under=85` | P0-4 |
| `contract-check` | `node scripts/contract-check.mjs` | P0-4 |
| `lint:mobile` | `pnpm -C apps/mobile run lint` | P0-5 |
| `typecheck:mobile` | `pnpm -C apps/mobile exec tsc --noEmit` | P0-5 |
| `test:mobile` | `pnpm -C apps/mobile run test` (= `jest --coverage`) | P0-5 |
| `security` | `uv run --directory services/api pytest tests/security -q` | P2-5 |

**Coverage floors (§10) are enforced only by the three full `test:*` gates.**
Coverage is switched on by those commands (`--cov…`, `--coverage`), never by a
runner's default options (`addopts`, `coverage.enabled`), so a task's own gate
— which runs a subset of the tests — is not failed by a floor it cannot meet.

---

## 2. Layers

| Layer | Tool | Where it runs |
|---|---|---|
| Static — TS | `tsc --noEmit` (strict), ESLint | pre-commit, CI |
| Static — Python | Ruff, `mypy --strict` | pre-commit, CI |
| Pure domain | Vitest, in `packages/shared` | CI, dev machine |
| API integration | pytest + httpx + a real PostgreSQL | CI, dev machine |
| Client core | Jest + `sql.js` + fakes for every seam of `10` §1 | CI, dev machine |
| Component | Jest + React Native Testing Library | CI, dev machine |
| Contract | OpenAPI drift check | CI, dev machine |
| E2E | Maestro on real phones | before a release |
| Performance | `scripts/perf.mjs` + `adb` on a release build | before a release |

Pre-commit runs **static checks only**, never tests: the Red commit of a task
has failing tests by design.

The pyramid is bottom-heavy on purpose. The highest-risk logic — recurrence,
day view, conflict handling, sync ordering, distance — is pure or behind
injected seams, so it is tested fast and with no device.

---

## 3. Fixtures

Both files are authored by the orchestrator and are **read-only for the
implementer**. A failing vector means the code is wrong.

### `spec/fixtures/recurrence-vectors.json`

```jsonc
{ "version": 2,
  "vectors": [
    { "name": "…unique…", "tags": ["daily", "month-end"],
      "recurrence": { "freq": "daily", "interval": 2 },
      "times_of_day": ["08:00"],
      "starts_on": "2026-01-28", "ends_on": null,
      "from": "2026-01-28", "to": "2026-02-06",
      "expect": ["2026-01-28T08:00", "…"] } ] }
```

The test loads the file, calls `occurrences()` once per vector, and compares
with `expect` using deep equality. It contains no expectations of its own.

### `spec/fixtures/time-vectors.json`

```jsonc
{ "version": 1,
  "localDate":   [ { "name", "instant": "2026-10-04T02:30:00Z", "tz", "expect": "2026-10-03" } ],
  "localTime":   [ { "name", "instant", "tz", "expect": "23:30" } ],
  "slotInstant": [ { "name", "date": "2026-03-08", "time": "02:30", "tz": "America/New_York",
                     "expect": "2026-03-08T07:30:00Z" } ] }
```

`node scripts/validate-vectors.mjs` checks both files' shape, unique names,
sorted `expect` arrays and the required coverage tags. It does not run the
engine; `test:shared` does.

---

## 4. Pure-domain gates (`packages/shared`)

Test files live next to the source: `src/<module>.test.ts`. Nothing in this
package returns Portuguese text: functions return data, and the app formats it
(`AGENTS.md` rule 13).

### 4.1 Recurrence and time — RC-1, RC-2, TZ-1

- `recurrence.test.ts` — every vector; `validateRecurrence` accepts each shape
  of `03` §4.1 and rejects: interval 0, interval 366, empty `byday`, duplicate
  `byday`, `bymonthday` 0 and 32, unknown key, `once` without date, unsorted or
  duplicate `times_of_day`, `24:00`; `RangeError` over 400 days.
- `time.test.ts` — every vector of the three groups.
- RC-2 — the same `occurrences()` call under three `vi.setSystemTime` values
  returns identical arrays.

### 4.2 Day view — DV cases

```ts
buildDayView({
  date, now, tz, me, scope,
  templates, completions, pets,
  pendingCompletionIds,        // ReadonlySet<string> — ids of completions not yet acknowledged
}) → { overdue, now, later, done, allDone }
```

Each item carries `taskId, occurrenceKey, slotMs | null, originalDate, mode,
pets[], progress {done, total}, completions[], assignedTo, title, orphan`.
`progress` is 0/1 or 1/1 for `together`; for `per_pet` it counts the linked,
non-archived pets *(Q-8)*.

| Case | Given | Expect |
|---|---|---|
| DV-1 | slot 08:00, now 07:00 | Agora (exactly 60 min before) |
| DV-2 | slot 08:00, now 06:59 | Mais tarde |
| DV-3 | slot 08:00, now 09:00 | Agora (exactly 60 min after) |
| DV-4 | slot 08:00, now 09:01 | Atrasadas |
| DV-5 | all-day occurrence, incomplete | Agora, `slotMs` null |
| DV-6 | `together`, one live completion | Concluídas, with that completion |
| DV-7 | `per_pet`, 4 pets, 2 live completions | stays in its time group, progress 2/4 |
| DV-8 | `per_pet`, 4 pets, 4 live completions | Concluídas, 4/4 |
| DV-9 | `per_pet`, 4 pets, one archived, the other 3 complete | Concluídas, 3/3, and it is the only item: the archived pet's completion does not surface as an orphan |
| DV-10 | a completion with `undone_at` set | counts as not done |
| DV-11 | scope `mine` | templates assigned to me + unassigned; others' excluded |
| DV-12 | scope `all` | everything |
| DV-13 | scope `user:X` | only templates assigned to X; unassigned excluded |
| DV-14 | viewing yesterday, incomplete timed occurrence | Atrasadas; Agora and Mais tarde empty |
| DV-15 | viewing tomorrow | everything in Mais tarde |
| DV-16 | weekly on Monday, missed; viewing Wednesday (today) | in Atrasadas with `originalDate` = Monday |
| DV-17 | same, but now completed | not shown as overdue |
| DV-18 | same template also occurs today | Monday's is **not** carried |
| DV-19 | viewing today: a rule of every day, missed yesterday; and a rule of every 3 days, missed on its last date, with today an off day | the first is not carried — today's occurrence replaces it; the second is carried, with `originalDate` = that date *(ADR-033)* |
| DV-20 | `once` 30 days ago, incomplete | carried; 31 days ago → not carried |
| DV-21 | viewing a day other than today | no carry-overs at all |
| DV-22 | two live completions for one key, one of them in `pendingCompletionIds` | the acknowledged one is used |
| DV-23 | three items in a group | ordered by slot, then `sort_order`, then title; all-day items first |
| DV-24 | template soft-deleted; template with `ends_on` before the day; template whose pets are all archived or soft-deleted | no occurrences — each of the three proven on its own, with every other condition satisfied. The ended template missed its last occurrence yesterday, and that is not carried either *(ADR-033)* |
| DV-25 | `now` = `2026-10-04T02:30:00Z`, tz São Paulo, `date` from `localDate(now)` | the day is 2026-10-03 |
| DV-26 | every item in scope done, at least one | `allDone` true; with zero items → false |
| DV-27 | a live completion dated on the day, for a template that ended yesterday and has no successor occurrence with that key | shown under Concluídas as an `orphan` item with `title` = its `title_snapshot` *(R6.15)*; the same completion dated the day before is not shown |
| DV-28 | same, but a successor (`replaces_task_id` → the old template) has an occurrence with the same key and pet | that occurrence counts as done; no separate orphan item; the old template's occurrence missed the day before is not carried *(ADR-033)* |

Carry-over, precisely *(R6.5, ADR-033)*: when `date` is today, for each
template of any frequency that has not ended (`ends_on` is null or
`ends_on ≥ today`), take its most recent occurrence date `D` with
`today − 30 ≤ D < today`. If the template has **no** occurrence dated today,
every incomplete occurrence on `D` is carried into Atrasadas. The frequency is
never looked at: a rule of every day simply always has an occurrence today.
A template with `ends_on < today` carries nothing, whether it was ended or
forked.

Orphans *(R6.15)* follow the scope of the template they belong to.

### 4.3 Task edits — FK cases

| Case | Given | Expect |
|---|---|---|
| FK-1 | patch touches only cosmetic fields | `classifyTaskEdit` → `cosmetic`; so does a patch whose schedule values equal the old ones, including `pet_ids`, `byday` or `bymonthday` holding the same members in another order |
| FK-2 | patch changes `times_of_day` (or any schedule field) | `schedule` |
| FK-3 | no live completion for today's occurrences | `forkEffectiveDate` → today |
| FK-4 | one live completion for today | tomorrow |
| FK-5 | an undone completion for today only | today |
| FK-6 | `buildFork(old, edits, E, newId)`, old rule of every day | new template: `newId`, `starts_on = E`, `replaces_task_id = old.id`, `ends_on` copied, edits applied, cosmetic fields copied; old patch `{ends_on: E − 1}` |
| FK-7 | fork of a `once` template to a new date | new `starts_on` = the new date |
| FK-8 | `buildEnd(old, E)` | `{ends_on: E − 1}`; when the old template already ends before that, its own `ends_on` — an end date never moves later |
| FK-9 | the old template starts next Monday; edited today | `forkEffectiveDate` → next Monday (`E ≥ old.starts_on`) |
| FK-10 | daily every 3 days from 2026-10-01; only `times_of_day` edited; `E` = 2026-10-05, an off day | new `starts_on` = 2026-10-07, the next day of the old cycle; with `E` = 2026-10-07 → 2026-10-07 |
| FK-11 | weekly every 2 weeks on Monday from 2026-09-28; only `times_of_day` edited; `E` = 2026-10-07, an off week | new `starts_on` = 2026-10-12, the Monday of the next on week; with `E` = 2026-10-14, a day of an on week → 2026-10-14. The same rule from Wednesday 2026-09-30 gives the same two answers: weeks count from the Monday of `starts_on`. Every 3 weeks from 2026-09-28, `E` = 2026-10-07 → 2026-10-19 |
| FK-12 | monthly every 3 months on the 5th from 2026-08-05; only `times_of_day` edited; `E` = 2026-10-07, an off month | new `starts_on` = 2026-11-01, the first day of the next on month; with `E` = 2026-11-20 → 2026-11-20; with `E` = 2026-12-10 → 2027-02-01, across the year end |
| FK-13 | the same daily template; the edit changes `interval` to 2, or `freq` to weekly every 3 weeks on Monday; `E` = 2026-10-06, a day on which keeping the old cycle would give another date | new `starts_on` = `E`: a new cadence counts from the day it takes effect |

`buildFork` returns the `TaskCreate` payload of `04` §9 for the new template —
no `revision`, `updated_at`, `deleted_at` or `created_by`; the mutation layer
fills those *(Q-9)*. An edited `starts_on` is ignored: the start of a
successor is computed, never chosen.

The successor's start, precisely *(R3.8, ADR-034)*, with `old` the template
being replaced and `rule` its recurrence after the edits:

1. `rule.freq` is `once` → `rule.date`.
2. `rule.freq` or `rule.interval` differs from the old template's → `E`.
3. Otherwise, the first day `S ≥ E` on the old cycle:
   - **daily**: `r = daysBetween(old.starts_on, E) % interval`; `S = E` when
     `r` is 0, else `E + (interval − r)` days.
   - **weekly**: `r = weeksBetween(mondayOf(old.starts_on), mondayOf(E)) %
     interval`; `S = E` when `r` is 0, else `mondayOf(E) + 7 × (interval − r)`
     days.
   - **monthly**: `r = monthsBetween(old.starts_on, E) % interval`; `S = E`
     when `r` is 0, else the first day of the month `interval − r` months
     after `E`'s.

With `interval` 1 this is always `E`. The old template still ends on `E − 1`;
it has no occurrence between `E` and `S`, so nothing is lost or doubled.

### 4.4 Reminders — RM cases

`planReminders(input)` returns data, not text: each item is `{ id, fireAt,
channel, kind, taskId?, occurrenceKey?, taskTitle?, petNames?, healthEventId?,
healthTitle?, petName?, timerId?, fp }`. The app turns it into title and body.

`kind` is `reminder`, `health_due` or `timer`. `channel` is
`reminders-critical` or `reminders-routine` for a task reminder (RM-11),
`reminders-routine` for a health due and `timers` for a timer. Items are
sorted by `fireAt`, then by `id`, so the result does not depend on the
order of the replica's rows *(Q-10)*.

| Case | Expect |
|---|---|
| RM-1 | an occurrence with a time, assigned to me, incomplete, in the future → planned, id `rem:<task>:<key>`, `fireAt = slotInstant` |
| RM-2 | assigned to someone else → not planned; unassigned → planned |
| RM-3 | all-day occurrence → not planned |
| RM-4 | fully complete → not planned; `per_pet` 2/4 → planned |
| RM-5 | slot in the past → not planned |
| RM-6 | horizon: day +7 planned, day +8 not |
| RM-7 | 250 candidates → the 200 soonest; the cap counts task reminders only, never health dues or timers |
| RM-8 | health event due in 10 days → `due:<id>` at 09:00 local that day, with `petName`; due date passed → not planned; due in 30 days → planned, in 31 → not; the event deleted, or its pet archived or absent from the replica → not planned *(ADR-035)* |
| RM-9 | timer started by me, running → `tmr:<id>` at `ends_at`; started by another, or cancelled → not planned; its template absent from the replica → still planned, without `taskTitle` |
| RM-10 | changing a template's title changes the item's `fp`; changing nothing keeps it |
| RM-11 | `reminder_class` maps to channel `reminders-critical` / `reminders-routine` |
| RM-12 | an id listed in `suppressedIds` is not planned |

### 4.5 Walk math — WK-2, WK-3 and friends

Units *(Q-11)*: a point's `t`, `startedAt` and `now` are epoch
milliseconds; distances are metres on a sphere of radius 6 371 000 m; seconds
may be fractional. No function mutates its input.

- `haversineM` — two known pairs within 0.5%.
- Accumulator — a 10-point straight track with 10 m steps sums to the expected
  distance; a good fix less than 5 m from the last counted position adds
  nothing and does not move that position (20 jittering fixes around one spot
  add 0 m); a point with `acc > 30` adds nothing and does not become the
  counted position (WK-2); points flagged paused add nothing; the segment that
  spans a pause is not counted: a paused fix clears the counted position, and
  the first good fix after it sets the position without adding distance.
  `pointCount` counts every fix added, good or not.
- `paceSecPerKm(distanceM, movingS)` — null under 0.5 m/s average.
- `currentSpeedMps(points)` — displacement, not path *(R4.12)*. Take the
  good fixes with `t ≥ latest.t − 10 000`, going back from the latest fix
  and stopping at the first paused one. With fewer than two, or with the
  oldest and newest at the same instant, 0. Otherwise `d` is the haversine
  distance from the oldest to the newest: 0 when `d < 5`, else `d` divided
  by their time difference in seconds. Cases: four fixes 6 m apart, 3 s apart,
  on a line → 2 m/s; four fixes 3 s apart alternating 2 m either side of one
  spot — standing still with jitter → 0; a window that reaches a paused fix
  uses only the fixes after it.
- `simplifyRoute` — WK-3 as stated in `03` §7; first and last points are kept.
- `routeForUpload(points)` — `[lat, lon, t, acc]` tuples of the good,
  unpaused fixes, simplified at 5 m: of three fixes, a middle one 7 m off the
  line between the others is kept, and one 3 m off is dropped.
- `routePreview(points)` — at most 32 `[lat, lon]` pairs, first and last kept.

### 4.6 Small helpers

`petAge` → `{years, months, days}` across a leap day; `needsWeightConfirmation`
(exactly 20% → no; 20.01% → yes; no previous entry → no); `validators` (each
limit of `03` accepted at its edge and rejected one past it).

`upcomingCare({healthEvents, pets, today})` *(R2.11)* — one item per event
with `next_due_on`, each with `daysUntil` = days from `today` to the due
date: due in 7 days → included, 7; in 8 → not; due today → 0; due 2 days
ago → −2, and it stays until the event is edited or deleted; a deleted event
→ not; an event whose pet is archived, soft-deleted or absent from the
replica → not *(ADR-035)*. Sorted by due date, then by event id.

Shapes *(Q-12)*: `petAge(birthdate, today)` counts whole months from the
birth day, clamped to the end of a shorter month, and the rest in days; a
birthdate after `today` throws `RangeError`. A validator takes the form's
values under the row's field names and returns every error as
`{field, code}` with the codes of Q-7; a value that is not an object is
`{field: 'form', code: 'invalid'}`, and unknown keys are ignored. Lengths
count code points. A reference is a canonical hyphenated UUID: a 36-character
string that is not one is `invalid`. An instant is UTC, ending in `Z` or
`+00:00`: any other offset, ahead of UTC or behind it, is `invalid`. The
password limit, 8–128, is in `04` §3.

---

## 5. API gates (`services/api/tests`)

### 5.1 The test database *(ADR-030)*

`conftest.py`, session scope: connect to the server in `TEST_DATABASE_URL`,
`CREATE DATABASE pawlaris_test_<random>`, run `alembic upgrade head`, yield,
drop it. The app under test is built by `create_app()` with settings pointing
at that database and with `get_clock` overridden by a `FrozenClock` fixture.

- **No mocked database.** The conflict rules are enforced by a unique index; a
  mock cannot prove an index works.
- **No shared state.** Every test creates its own family through the
  `make_family()` fixture (random ids and emails) and never assumes the
  database is empty. No test truncates.
- **Two tests need a database of their own**, because they depend on its whole
  state: `test_migrations.py` and `test_bootstrap.py` each create, migrate and
  drop a private scratch database through the `scratch_database()` fixture.
- HTTP tests use `httpx.AsyncClient` over `ASGITransport`. Socket tests use
  Starlette's `TestClient` for the socket **and** for the HTTP calls in the
  same test, so one event loop owns the app.
- Shared fixtures and who creates them: `make_family`, `scratch_database`
  (P2-1); `client_for(user)` → an authenticated client (P2-3); `idem()` → a
  fresh `Idempotency-Key` header (P2-4).

### 5.2 Catalogue

| Code | Test file | Asserts |
|---|---|---|
| SY-1, SY-3 | `tests/db/test_revision.py` | `03` §1 |
| — | `tests/db/test_migrations.py` | `upgrade head → downgrade base → upgrade head` |
| ID-1 | `tests/security/test_no_secret_leak.py` | `03` §2 |
| — | `tests/auth/test_passwords.py` | hash starts with `$argon2id$v=19$m=19456,t=2,p=1$`; verify round-trips; wrong password fails |
| R1.5 | `tests/auth/test_rate_limit.py` | 5 failures → 6th is 429 with `Retry-After`; clock + 15 min → allowed; success resets, whatever the letter case of the email; 20 simultaneous wrong passwords for one email → exactly 5 are 401 and 15 are 429; with the email limit and the global cap both reached, `Retry-After` is the longer wait |
| R1.6, R1.8 | `tests/auth/test_refresh.py` | the four rows of `04` §3's refresh table: a rotated token is honoured twice in a row while its successors are unused, however far the clock is advanced; once a successor has been rotated, presenting the original → 401 **and the chain is revoked in the database** (assert after the request) |
| R1.1 | `tests/auth/test_closed_registration.py` | `POST /auth/register` → 404 |
| R1.3 | `tests/auth/test_invites.py` | member → 403; code single-use; expired → 410; redeem creates the role on the invite; two concurrent redeems of one code → exactly one 200 |
| ID-2, ID-3 | `tests/api/test_idempotency.py` | `03` §9, parametrized over every ⟳ route; missing key → 400 |
| SY-2, SY-4, SY-5, SY-6 | `tests/sync/test_sync.py` | `04` §6; plus: `revision` equals the family revision on a final page; `epoch` is present and changes when `server_meta` is updated |
| FM-1 | `tests/api/test_family.py` | last leader, including the concurrent case; member removal side effects (R1.20); a removed member's email can be invited again; a valid timezone → 200, an invalid one → 422 |
| TK-1 | `tests/api/test_tasks.py` | schedule fields rejected on PATCH; `pet_ids` validation; assignment rules, including the fork exception |
| CP-1 … CP-5 | `tests/sync/test_completions.py` | `03` §5 |
| TM-1 (server half) | `tests/api/test_timers.py` | stores, syncs, cancels idempotently |
| — | `tests/api/test_walks.py` | finish as upsert; discard; route fetch; preview stored and synced; limits; two active walks accepted |
| AS-1, AS-2 | `tests/api/test_assets.py` | plus: PNG bytes sent as `image/jpeg` stored as PNG; non-image → 422; `Content-Length` over 8 MB → 413 before any byte is read; a body that exceeds 8 MB despite a smaller `Content-Length` → 413; no `Content-Length` → 413; wrong hash → 422; 5000×5000 image → 422; same id other bytes → 409; unauthenticated → 401 with the body unread |
| WS-1, WS-2 | `tests/sync/test_socket.py` | `04` §7 |
| — | `tests/api/test_push.py` | with a fake sender: completion → message to the other member only; lost race → duplicate push to the winner; author never targeted; sender failure does not fail the request |
| R5.9 | `tests/api/test_timing.py` | every response has `Server-Timing: app;dur=<number>`; a `/sync` response over 1 KB is gzip-encoded when asked |
| — | `tests/api/test_commit_order.py` | a handler whose commit fails returns 500, and its after-commit callback never runs; a successful one runs its callback after the row is visible to a second connection |
| RB-1, RB-2 | `tests/security/test_role_matrix.py` | `04` §5 |
| census | `tests/security/test_route_census.py` | `04` §5 |
| — | `tests/security/test_no_naive_time.py` | no `datetime.now` / `utcnow` in `app/` outside `clock.py` |

CP-1, as code:

```python
async def test_cp1_concurrent_completions_yield_one_row(make_family, client_for, idem):
    fam = await make_family(members=2, pets=1)
    task = await fam.create_task(completion_mode="together")
    bodies = [fam.completion_body(task, "2026-09-14T08:00") for _ in range(10)]   # 10 distinct ids
    responses = await asyncio.gather(*[
        client_for(fam.users[i % 2]).post("/api/v1/completions", json=b, headers=idem())
        for i, b in enumerate(bodies)
    ])
    assert [r.status_code for r in responses] == [200] * 10
    assert len({r.text for r in responses}) == 1            # byte-identical bodies
    assert await fam.count_live_completions(task, "2026-09-14T08:00") == 1
```

---

## 6. Client-core gates (`apps/mobile/src/**/__tests__`)

All run under Jest with `sql.js` and fakes; no device. Test helpers live in
`apps/mobile/src/testing/`: `memoryDriver`, `fakeClock`, `sequentialIds`, row
factories (P3-1); `fakeHttp`, `fakeRandom`, `fakeSecretBox` (P3-3);
`fakeFileSystem` (P3-8).

| Code | Test file | Asserts |
|---|---|---|
| — | `db/__tests__/migrations.test.ts` | from version 0 and from each intermediate version to latest |
| — | `db/__tests__/driver.test.ts` | `transaction` is re-entrant; an inner throw rolls back the outer |
| RP-1, RP-2, RP-3 | `replica/__tests__/apply.test.ts` | `10` §2 |
| OB-1 … OB-6 | `sync/__tests__/outbox.test.ts` | `10` §4 |
| PL-1 … PL-4 | `sync/__tests__/pull.test.ts` | `10` §5 |
| WS-1 (client half) | `sync/__tests__/socket.test.ts` | `ready`, `poke` and `pong` with a newer revision kick; older ones do not; 4401 refreshes then reconnects; missed pong reconnects |
| SE-1 … SE-4 | `auth/__tests__/session.test.ts`, `auth/__tests__/lifecycle.test.ts` | `10` §8.1 |
| AF-1 … AF-4 | `assets/__tests__/files.test.ts` | `10` §7 |
| WK-1 | `walks/__tests__/pointStore.test.ts` | `03` §7 |
| TM-1 (client half) | `replica/__tests__/timers.test.ts` | remaining time correct after re-hydrating with an advanced clock |
| — | `sync/__tests__/engine.test.ts` | drain runs before pull; a kick during a cycle causes exactly one re-run; states of `10` §8; a failed pull schedules a retry |
| — | `notifications/__tests__/reconcile.test.ts` | cancels extras, schedules missing, re-schedules changed `fp`; running twice changes nothing |

---

## 7. Component gates

React Native Testing Library. Test behaviour and state, never implementation.
Screen-level tests live in `apps/mobile/__tests__/`, never inside `app/`.

```ts
describe('TaskCard', () => {                                    // P5-3
  it('does not complete on press-in', …)                                    // R3.18
  it('completes on release, before any request resolves', …)               // R3.18
  it('does not complete when the press is cancelled by a scroll', …)
  it('stays lit and shows the winner when it loses the race', …)           // R3.21
  it('never puts the star out on a network failure', …)
  it('renders 2/4 and four pet toggles in per_pet mode, with no master checkbox', …)
  it('draws the constellation line when the last pet is completed', …)     // 06 §4.3
  it('asks for confirmation before undoing, naming who and when', …)       // R3.22
  it('disables the checkbox on a future day', …)                           // R3.26
  it('shows an orphan completion as done, with its stored title', …)       // R6.15
});

describe('TaskCard — photo proof', () => {                      // P5-5
  it('opens the camera instead of completing when a photo is required', …) // R3.44
  it('shows "enviando…" while the photo is queued, and no label once sent', …) // R3.46
});

describe('StarCheck', () => {                                   // P4-2
  it('gives scale feedback on press-in without committing', …)
  it('lights the star and fires one haptic on release', …)
  it('emits no sparks under reduce motion', …)
  it('is a checkbox to assistive technology and announces its state', …)
});

describe('Starfield', () => {                                   // P4-2
  it('generateStars is deterministic for a seed and stays inside the bounds', …)
  it('stops its shared values when the screen loses focus', …)
  it('renders in both themes from tokens only', …)
});

describe('PermissionGate', () => {                              // P6-1
  it('renders children when granted', …)
  it('asks for precise location when approximate', …)                      // R4.4
  it('offers Settings when blocked', …)
});

describe('ScopeFilter', () => {                                 // P5-2
  it('renders nothing for a member', …)                                    // R6.11
  it('defaults to Minhas for a leader and persists the choice', …)
});

describe('motion', () => {
  it('MO-1: reduce motion takes the crossfade path on a hero navigation', …)                              // P4-8
  it('MO-3: reduce motion starts no repeating animation in Starfield, Orbit, SyncIndicator, Skeleton, PoweredBy', …) // P4-2
});
```

---

## 8. E2E — Maestro, real phones

```
apps/mobile/.maestro/
  01-login.yaml
  02-complete-and-undo.yaml
  03-photo-proof-offline.yaml        airplane mode → complete → reconnect → the "enviando…" label disappears
  04-pet-and-weight.yaml
  05-task-create-and-fork.yaml
  06-walk.yaml                       mock location provider
  07-offline-queue.yaml              5 changes offline → reconnect → indicator returns to synced
  08-hero-loop.yaml                  10 pet-card round trips (used by perf frames)
  09-dashboard-fling.yaml            scripted flings (used by perf frames)
  two-device/a-complete.yaml  two-device/b-observe.yaml
```

`scripts/e2e-two-device.mjs <serialA> <serialB>` runs flow A on one phone and
flow B on the other and fails unless B shows the completion, with the right
name, within 3 seconds *(R5.8)*. Maestro drives one device per process; the
script is what coordinates two.

Flows select by `testID` only. E2E runs on demand before a release — there is
no free hosted Android device farm, and pretending otherwise would put a lie in
the pipeline.

## 9. Performance and latency *(ADR-028, ADR-032)*

`scripts/perf.mjs startup | frames <flow> | memory | bundle | apk`, budgets and
method in `06` §1. Results are written to `docs/evidence/perf-<date>.md`.

Server latency *(R5.9)* is measured against the box by `scripts/latency.mjs`: it
logs in, sends 200 completion + undo pairs and 200 incremental `/sync` calls
sequentially, and reports the p50 and p95 of the server-side handling time
taken from the `Server-Timing` response header. p95 must be under 100 ms.

## 10. Coverage floors

| Scope | Floor | Added to the runner's config by |
|---|---|---|
| `packages/shared/src` | **95%** lines and branches | P0-3 |
| `services/api/app` | 85% | P0-4 (in the gate command) |
| `apps/mobile/src/db`, `src/replica` | **90%** | P3-1, P3-2 |
| `apps/mobile/src/api`, `src/auth`, `src/sync`, `src/assets` | **90%** | P3-3, P3-4, P3-8 |
| `apps/mobile/src/notifications`, `src/walks` | 80% | P5-7, P6-2 |
| `apps/mobile/src/features` | 60% | P4-3 |
| `apps/mobile/src/ui`, `app/` | no floor — judged by the named state tests | — |

A floor on a directory is added by the task that creates that directory (a
threshold on a path with no files fails the run).

Coverage is a smoke detector, not a goal. The named invariants are the gate; a
high number with none of them passing means nothing.

## 11. CI (GitHub Actions)

```yaml
on: [push, pull_request, workflow_dispatch]
jobs:
  secrets: # gitleaks
  shared:  # eslint, tsc, vitest --coverage, validate-vectors
  api:     # postgres:16 service; ruff, mypy --strict, pytest --cov, contract-check
  mobile:  # eslint, tsc, jest --coverage
  image:   # on main, or by manual dispatch on any ref: build linux/amd64 + linux/arm64, push to GHCR
```

## 12. Pre-commit

Installed once per clone with
`uvx pre-commit install --hook-type pre-commit --hook-type commit-msg` (P0-8).

```yaml
pre-commit stage (static only — no tests):
  - ruff check --fix ; ruff format
  - mypy app --strict
  - tsc --noEmit            (shared, mobile)
  - eslint --fix
  - gitleaks
  - guard-todo:  a TODO or FIXME added by this commit without "(#<number>)"  — code files only, never spec/ or *.md
  - guard-spec:  changes under spec/ other than QUESTIONS.md, contracts/ and a task checkbox
                 going from [ ] to [~] in 08-tasks.md — skipped when PAWLARIS_ROLE=orchestrator
commit-msg stage:
  - guard-commit-msg: Conventional Commits per AGENTS.md §5, read as git stores the message
                      (comment lines and everything after the scissors line ignored)
```

## 13. Device and box checks

Some checks need a phone in someone's hand, or the box. They cannot run in
`verify`, and the implementer often cannot run them at all. So they are
**separate from code acceptance**:

- A task that has one carries a line `**Device:** [ ] <what to check>` in `08`.
- The implementer writes `docs/evidence/<TASK-ID>.md` with the exact steps as a
  checklist — commands to run, what to look for — and runs every step it can
  (anything `adb` or a script can do with a phone attached). Steps that need a
  person are marked `OWNER`.
- Whoever runs a step records its raw output, the device model, the Android
  version and the date under it.
- The repository is public. Evidence and documentation name a phone by its
  model, never by its serial number: write `<serial>` where `adb` prints one,
  and `<PC-LAN-IP>` for the dev machine's address.
- When every step has a result, the orchestrator flips the line to
  `**Device:** [x]`.
- Tasks that depend on this one need only its code to be accepted. The release
  (P8-7) needs every Device line checked.

Device checks need a dev client on the phone (P0-6) and the owner prerequisites
H3 and H4.

## 14. Writing tests

1. **Red first.** Write the test from the task's *Tests* list and watch it fail
   for the right reason.
2. **Name tests after the invariant** (`CP-1`, `OB-2`, `DV-16`). A failure
   should point at a spec line.
3. **Freeze the clock.** Every time-dependent test injects a `Clock`.
4. **Test the loss paths.** Losing a completion race, approximate-only
   location, a photo still uploading, an expired token mid-drain, a rejected
   mutation. Real use produces these daily and test suites skip them.
5. **Never weaken a test to make it pass.** If a spec'd assertion seems wrong,
   stop and write it in `spec/QUESTIONS.md`.
