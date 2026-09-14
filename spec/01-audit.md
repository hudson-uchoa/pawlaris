# 01 — Audit of the original PRD

Audit date: 2026-09-14. Source: user-supplied PRD "Pawsync" v1.
Every finding is `A-nn | Severity | Title`, with the concrete failure it causes
and the correction. **Fixed in** points at the spec file that now carries the
corrected behavior. Nothing here is style preference — each item is a defect that
would surface as a crash, silent data loss, a cost, or a blocked release.

**Scorecard:** 7 Critical · 9 High · 9 Medium · 2 Low.

The PRD's *product* thinking is sound. Its *platform* thinking (Android 13/14
runtime restrictions), its *sync semantics*, and its *cost claims* are where it
breaks.

---

## What the PRD got right (keep, do not relitigate)

- Expo **with custom dev clients** — correct. Bare RN is unnecessary pain; plain
  Expo Go cannot do background location. The middle path was the right call.
- **Reanimated on the UI thread** as the animation mandate — correct, and the
  single most important frontend decision for the 60fps requirement.
- **Zustand (client state) + TanStack Query (server state)** — correct split.
  Most projects wrongly put server data in Zustand and then hand-roll caching.
- **FastAPI + async SQLAlchemy + Alembic** — correct, and genuinely fast on ARM.
- **Docker Compose, not Kubernetes** — correctly right-sized.
- **TypeScript strict** — correct.
- **Offline-first as a requirement** — correct instinct, but see A-03/A-04: it
  was stated, not designed.

---

## CRITICAL

### A-01 | Critical | "Always Free" OCI is not a guarantee, and the PRD makes it load-bearing

**Failure:** Ampere A1 capacity is chronically exhausted ("Out of host capacity")
for free-tier accounts in most regions, and Oracle reclaims Always Free compute
that sits idle. The PRD hard-couples the product to one provider (OCI Object
Storage SDK, OCI-shaped provisioning). If the tenancy is reclaimed or the shape
is unavailable, the app is dead, not degraded.

**Correction:** OCI becomes *a* deployment target, never *the* architecture. The
stack is plain Docker Compose plus a storage **adapter interface**. Blob storage
defaults to a **local volume served by Caddy** — zero external dependency, zero
SDK. S3-compatible remote storage is an optional adapter behind the same
interface. Document a "move to any other box in 20 minutes" restore path.

**Fixed in:** `00-constitution.md` P1/P8 · `05-architecture.md` ADR-001, ADR-006

### A-02 | Critical | The real instance is 1 OCPU / 2 GB, not 4 OCPU / 24 GB

**Failure:** The PRD sizes the design for 24 GB. On 2 GB, three things break:
(1) `docker build` of the Python image on the VM will thrash and OOM-kill;
(2) a multi-worker Uvicorn config wastes the single core and multiplies memory;
(3) default PostgreSQL settings assume far more RAM than exists, and OCI micro
instances ship **with no swap**, so the first spike hard-kills a process.

**Correction:** an explicit memory budget, enforced by container limits.

| Process       | Limit  | Notes                                                                                      |
|---------------|--------|--------------------------------------------------------------------------------------------|
| PostgreSQL    | 512 MB | `shared_buffers=128MB`, `max_connections=20`, `work_mem=4MB`, `effective_cache_size=512MB`  |
| FastAPI       | 384 MB | **1** Uvicorn worker, async — ample for 2 users                                              |
| Caddy         | 64 MB  | reverse proxy + static blobs + auto-TLS                                                      |
| OS + headroom | ~1 GB  | includes page cache                                                                          |

Plus: a **2 GB swapfile is mandatory** (provisioned before first deploy), and
**images are never built on the VM** — GitHub Actions builds and pushes to GHCR,
the VM only runs `docker compose pull && up -d`. The nightly `pg_dump` is
scheduled off-peak because it competes for the single core.

**Fixed in:** `05-architecture.md` §Infrastructure, ADR-002 · `08-tasks.md` P0-4, P8-1

### A-03 | Critical | Backend CRON materializing recurring tasks is incompatible with offline-first

**Failure:** The PRD drives recurrence from server-side CRON jobs, so the list of
*what to do today* is generated server-side. If the phone is offline at midnight,
or the free-tier box is down, rebooting, or reclaimed, **today's tasks simply do
not exist on the phone**. For scheduled medication that is not a sync bug, it is
a missed dose. It also makes offline-first unimplementable: the client cannot
invent occurrences it was never sent.

**Correction:** delete CRON entirely. Store a **recurrence rule**; compute
occurrences as a **pure function** `occurrences(rule, tz, range) -> OccurrenceKey[]`,
implemented identically in TypeScript and Python and proven equal by shared
golden vectors. The server persists only **completions** (deltas). The phone can
always render the next 30 days with zero network. This removes a whole service, a
whole failure mode, and the cron container's memory (see A-02).

**Fixed in:** `03-data-model.md` §4 · `07-test-harness.md` §Parity gate · ADR-003

### A-04 | Critical | Conflict resolution is undefined — the app's core scenario is unspecified

**Failure:** The PRD's stated purpose is "prevent double-feeding". Yet it never
says what happens when both phones are offline and both mark *Aurora — morning
feeding* done. Three wrong behaviors are equally reachable from the PRD as
written: duplicate rows; a 409 the client treats as failure and retries forever;
or last-write-wins that erases who actually fed the cat.

**Correction:** completions are **idempotent events** with a natural key
`UNIQUE (task_id, occurrence_key, pet_id)` and a client-generated
`client_mutation_id`. The server does `INSERT ... ON CONFLICT DO NOTHING` and
returns **200 with the winning row** — never 409. First write wins,
deterministically ordered by `(completed_at, user_id)`. Un-completing writes a
**tombstone** (`undone_at`), never a hard delete, so the undo replicates.
Retrying the same mutation id is a no-op by construction.

**Fixed in:** `03-data-model.md` §5 · `04-api-contract.md` §Completions · ADR-004

### A-05 | Critical | `react-native-maps` requires a Google Cloud billing account — violates the zero-cost premise

**Failure:** On Android, `react-native-maps` defaults to the Google Maps SDK,
which needs an API key from a GCP project **with billing enabled** — a credit
card on file, sitting in the middle of a product whose premise is "no
investment". Map rendering may not be *charged*, but the requirement contradicts
P1, and a misconfigured key silently renders a blank grey map with no error.

**Correction:** `@maplibre/maplibre-react-native` with OpenStreetMap-based raster
tiles and proper attribution. No key, no account, no card. Route polylines and
all metrics are computed client-side and stored as JSON, so the map is a *view*,
not a data dependency — the tile source is swappable in one adapter.

**Fixed in:** `05-architecture.md` ADR-005 · `02-spec.md` §2.4

### A-06 | Critical | Background location will not work as described on modern Android

**Failure:** The PRD says "native background location permissions" as if it were
a single grant. It is not, and each gap silently yields *no location updates*:

- Android 11+ **cannot** request `ACCESS_BACKGROUND_LOCATION` in the same flow as
  foreground location. "Allow all the time" is reachable only by sending the user
  into system Settings. An app that asks once and assumes success tracks nothing.
- Android 14+ requires the **typed** `FOREGROUND_SERVICE_LOCATION` permission and
  a declared `foregroundServiceType="location"`. Missing it throws at service
  start — a crash the moment the user taps "Start walk".
- Android 13+ requires runtime `POST_NOTIFICATIONS`; a foreground service whose
  notification cannot be posted is unreliable.

**Correction:** a specified, testable **permission ladder** with an in-app
rationale screen, a deep link to Settings for the background grant, and an
explicit `permissionState` machine the UI renders honestly
(`granted | foreground_only | denied | blocked`). Walk tracking is *disabled with
an explanation*, never silently broken.

**Fixed in:** `02-spec.md` §2.4.1 · `08-tasks.md` P6-1

### A-07 | Critical | OEM battery managers kill foreground services — "use a foreground service" is not enough

**Failure:** The PRD treats an Android Foreground Service as sufficient against
system kills. On MIUI/Xiaomi, Samsung, Oppo, Vivo and Huawei, proprietary battery
managers kill foreground services anyway, especially during a 40-minute walk with
the screen off. The user loses the whole walk, with no error.

**Correction:** durability, not prevention. (1) Prompt once for a
battery-optimization exemption and deep-link to the OEM settings page.
(2) **Persist every GPS point to local SQLite the instant it arrives**, so a kill
costs the last few seconds, not the session. (3) On app resume, detect an
orphaned `active` walk and offer to resume or finalize it.

**Fixed in:** `02-spec.md` §2.4.2 · `03-data-model.md` §7

---

## HIGH

### A-08 | High | "Local notifications to avoid paid push services" rests on a false premise — and cannot do the job

**Failure:** Two errors in one sentence. (1) **Expo Push and FCM are already
free** — there is no paid service being avoided, so the constraint is imaginary.
(2) More seriously, local notifications are scheduled *on the device that
schedules them*. They structurally cannot tell Duda that Hudson just gave the
medication. The PRD's headline feature — preventing double-dosing — is therefore
unimplementable with the notification strategy the PRD chose.

**Correction:** two channels, two jobs.

- **Local notifications** for *scheduled reminders* — works offline, no server.
- **Expo Push (free)** for *cross-user events*: task completed by the other
  person, walk started/ended, "someone is already handling it". Degrades to
  in-app-only if push is unavailable — the app stays correct, just less timely.

**Fixed in:** `02-spec.md` §2.3.3 · ADR-007

### A-09 | High | Exact-time reminders will silently drift on Android 12+

**Failure:** Medication implies exact timing. Android 12+ restricts
`SCHEDULE_EXACT_ALARM`; 13/14 restrict it further and revoke it for most apps.
Inexact alarms can fire **tens of minutes late** under Doze. The PRD promises
medication reminders and specifies nothing about this, so the implementation will
look correct in testing (screen on) and drift in real use.

**Correction:** classify reminders. `critical` (medication) requests
`USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` and, if not granted, **tells the user
plainly** that reminders may be late and offers the Settings deep link.
`routine` (feeding, litter) uses inexact alarms deliberately. Never promise
precision the OS has not granted.

**Fixed in:** `02-spec.md` §2.3.3 · `08-tasks.md` P5-6

### A-10 | High | WebSocket reconnect and backfill are unspecified

**Failure:** The PRD specifies a WebSocket but not what happens when it drops —
which on mobile is constantly (tunnel, elevator, screen off, backgrounding,
free-tier restart). With no gap-recovery rule the client silently misses every
event that occurred while disconnected and shows a confidently stale dashboard.
That is worse than no real-time at all, because the user *trusts* it.

**Correction:** a family-scoped monotonic `revision` sequence. Every broadcast
carries its revision. The client tracks the last applied revision; on any gap or
reconnect it calls `GET /sync?since=<revision>` and reconciles before trusting
the socket again. The WebSocket is an **optimization over polling, never the
source of truth**. Heartbeat every 30 s; exponential reconnect backoff with jitter.

**Fixed in:** `04-api-contract.md` §Realtime · ADR-008

### A-11 | High | The JWT strategy has no refresh token

**Failure:** "Stateless PyJWT tokens" with no refresh story forces a choice
between a short expiry (the user re-logs in constantly — unusable) and a
long-lived token (a stolen token is valid for months and unrevocable by
definition).

**Correction:** short-lived access token (15 min) plus a rotating refresh token
(30 days) in `expo-secure-store` (Android Keystore-backed), with server-side
refresh records so logout and revocation actually work. Reuse of a rotated
refresh token invalidates the whole family (theft detection).

**Fixed in:** `04-api-contract.md` §Auth · `03-data-model.md` §2

### A-12 | High | Password hashing is never specified

**Failure:** The PRD names PyJWT but says nothing about how passwords are stored.
This is exactly the gap that yields SHA-256, or worse.

**Correction:** **Argon2id** via `argon2-cffi`, with parameters tuned to the
1 OCPU / 2 GB box — the library default memory cost is too aggressive here;
target `m=19456, t=2, p=1` (~200–300 ms). Rate-limit login to 5 attempts per
15 min per account. A gate test asserts no endpoint ever returns a password hash.

**Fixed in:** `05-architecture.md` §Security · `07-test-harness.md` §Security gate

### A-13 | High | Open registration on a public box

**Failure:** `POST /register` exposed on a public free-tier VM is a spam and abuse
surface for an app that will only ever hold two accounts.

**Correction:** no public registration. Two users seeded by a one-time bootstrap
script; any further account requires a single-use invite code generated by an
existing member. A gate test asserts unauthenticated `POST /auth/register`
returns 404.

**Fixed in:** `00-constitution.md` P10 · `04-api-contract.md` §Auth

### A-14 | High | Photo-proof has no offline path

**Failure:** The PRD requires photo-proof for completion in an offline-first app
but never reconciles the two. As written, completing a photo-proof task offline is
undefined: either completion blocks on the upload (breaking offline-first for the
one feature that most needs proof), or the photo is lost.

**Correction:** capture → compress → persist to app storage → enqueue upload →
**complete the task immediately** against a local `pending_asset` reference. The
upload queue drains on reconnect and rewrites the reference to the server asset
id. The UI shows an honest "photo pending upload" state. Compression targets are
specified, not left to taste: longest edge 1600 px, JPEG q≈0.7, target < 400 KB.
Orphaned assets (uploaded, never referenced) are swept weekly.

**Fixed in:** `02-spec.md` §2.3.4 · `03-data-model.md` §8

### A-15 | High | "Unit and automated tests" is asserted, never defined — yet it is the SDD gate

**Failure:** The PRD demands tested integrity front and back but names no
framework, no coverage bar, no E2E tool, no CI, and no definition of done. Under
SDD this is not a documentation gap, it is a **missing harness**: with no
executable gate, "done" becomes a matter of opinion and the method collapses.

**Correction:** the harness is specified as runnable commands with thresholds —
Jest + React Native Testing Library, MSW, Maestro (E2E on a real Android device),
pytest + pytest-asyncio + httpx + a disposable Postgres, Ruff, `mypy --strict`,
`tsc --noEmit`, coverage floors, an OpenAPI drift gate, and a TS↔Python
recurrence parity gate. `pnpm verify` is the single command that decides done.

**Fixed in:** `07-test-harness.md` (entire file)

### A-16 | High | No backup or restore strategy

**Failure:** The family's entire medical history lives on one free-tier VM the
provider may reclaim (A-01), with no redundancy. The PRD does not mention backup
once. The first incident is total data loss.

**Correction:** nightly `pg_dump` piped through `age` encryption to a second
location, 14-day retention, **plus a weekly automated restore-verification job**
that restores the dump into a scratch database and asserts row counts. An
unverified backup is not a backup.

**Fixed in:** `05-architecture.md` §Backup · `08-tasks.md` P8-3

---

## MEDIUM

### A-17 | Medium | PostGIS is proposed for data that is never geospatially queried

**Failure:** The PRD suggests PostGIS "if necessary". Nothing in the feature set
performs a spatial query — routes are drawn, not searched. PostGIS roughly
doubles image size, complicates ARM builds, and costs memory the 2 GB box does
not have (A-02).

**Correction:** plain PostgreSQL. Store the route as `JSONB` (array of
`[lat, lon, t, acc]`). Distance and pace are computed **client-side** during the
walk (haversine with accuracy filtering) and stored as scalars. Revisit only if a
real spatial query ever appears.

**Fixed in:** `03-data-model.md` §7 · ADR-009

### A-18 | Medium | Timers are specified as "background workers" — they need no background execution at all

**Failure:** The PRD routes task countdowns through background workers,
inheriting Doze, service limits and OEM kills (A-07) for no benefit whatsoever.

**Correction:** a countdown is a **timestamp**, not a process. Persist `ends_at`,
schedule one local notification for that instant, and derive remaining time from
the wall clock on each render. The timer is then correct after a reboot, an app
kill, or three days offline — and consumes nothing. This deletes an entire class
of bugs the PRD was about to create.

**Fixed in:** `02-spec.md` §2.3.2 · ADR-010

### A-19 | Medium | Multi-pet tasks are unmodeled — and this house has four cats

**Failure:** "Feed the cats" is ambiguous in the PRD's model. One task completed
once, or four tasks? It matters concretely: if Aurora ate and Asteria did not, a
single boolean cannot express that, and the app's whole reason for existing —
knowing who got fed — fails.

**Correction:** a task template links to **N pets** (`task_pets`) and carries a
`completion_mode`: `together` (one completion covers all linked pets) or
`per_pet` (one completion row per pet; the card shows four checkboxes and 2/4
progress). Medication defaults to `per_pet`; litter-box cleaning defaults to
`together`.

**Fixed in:** `03-data-model.md` §3 · `02-spec.md` §2.3.1

### A-20 | Medium | EAS Build free tier is a queue and a monthly cap — the PRD assumes builds are free and instant

**Failure:** Background location requires a custom dev client, which requires a
native build. The free EAS tier is capped monthly and Android builds queue behind
paid users. Mid-project this becomes a blocker at the worst possible moment.

**Correction:** **local builds are the default path** (`npx expo run:android` /
`eas build --local`) on the Windows dev machine with Android Studio + JDK 17. EAS
cloud builds are an occasional convenience, never a dependency. Distribution is a
**sideloaded APK to two phones** — not Google Play, which also sidesteps the Play
Console fee and the background-location policy review entirely.

**Fixed in:** `05-architecture.md` §Build & Distribution · `08-tasks.md` P0-3

### A-21 | Medium | Reanimated's shared-element API is not a stable foundation for the hero transition

**Failure:** The PRD names "Reanimated v3 shared element transitions" for the
signature pet-profile animation. That API has been experimental and has churned
across releases, with known trouble in nested navigators. Building the product's
most visible animation on it risks a rewrite at the next upgrade.

**Correction:** implement the hero as a **measured transition we control** —
`measure()` the source card on press, render an absolutely-positioned overlay,
drive it with a Reanimated worklet spring to the target frame, hand off to the
real screen. More code, fully deterministic, upgrade-proof, and testable. Pin
Reanimated to the latest stable with the New Architecture enabled.

**Fixed in:** `06-ux-motion-spec.md` §Hero · ADR-011

### A-22 | Medium | "Not one second of waiting" is a feeling, not a specification

**Failure:** Unmeasurable requirements cannot gate a build. "Fast" gets declared
done by whoever is tired.

**Correction:** numeric budgets the harness measures — cold start to interactive
dashboard < 1500 ms; screen-transition first frame < 16 ms; tap to visual
feedback < 100 ms; **zero** dropped frames during a hero transition; navigation
**never** awaits the network (cache-first render, background revalidate); a
spinner on screen entry is a defect (skeletons only).

**Fixed in:** `06-ux-motion-spec.md` §Budgets · `07-test-harness.md` §Perf gate

### A-23 | Medium | Timezone handling is unspecified, and the whole app is date-keyed

**Failure:** Every occurrence key is a *local* date. With naive datetimes, "did we
feed them today?" breaks around midnight and on any device in another timezone.
Brazil currently has no DST, which makes this *look* fine in testing and leaves a
latent bug if that changes or if either phone travels.

**Correction:** `timestamptz` everywhere in storage, UTC on the wire, family
timezone (`America/Sao_Paulo`) as an explicit setting used for every occurrence
computation on both client and server. A frozen-clock suite covers midnight
boundaries and a DST-observing timezone to prove the logic is not
accidentally-correct.

**Fixed in:** `00-constitution.md` P5 · `07-test-harness.md` §Parity gate

### A-24 | Medium | No observability — debugging will be blind

**Failure:** A remote box with no health endpoint, no structured logs and no
crash reporting makes every "it didn't sync" unfalsifiable.

**Correction:** `GET /health` (db + disk + revision), structured JSON logs with
request ids, capped log rotation (the 2 GB box has limited disk headroom too),
and an in-app **Diagnostics screen** showing socket state, last sync revision,
pending mutation count and queued uploads. Self-hosted, zero cost, no SaaS.

**Fixed in:** `05-architecture.md` §Observability

### A-25 | Medium | No accessibility or reduce-motion handling in a motion-heavy app

**Failure:** The PRD is built on springs, heroes and confetti with no fallback.
Reduce Motion is a real user setting; ignoring it is both an accessibility
failure and a nausea trigger.

**Correction:** every hero and spring gets a crossfade fallback gated on
`AccessibilityInfo.isReduceMotionEnabled`; 44×44 dp minimum touch targets; WCAG AA
contrast; dynamic type to 130% without clipping.

**Fixed in:** `00-constitution.md` P9 · `06-ux-motion-spec.md` §Reduce Motion

---

## LOW

### A-26 | Low | The derivative-work boundary is not stated

The app reimplements GoPuppy's *functionality* for private family use, which is
fine — features and ideas are not protected. What is protected: its code, icons,
illustrations, Lottie files, copy, and name. The spec states the boundary
explicitly so no asset is ever pasted in "temporarily". Distribution stays private
(sideloaded APK, two devices), which keeps this uncomplicated.

**Fixed in:** `CLAUDE.md` §Hard rules

### A-27 | Low | Weight charts named with no rendering strategy

Charting libraries are a common source of jank and bundle bloat. Weight history
for five pets is at most a few hundred points: hand-roll an SVG line chart with
`react-native-svg` (already present as a Lottie/MapLibre dependency) rather than
adding a charting framework.

**Fixed in:** `06-ux-motion-spec.md` §Charts

---

## Amendments

### 2026-09-14 — Family system added; A-04 rescoped *(ADR-012, ADR-013)*

The user added a requirement after this audit was written: a GoPuppy-style family
system with a leader who assigns tasks, per-user task scoping, and a leader-only
filter to see everyone's.

**A-04 is rescoped, not withdrawn.** The user's objection — that with per-user
assignment two people are no longer racing for the same task — is correct about
the *common* case, and the audit's framing of it as "the app's core scenario" no
longer holds. The mechanism stays, for a narrower and more honest reason: four
paths still write twice against one occurrence (outbox retry after a lost
response, leader override, unassigned tasks, reassignment race), and the first of
those is unavoidable in any offline-first app. Dropping the natural key would
convert a normal retry into duplicate completion rows.

**New finding this introduces:**

### A-28 | High | Roles create a privilege boundary the original design never had
**Failure:** every prior requirement assumed one trusted family where all
authenticated users could do everything. With `leader` / `member`, a member must
not reassign tasks, archive pets, manage members, or widen their task scope. An
authorization bug now has a real victim, and the existing route census only
checked *authentication*.
**Correction:** an explicit permission matrix in `04` §Permissions, enforced in
the API, with two new gates — `RB-1` walks every row of the matrix for both roles,
and `RB-2` attempts privilege escalation on every leader-only endpoint. The route
census is extended from "is it authenticated" to "is it authorized".
**Fixed in:** `02-spec.md` §1.3 · `04-api-contract.md` §Permissions ·
`07-test-harness.md` Gate 4 · `08-tasks.md` P2-7

**`OPEN-1` resolved (2026-09-14):** task scoping is a **view filter, not an access
boundary**. Reads are family-wide; roles govern writes only. This keeps the pet's
care history visible to everyone — the cross-check that lets Duda confirm Aurora
got her medication even when the task is Hudson's — and avoids declaring a
boundary the code would not actually enforce. A-28's scope narrows accordingly:
the privilege boundary is real, but it covers mutations, not reads.

---

## Net effect of the audit

**Removed** from the architecture: the CRON service, PostGIS, OCI SDK coupling,
Google Maps / GCP billing, background timer workers, EAS Build as a dependency,
and public registration. Seven fewer moving parts — all of them on a box with one
core and two gigabytes.

**Added:** a deterministic recurrence engine with cross-language parity tests, an
idempotent completion model with tombstones, a revision-based sync cursor with gap
recovery, an Android permission-state machine, an offline upload queue, a
refresh-token flow, a verified backup, and an executable harness.

The product described in the PRD is unchanged. What changed is that it can now be
built, on the hardware that actually exists, for zero cost, and be proven correct.
