# 07 — The Test Harness

This file answers the PRD's demand for "tested integrity front and back" with
executable gates *(A-15)*. Under SDD the harness **is** the definition of done.
No harness, no method — just opinions about whether something looks finished.

---

## The one command

```bash
pnpm verify              # every gate
pnpm verify --only <id>  # one gate
pnpm verify --list       # what exists and which task implements it
```

The runner is `scripts/verify.mjs` — Node built-ins only, so the harness works
before a single dependency is installed *(ADR-014; `make verify` delegates to it
on Linux/CI)*. Each gate reports one of:

| Status | Meaning |
|---|---|
| `PASS` | ran and succeeded |
| `FAIL` | ran and broke — fix the code |
| `PENDING` | the gate's tooling does not exist yet — implement its task |

**PENDING is not success.** `verify` exits non-zero until every gate passes, and
names the backlog task that would make each pending gate real. That is what keeps
`08-tasks.md` self-enforcing instead of aspirational.

If `pnpm verify` is green, the task is done. If it is red, it is not — regardless
of how it looks on the phone. This rule has no exceptions and no "I'll fix it in
the polish pass".

---

## Layers

| Layer | Tool | Runs in | Speed |
|---|---|---|---|
| Static — TS | `tsc --noEmit` (strict) | pre-commit, CI | ~5 s |
| Static — Py | `ruff check` + `mypy --strict` | pre-commit, CI | ~8 s |
| Unit — domain | Jest / pytest | pre-commit, CI | < 10 s |
| Component | Jest + React Native Testing Library | CI | ~40 s |
| API integration | pytest + httpx + disposable Postgres | CI | ~60 s |
| Contract | OpenAPI drift check | CI | ~3 s |
| Parity | TS vs Python recurrence vectors | CI | ~5 s |
| E2E | Maestro on a real Android device | pre-release | ~4 min |
| Perf | Maestro + frame/startup assertions | pre-release | ~2 min |

**The pyramid is deliberately bottom-heavy.** The highest-risk logic in this app
(recurrence, conflict resolution, sync ordering, distance accumulation) is all
*pure*, so it is tested fast, exhaustively, and with no device in the loop.

---

## Gate 1 — Parity: TS and Python must agree *(A-03, RC-1)*

The single most important gate in the project. Two implementations of recurrence
exist by design (ADR-003); the moment they disagree, one phone shows a task the
other does not, and the app silently lies about medication.

`spec/fixtures/recurrence-vectors.json`:

```jsonc
[
  {
    "name": "daily every 2 days across a month boundary",
    "recurrence": { "freq": "daily", "interval": 2 },
    "times_of_day": ["08:00"],
    "starts_on": "2026-01-28",
    "ends_on": null,
    "tz": "America/Sao_Paulo",
    "from": "2026-01-28", "to": "2026-02-06",
    "expect": ["2026-01-28","2026-01-30","2026-02-01","2026-02-03","2026-02-05"]
  },
  {
    "name": "twice daily produces datetime keys",
    "recurrence": { "freq": "daily", "interval": 1 },
    "times_of_day": ["08:00","20:00"],
    "starts_on": "2026-03-01", "ends_on": null,
    "tz": "America/Sao_Paulo",
    "from": "2026-03-01", "to": "2026-03-02",
    "expect": ["2026-03-01T08:00","2026-03-01T20:00",
               "2026-03-02T08:00","2026-03-02T20:00"]
  }
]
```

Required vector coverage:

- leap day (2028-02-29) and month ends 28/29/30/31
- `bymonthday: [31]` in a 30-day month (must skip, not clamp)
- `starts_on` / `ends_on` boundaries, inclusive/exclusive
- a range that begins mid-interval
- **a DST-observing timezone (`America/New_York`)** across both transitions —
  Brazil has no DST, so without this the logic would be accidentally-correct and
  would break the day it travels *(A-23)*
- empty result ranges
- `once` before, on, and after the range

```makefile
parity:
	cd packages/shared && pnpm vitest run recurrence.parity
	cd services/api && uv run pytest tests/domain/test_recurrence_parity.py
	node scripts/assert-parity.mjs   # diffs both outputs byte-for-byte
```

**Both runners read the same fixture file.** Neither may contain its own
expectations — the fixture is the shared truth.

---

## Gate 2 — Contract drift *(A-15)*

```makefile
contract-check:
	uv run python -m app.export_openapi > /tmp/openapi.json
	diff <(jq -S . /tmp/openapi.json) <(jq -S . spec/contracts/openapi.json) \
	  || (echo "OpenAPI drift — update the spec first, then run make contract-freeze"; exit 1)

contract-freeze:
	uv run python -m app.export_openapi | jq -S . > spec/contracts/openapi.json

types:
	pnpm openapi-typescript spec/contracts/openapi.json \
	  -o packages/shared/src/api-types.ts
```

A backend change that breaks the client fails `tsc` on the client, in the same
CI run. The contract cannot silently rot.

---

## Gate 3 — Sync invariants (the ones that bite in the field)

These tests encode the scenarios this family will actually hit.

```python
# tests/sync/test_conflict.py
async def test_concurrent_completion_yields_one_row_and_ten_identical_200s():
    """CP-1: both phones complete Aurora's morning feeding at once."""
    results = await asyncio.gather(*[
        post_completion(user=random.choice([hudson, duda]),
                        task=feed_aurora, occurrence="2026-09-14")
        for _ in range(10)
    ])
    assert all(r.status_code == 200 for r in results)       # never 409
    assert len({r.json()["id"] for r in results}) == 1      # one winner
    assert await count_completions(feed_aurora, "2026-09-14") == 1

async def test_replayed_mutation_id_is_a_noop():            # CP-2
    ...

async def test_undo_writes_a_tombstone_not_a_delete():      # CP-3
    ...
```

```ts
// src/sync/__tests__/outbox.test.ts
it('OB-1: drains 20 offline mutations in order, exactly once, across a restart', ...)
it('WS-1: converges after a missed-revision gap without user action', ...)
it('SY-2: /sync?since returns exactly the changed rows, in revision order', ...)
```

```ts
// src/domain/__tests__/walk.test.ts
it('WK-2: a 500m-accuracy outlier does not inflate distance', ...)
it('WK-1: ≥99 of 100 points survive a mid-stream store kill', ...)
it('WK-3: a 2000-point route serializes under 100KB after downsampling', ...)
it('TM-1: a timer is still correct after a simulated cold restart', ...)
```

---

## Gate 4 — Security

```python
def test_no_response_schema_leaks_a_secret():       # ID-1
    """Walk every Pydantic response model; fail on hash/password/secret fields."""
    for model in all_response_models():
        for field in model.model_fields:
            assert not re.search(r"(hash|password|secret|token_hash)", field, re.I)

def test_public_registration_returns_404(): ...      # R1.1
def test_login_rate_limit_returns_429_after_5(): ... # R1.5
def test_rotated_refresh_token_reuse_revokes_family(): ...  # R1.8
def test_upload_rejects_a_png_named_jpg_by_magic_bytes(): ...
def test_every_route_except_the_allowlist_requires_auth(): ...

# A-28 / ADR-012 — roles are the project's first privilege boundary
@pytest.mark.parametrize("action,role,expected", PERMISSION_MATRIX)   # RB-1
def test_role_matrix(action, role, expected):
    """Every row of 04 §Permissions, for both roles, exact status code."""

def test_member_cannot_reach_any_leader_endpoint(): ...               # RB-2
def test_member_cannot_patch_assigned_to_on_a_task_they_dont_own(): ...
def test_member_scope_all_returns_200_not_403(): ...   # OPEN-1: reads are family-wide
def test_demoting_the_last_leader_returns_409(): ...                  # FM-1
```

The **route census** enumerates the app's routes at runtime and asserts each is
either on the explicit allowlist (`/health`, `/auth/login`, `/auth/refresh`,
`/auth/redeem`) or *both* authenticated **and** present as a row in the permission
matrix in `04` §Permissions. Since roles arrived *(A-28)*, "authenticated" alone
is no longer sufficient: a new endpoint with no matrix row fails the census, so an
unauthorized endpoint cannot be added by accident either.

---

## Gate 5 — Component tests

RTL + MSW. Test behavior and state, never implementation.

```ts
describe('TaskCard', () => {
  it('checks optimistically before the request resolves', ...)
  it('stays checked and shows attribution when it loses the race', ...)  // R3.14
  it('never un-checks on a network failure', ...)                        // R3.11
  it('renders 2/4 progress for per_pet mode with four cats', ...)        // A-19
  it('shows "photo pending upload" when the asset is queued', ...)       // R3.30
  it('blocks completion when requires_photo and no capture exists', ...)
});

describe('PermissionGate', () => {
  it('offers tracking with a visible warning in foreground_only', ...)   // R4.3
  it('deep-links to Settings for the background grant on Android 11+', ...)
});
```

---

## Gate 6 — E2E (Maestro, real Android device)

Maestro over Detox: YAML flows, no native build instrumentation, works with Expo
dev clients, and free.

```
.maestro/
  01-login.yaml
  02-complete-task-and-sync.yaml     # two devices — the core promise
  03-photo-proof-offline.yaml        # airplane mode → complete → reconnect
  04-walk-tracking.yaml              # mock location provider
  05-offline-queue-drain.yaml
  06-hero-transition-perf.yaml       # asserts frame budget
```

`02` is the flagship: device A completes a task, device B must reflect it within
2 seconds with the correct attribution, with no manual refresh.

`03` runs in airplane mode: capture a photo, complete the task, confirm it shows
done with `pending upload`, restore the network, confirm the asset resolves.

---

## Gate 7 — Performance *(A-22)*

```yaml
# 06-hero-transition-perf.yaml
- launchApp: { clearState: true }
- assertTrue: ${output.startupMs < 1500}
- tapOn: { id: "pet-card-aurora" }
- assertNoDroppedFrames: { during: "hero", budget: 0 }
- assertTrue: ${output.firstFrameMs < 16}
```

Measured on the actual target phones, not an emulator — emulator frame timing is
not evidence of anything.

---

## Coverage floors

| Scope | Floor | Rationale |
|---|---|---|
| `services/api/app/domain` | **95%** | pure, critical, cheap to cover |
| `services/api/app` overall | 85% | |
| `apps/mobile/src/domain` | **95%** | recurrence, metrics, occurrence keys |
| `apps/mobile/src/sync` | **90%** | outbox, cursor, conflict handling |
| `apps/mobile/src/features` | 70% | |
| `apps/mobile/src/ui` | no % floor | judged by named state tests, not lines |

Coverage percentage is a smoke detector, not a goal. The named invariant tests
(CP-1, OB-1, WK-2, RC-1…) are the real gate; a 95% number with none of them
passing means nothing.

---

## CI (GitHub Actions, free tier)

```yaml
on: [push, pull_request]
jobs:
  api:     # ruff, mypy --strict, pytest+cov, alembic up→down→up, contract-check
  mobile:  # tsc, eslint, jest+cov
  parity:  # both engines against the shared fixture
  build:   # multi-arch image → GHCR (A-02: never on the VM)
```

E2E and perf run on demand before a release — there is no free hosted Android
device farm, and pretending otherwise would put a lie in the pipeline.

---

## Pre-commit

```yaml
- ruff check --fix ; ruff format
- mypy (changed files)
- tsc --noEmit
- eslint --fix
- gitleaks   # no committed secrets
- forbid: TODO without an issue reference
```

---

## Writing tests under SDD

1. **Red first.** Write the test from the task's Acceptance Criteria and watch it
   fail for the *right reason*. A test that was never red proves nothing.
2. **Name tests after the invariant** (`CP-1`, `OB-1`, `RC-2`). A failure should
   point at a spec line, not at a function name.
3. **Freeze the clock.** Every time-dependent test injects a `Clock`. A test that
   reads the real clock is flaky by construction *(P5)*.
4. **No mocked database in API tests.** A disposable Postgres — the conflict
   semantics in CP-1 are enforced by a *unique index*, and a mock cannot prove a
   unique index works.
5. **Test the loss paths.** Losing a completion race, `foreground_only`
   permission, pending upload, expired token mid-mutation. These are the states
   real use produces daily and test suites skip.
