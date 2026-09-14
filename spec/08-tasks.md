# 08 — Implementation Backlog

Ordered. Each task is small enough to finish and gate in one sitting. Follow the
SDD loop from `CLAUDE.md`: read spec → update contract if needed → red test →
implement → `pnpm verify` → check the box with harness output in the commit body.

**Do not reorder phases.** The sequence exists because P1 (the recurrence engine
and the conflict model) is what every later phase depends on being correct.
Building screens before the sync core is the classic way to end up rewriting the
screens.

Legend: `⛔` blocks everything downstream · `↔` can run in parallel with siblings

---

## P0 — Foundation

- [x] **P0-1 ⛔ Monorepo scaffold** — done 2026-09-14
  pnpm workspace: `apps/mobile`, `services/api`, `packages/shared`, `infra`.
  `scripts/verify.mjs` implements every gate from `07`; `Makefile` delegates *(ADR-014)*.
  *Accept:* `pnpm verify` runs and fails loudly with a clear message per gate. ✅
  14 gates reported PENDING with their implementing task; a seeded failing gate
  was correctly reported as FAIL with captured output; exit 1 in both cases.
  *Gate:* `pnpm verify` (expected red)

- [ ] **P0-2 ↔ Expo app initialized**
  Latest stable SDK (pin at init — do not assume a version), TypeScript strict,
  New Architecture on, Hermes, expo-router, `react-native-screens`.
  *Accept:* app boots on a physical Android phone; `tsc --noEmit` clean.
  *Gate:* `pnpm -C apps/mobile typecheck`

- [ ] **P0-3 ↔ Local Android build pipeline** *(A-20)*
  ⚠️ **Blocked on the dev machine:** installed Java is 1.8.0_501; Android builds
  need JDK 17. Android Studio is also not present.
  Android Studio + JDK 17 on the Windows dev machine; `npx expo run:android`
  produces a custom dev client. Document it in `docs/build.md`.
  *Accept:* a dev client APK installs and runs on both phones without EAS.
  *Gate:* manual + documented, checked into `docs/build.md`

- [ ] **P0-4 ⛔ FastAPI + Postgres, sized for the real box** *(A-02)*
  ⚠️ **Blocked on the dev machine:** Docker is not installed. Docker Desktop on
  Windows Home requires WSL2. The FastAPI app and its unit tests can be built
  without it; the compose stack and Postgres-backed integration tests cannot.
  `docker-compose.yml` with `mem_limit` per `05`, tuned `postgresql.conf`,
  1 Uvicorn worker, `GET /health`.
  *Accept:* stack runs under 1 GB total RSS at idle, verified with `docker stats`.
  *Gate:* `make api-up && curl /health` + a recorded `docker stats` snapshot

- [ ] **P0-5 ↔ CI pipeline**
  GitHub Actions per `07`. Image build + GHCR push — **never on the VM**.
  *Accept:* a PR runs all jobs; a deliberate type error fails the run.
  *Gate:* CI green on a trivial PR, red on a seeded error

- [ ] **P0-6 ↔ Pre-commit hooks**
  ruff, mypy, tsc, eslint, gitleaks, TODO-without-issue check.
  *Gate:* `pre-commit run --all-files`

---

## P1 — The core that everything depends on

- [ ] **P1-1 ⛔ Recurrence vectors fixture** *(RC-1)*
  Author `spec/fixtures/recurrence-vectors.json` with the full coverage list in
  `07` — leap day, month ends, `bymonthday: [31]` in a 30-day month, boundaries,
  and **`America/New_York` across both DST transitions** *(A-23)*.
  *Accept:* ≥ 30 vectors; every branch of §4.1 represented.
  *Gate:* schema-validated by `scripts/validate-vectors.mjs`

- [ ] **P1-2 ⛔ Recurrence engine — TypeScript**
  `packages/shared/src/recurrence.ts`. Pure, no ambient clock *(RC-2)*.
  *Accept:* every vector passes; a frozen-clock test at three fake "now"s returns
  identical output.
  *Gate:* `pnpm -C packages/shared test`

- [ ] **P1-3 ⛔ Recurrence engine — Python**
  `services/api/app/domain/recurrence.py`. Same fixture, same results.
  *Gate:* `uv run pytest tests/domain/test_recurrence_parity.py`

- [ ] **P1-4 ⛔ Parity gate wired into `pnpm verify`** *(A-03)*
  `scripts/assert-parity.mjs` diffs both outputs byte-for-byte.
  *Accept:* deliberately breaking one implementation fails the gate.
  *Gate:* `make parity`

- [ ] **P1-5 ⛔ Database schema + revision trigger** *(SY-1)*
  All tables from `03`, Alembic migration, `bump_revision()` trigger.
  *Accept:* a direct insert into every syncable table advances the revision;
  `upgrade head → downgrade base → upgrade head` is clean.
  *Gate:* `uv run pytest tests/db/`

- [ ] **P1-6 ⛔ Occurrence + completion join logic**
  Given templates, completions and a date range, produce the rendered day —
  including `per_pet` progress *(A-19)*.
  *Accept:* four cats, one `per_pet` medication, two completed → `2/4`.
  *Gate:* `pnpm -C packages/shared test occurrences`

---

## P2 — Auth

- [ ] **P2-1** Argon2id hashing, benchmarked **on the actual VM** *(A-12)*.
  *Accept:* a hash takes 200–300 ms on the target box, not on the dev machine.
  *Gate:* `uv run pytest tests/auth/test_hashing.py` + a recorded benchmark

- [ ] **P2-2** Access + rotating refresh tokens, token-chain revocation *(A-11)*.
  *Accept:* reusing a rotated token revokes the whole token chain and returns 401.
  *Gate:* `uv run pytest tests/auth/`

- [ ] **P2-3** Bootstrap script + invite codes; **no public registration** *(A-13)*.
  *Accept:* unauthenticated `POST /auth/register` → 404.
  *Gate:* `uv run pytest tests/auth/test_closed_registration.py`

- [ ] **P2-4** Login rate limit, 5 / 15 min, 429 + `Retry-After`.

- [ ] **P2-5** Security gate suite — secret-leak scan + route census *(Gate 4)*.
  *Accept:* adding an unauthenticated route to the app fails the census test.
  *Gate:* `uv run pytest tests/security/`

- [ ] **P2-6** Mobile auth: `expo-secure-store`, transparent refresh on 401, and
  full offline usability with an expired access token *(R1.10)*.
  *Gate:* `pnpm -C apps/mobile test auth`

- [ ] **P2-7 ⛔ Family, roles and the permission matrix** *(ADR-012, A-28)*
  `family` + `app_user.role`, member endpoints, invite with role, and the matrix
  from `04` §Permissions enforced in the API.
  *Accept:* demoting the last leader → 409 *(FM-1)*; every row of the matrix
  returns its stated status for both roles; a member hitting any leader-only
  endpoint gets 403, including the subtle `PATCH /tasks/{id}` that sets
  `assigned_to` on a task they do not own.
  *Gate:* `uv run pytest tests/security/test_role_matrix.py` *(RB-1, RB-2)*

---

## P3 — Sync core (build before any screen)

- [ ] **P3-1 ⛔** `GET /sync?since=` with tombstones and revision ordering *(SY-2)*.
- [ ] **P3-2 ⛔** WebSocket endpoint + family broadcast with revisions.
- [ ] **P3-3 ⛔** Client outbox on `expo-sqlite`: ordered drain, backoff + jitter,
  restart-durable *(OB-1)*.
  *Accept:* 20 mutations queued offline, app restarted, all applied once, in order.
- [ ] **P3-4 ⛔** Revision cursor + gap detection + reconcile-before-trust *(WS-1)*.
  *Accept:* the client converges after a missed revision with no user action.
- [ ] **P3-5** TanStack Query persisted cache wired to the cursor — cache-first
  render, background revalidate *(R6.1)*.
- [ ] **P3-6** `SyncIndicator` + connection state machine *(R5.5)*.
  Offline must not be styled as an error.
- [ ] **P3-7** Diagnostics screen *(R7.1)*.

---

## P4 — Pets

- [ ] **P4-1** Pets CRUD + archive (never delete) *(R2.2)*.
- [ ] **P4-2** Asset upload endpoint: magic-byte validation, sha256 dedupe, 8 MB cap.
- [ ] **P4-3** Client upload queue, restart-durable, backoff *(AS-1)*.
- [ ] **P4-4** Avatar capture → compress (1024 px, q≈0.8) → queue.
- [ ] **P4-5** Weight entries + the 20%-deviation confirmation *(R2.7)*.
- [ ] **P4-6** Health events + `next_due_at` upcoming logic *(R2.10)*.
- [ ] **P4-7** Pets grid screen — hero **sources**, prefetch on press-in.
- [ ] **P4-8** Pet profile screen — hero **target**, weight chart, timeline.
- [ ] **P4-9** Hand-built measured hero transition *(ADR-011)*.
  *Accept:* 0 dropped frames; reduce-motion falls back to a crossfade *(MO-1)*.
  *Gate:* `maestro test .maestro/06-hero-transition-perf.yaml`
- [ ] **P4-10** SVG weight chart with draw-on and scrub *(A-27)*.

---

## P5 — Tasks

- [ ] **P5-1** Task template CRUD + `task_pets` + `completion_mode` + `assigned_to`
  *(A-19, ADR-012)*. Pet selection is mandatory; a task with zero pets is rejected
  *(R3.1)*. Only a leader may assign to someone else *(R3.1b)*.
- [ ] **P5-1a** `GET /tasks?scope=` — `mine` default for every role; `all` and
  `user` accepted from any role *(OPEN-1 resolved: view filter, not a boundary)*.
- [ ] **P5-2 ⛔** Completion endpoint: `ON CONFLICT DO NOTHING`, **always 200** *(CP-1)*.
  *Accept:* 10 concurrent posts → 1 row, 10 identical 200s, never a 409.
  *Gate:* `uv run pytest tests/sync/test_conflict.py`
- [ ] **P5-3** Undo as a tombstone *(CP-3)*.
- [ ] **P5-4** Dashboard: grouped occurrences, skeletons, no spinner *(R6.1, R6.2)*.
- [ ] **P5-4a** Leader scope filter: `Minhas` (default) · `Todas` · one chip per
  member; invisible to members; persists per device *(R6.8–R6.10)*.
  *Accept:* a leader's cold start lands on `Minhas`, not `Todas`; a member's build
  renders no filter control at all.
  *Gate:* `pnpm -C apps/mobile test ScopeFilter`
- [ ] **P5-5** `TaskCard` with optimistic check, spring + haptic on press-in, and
  the **lost-race attribution crossfade that never un-checks** *(R3.14)*.
  *Gate:* `pnpm -C apps/mobile test TaskCard`
- [ ] **P5-6** Notifications: local reminders + `critical`/`routine` classes,
  exact-alarm permission with an honest fallback message, `POST_NOTIFICATIONS`
  rationale, 7-day reconcile on foreground *(A-09, R3.26)*.
- [ ] **P5-7** Expo Push for cross-user events; never self-notify *(A-08, R3.25)*.
- [ ] **P5-8** Timers as timestamps — worklet ring, one local notification *(TM-1)*.
  *Accept:* still correct after a simulated cold restart.
- [ ] **P5-9** Photo-proof: capture → compress → complete offline → queue *(A-14)*.
  *Accept:* in airplane mode the task completes and shows `pending upload`.
  *Gate:* `maestro test .maestro/03-photo-proof-offline.yaml`
- [ ] **P5-10** All-done Lottie celebration, once per day *(R6.5)*.

---

## P6 — Walks

- [ ] **P6-1 ⛔** Android permission ladder + state machine *(A-06, R4.1–R4.4)*.
  *Accept:* on Android 11+, the background grant deep-links to Settings; the UI
  renders `foreground_only` honestly with a visible warning.
  *Gate:* `pnpm -C apps/mobile test PermissionGate`
- [ ] **P6-2 ⛔** Foreground service with `foregroundServiceType="location"` and
  `FOREGROUND_SERVICE_LOCATION` *(A-06)*.
  *Accept:* starting a walk on an Android 14 device does not throw.
- [ ] **P6-3 ⛔** GPS points persisted to SQLite on arrival *(WK-1)*.
  *Accept:* ≥ 99 of 100 points survive a mid-stream kill.
- [ ] **P6-4** Battery-optimization exemption prompt + OEM deep links *(A-07)*.
- [ ] **P6-5** Orphaned-walk recovery on foreground: resume or finalize *(R4.7)*.
- [ ] **P6-6** Incremental haversine with accuracy filtering *(WK-2)*.
  *Accept:* an injected 500 m-accuracy outlier does not inflate distance.
- [ ] **P6-7** Live walk screen: rolling digits, progressive polyline, fix pulse.
- [ ] **P6-8** MapLibre + OSM tiles, attribution, **no API key** *(A-05)*.
  *Accept:* a grep for `GOOGLE_MAPS_API_KEY` across the repo returns nothing.
- [ ] **P6-9** Douglas–Peucker downsampling + finish endpoint *(WK-3)*.
  *Accept:* a 2 000-point route serializes under 100 KB.
- [ ] **P6-10** Walk history + saved-route summary.

---

## P7 — Polish (a real phase, not leftovers)

- [ ] **P7-1** Motion token pass — every animation uses a named spring from
  `ui/motion/springs.ts`. No inline numbers anywhere.
- [ ] **P7-2** Reduce-motion fallbacks across every hero and spring *(MO-1)*.
- [ ] **P7-3** Skeleton audit — **zero** entry spinners in the app *(R6.1)*.
- [ ] **P7-4** Startup budget: < 1500 ms cold to interactive dashboard *(Gate 7)*.
- [ ] **P7-5** List performance: FlashList, memoized rows, no inline prop closures.
- [ ] **P7-6** Dark mode across every screen.
- [ ] **P7-7** Accessibility: 44 dp targets, WCAG AA, 130% type, screen-reader labels.
- [ ] **P7-8** Empty states + Lottie set (CC0/owned only) *(A-26)*.
- [ ] **P7-9** pt-BR copy pass — the app speaks Portuguese to its two users.

---

## P8 — Deploy and survive

- [ ] **P8-1** VM bootstrap: **2 GB swapfile**, Docker, tuned Postgres *(A-02)*.
  *Accept:* `free -h` shows swap active; stack idles under 1 GB.
- [ ] **P8-2** Cloudflare Tunnel — TLS with **no inbound ports open**.
  *Accept:* `nmap` from outside shows no open port; WSS works end-to-end.
- [ ] **P8-3** Backup: nightly encrypted `pg_dump` + **weekly automated restore
  verification** *(A-16)*.
  *Accept:* the restore job rebuilds a scratch DB and asserts row counts; a
  deliberately corrupted dump makes it fail loudly.
- [ ] **P8-4** `deploy.sh`: pull → migrate → restart → health-check → auto-rollback.
- [ ] **P8-5** Release APK signing; keystore backed up **with** the database.
- [ ] **P8-6** Full E2E suite on both real phones, including the two-device sync
  flow *(Gate 6, flow 02)*.
- [ ] **P8-7** Disaster drill: destroy the VM, rebuild from `infra/` + the latest
  dump, confirm both phones reconcile.
  *Accept:* done in under an hour with zero data loss *(P8)*.

---

## Definition of Done (repeated because it is the whole method)

```
[ ] Acceptance-criteria tests exist and were red before the implementation
[ ] pnpm verify green (PENDING counts as not-green)
[ ] Spec updated if behavior changed (ADR if it deviates)
[ ] Box checked here, with harness output pasted in the commit body
```
