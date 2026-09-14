# 02 — Functional Specification (corrected)

This supersedes §2 and §3 of the original PRD. Every requirement is written so a
test can fail it. `MUST` = gate. `SHOULD` = strong default, deviation needs an ADR.

**Family:** 1 seeded (the model supports more; v1 assumes one).
**Members:** Hudson, Duda — each with a role (`leader` | `member`).
**Pets:** Aurora, Asteria, Aelin, Andrômeda (cats); Katarina (dog).
**Timezone:** `America/Sao_Paulo`. **Locale:** pt-BR. **Platform:** Android only (v1).

---

## 1. Identity & Access

### 1.1 Accounts

- R1.1 The system MUST NOT expose public registration. `POST /auth/register`
  MUST return 404 to unauthenticated callers. *(A-13)*
- R1.2 Initial users MUST be created by a one-time bootstrap script run by the
  operator against the server, never over the public API.
- R1.3 An authenticated member MAY generate a single-use invite code (TTL 24 h)
  to add a family member.
- R1.4 Passwords MUST be hashed with Argon2id. No endpoint may return a hash,
  ever — enforced by a harness test that scans all responses. *(A-12)*
- R1.5 Login MUST be rate-limited to 5 failed attempts per account per 15 min,
  responding 429 with `Retry-After`.

### 1.2 Sessions

- R1.6 Access tokens MUST expire in 15 minutes. Refresh tokens MUST expire in
  30 days and MUST rotate on every use. *(A-11)*
- R1.7 Refresh tokens MUST be stored in `expo-secure-store` (Android
  Keystore-backed). They MUST NOT touch `AsyncStorage` or Zustand's persisted state.
- R1.8 Reuse of an already-rotated refresh token MUST invalidate the entire token
  family and force re-login (theft detection).
- R1.9 Token refresh MUST be transparent: a 401 triggers one refresh attempt and
  one retry of the original request. The user MUST NOT see a login screen while a
  valid refresh token exists.
- R1.10 The app MUST remain fully usable offline with an expired access token.
  Reads come from cache; writes queue. Only the eventual sync requires a fresh token.

### 1.3 Family, roles and membership *(ADR-012)*

The app is organized around a **family** — the tenant that owns pets, tasks and
history. v1 seeds exactly one family; the model supports more, but no code in v1
may assume a user belongs to several.

- R1.11 Every user belongs to exactly one family with a role: `leader` or `member`.
- R1.12 A family MUST always retain at least one `leader`. Removing or demoting
  the last leader MUST fail with 409.
- R1.13 A family MAY have several leaders — co-leaders are the normal case for a
  couple running a family together, and the spec must not force one person to
  own all administration.
- R1.14 Only a leader may: invite or remove members, change roles, assign or
  reassign a task to another member, and edit or delete a task owned by someone else.
- R1.15 A member MAY: create tasks for themselves or unassigned, complete tasks
  in their scope, log weights and health events, and record walks.
- R1.16 Every endpoint MUST enforce the permission matrix in `04` §Permissions.
  Role checks live in the API. A hidden button in the UI is a convenience, never
  a control — this is the project's first real privilege boundary and it must be
  tested as one.

---

## 2. Pets

### 2.1 Profiles

- R2.1 Fields: `name`, `species` (`cat` | `dog`), `breed`, `color`, `birthdate`,
  `sex`, `avatar`, `notes`, `microchip_id`, `archived_at`.
- R2.2 Pets MUST be archived, never hard-deleted. History outlives the pet.
- R2.3 Avatars MUST be compressed on-device before upload (longest edge 1024 px,
  JPEG q≈0.8) and cached with `expo-image` (`memory-disk`) so the dashboard never
  re-downloads them.
- R2.4 A pet's age MUST be derived from `birthdate` in the family timezone,
  never stored.

### 2.2 Weight

- R2.5 Weight entries: `weight_kg` (numeric(5,2)), `measured_at`, optional `note`.
- R2.6 The profile MUST render a weight trend chart (see `06` §Charts). With
  fewer than 2 entries it MUST show an empty state, not a broken axis.
- R2.7 A new entry deviating more than 20% from the previous one MUST prompt a
  confirmation ("2.0 kg → 12.0 kg — is that right?"). Typos in medical data are
  worse than friction.

### 2.3 Health timeline

- R2.8 Event types: `vaccine`, `medication`, `vet_visit`, `symptom`, `procedure`, `other`.
- R2.9 Fields: `title`, `notes`, `occurred_at`, optional `next_due_at`, optional
  attachment (photo of a prescription or exam).
- R2.10 An event with `next_due_at` MUST appear on the dashboard as an upcoming
  item from 7 days before the due date, and MUST schedule a local notification.
- R2.11 The timeline MUST be reverse-chronological, grouped by month, and MUST
  render from cache with no spinner.

---

## 3. Tasks

### 3.1 Templates, pets and assignment *(A-19, ADR-012)*

- R3.1 A task template links to **one or more pets** via `task_pets`. Choosing the
  pets is part of creating a task; a task with zero pets MUST be rejected.
- R3.1a A template carries `assigned_to` — a family member, or `NULL` meaning
  **anyone in the family may do it**.
- R3.1b Only a leader may set `assigned_to` to someone other than themselves, or
  change an existing assignment *(R1.14)*.
- R3.1c Reassigning MUST NOT alter past completions. History records who actually
  did the work, never who was supposed to.
- R3.1d Rotation (alternating days between members) is **out of scope for v1**.
  The model must not preclude it: a future `assignment_rule` replaces the scalar
  `assigned_to` without touching the completion table.
- R3.2 A template MUST declare `completion_mode`:
  - `together` — one completion covers every linked pet (e.g. cleaning the litter box)
  - `per_pet` — one completion per pet; the card shows per-pet checkboxes and
    `2/4` progress (e.g. giving medication to four cats)
- R3.3 Medication-category templates MUST default to `per_pet`.
- R3.4 A template carries: `title`, `description`, `category`
  (`feeding` | `medication` | `hygiene` | `litter` | `play` | `vet` | `other`),
  `recurrence`, `times_of_day[]`, `requires_photo`, `timer_seconds`,
  `reminder_class` (`critical` | `routine`), `active`, `sort_order`.
- R3.5 Editing a template MUST NOT rewrite history. Past completions keep the
  title and configuration they were completed under.

### 3.2 Recurrence and occurrences *(A-03)*

- R3.6 There MUST be no server-side cron. Occurrences are a pure function of
  `(recurrence, times_of_day, timezone, range)`.
- R3.7 Supported recurrence: `daily(interval)`, `weekly(interval, byday[])`,
  `monthly(interval, bymonthday[])`, `once(date)`.
- R3.8 An occurrence is identified by `occurrence_key`, a stable string:
  `YYYY-MM-DD` when `times_of_day` has one entry, `YYYY-MM-DDTHH:mm` when it has
  several. This key is computed identically by client and server and is part of
  the completion's uniqueness constraint.
- R3.9 The client MUST be able to render the next 30 days and the past 90 days of
  occurrences with **zero network calls**.
- R3.10 TypeScript and Python implementations MUST produce byte-identical output
  for every vector in `spec/fixtures/recurrence-vectors.json`. Divergence fails
  `make parity` and blocks the build. *(A-23)*

### 3.3 Completion *(A-04, rescoped by ADR-013)*

Assignment removes the *common* double-completion case: if a task belongs to one
person, two people are not racing for it all day. It does **not** remove the need
for an idempotent write. Four real paths still produce a second write against the
same occurrence:

1. **Retry** — the request succeeded but the response was lost, so the outbox
   retries. Same user, same device. Unavoidable in an offline-first app, and the
   reason the mechanism is not optional.
2. **Override** — someone completes a task assigned to another member because they
   actually did it. Allowed for **any** role *(04 §Permissions †)*: `completed_by`
   records who really did the work, and refusing the write would make the record
   wrong. Expected family behavior, not an exception.
3. **Unassigned tasks** — `assigned_to = NULL` means anyone, so two people can and
   eventually will.
4. **Reassignment race** — a leader reassigns while the previous assignee is
   completing it offline.

The mechanism therefore stays, with a smaller and more honest justification: it
exists to make writes **idempotent**, not because two equal users collide daily.

- R3.11 Completing a task MUST be optimistic: the UI updates and the haptic fires
  on press, before any network call. A failed sync MUST NOT visually un-check the
  task; it surfaces as a queued-mutation indicator.
- R3.12 A completion carries a client-generated `client_mutation_id` (UUIDv4).
  Replaying it MUST be a no-op.
- R3.13 `UNIQUE (task_id, occurrence_key, pet_id)`. On conflict the server MUST
  return **200 with the winning row**, never 409. First write wins, ordered by
  `(completed_at, user_id)`.
- R3.14 When a completion loses a race (paths 2–4 above), the loser's device MUST
  reconcile silently and display who actually did it ("Duda já alimentou às 07:12").
  It MUST NOT show an error and MUST NOT un-check the row — this is an expected
  path, not a failure.
- R3.15 Un-completing MUST write a tombstone (`undone_at`, `undone_by`), never
  delete a row, so the undo replicates to the other phone.
- R3.16 The dashboard MUST show, per completed task, **who** completed it and
  **when**, in family-local time. This is the product's core promise. *(A-04)*

### 3.4 Timers *(A-18)*

- R3.17 A timer MUST be a persisted `ends_at` timestamp, not a running process.
  No background worker, no foreground service, no interval that must survive.
- R3.18 Remaining time MUST be derived from the wall clock on render. The timer
  MUST be correct after an app kill, a reboot, or three days offline.
- R3.19 Starting a timer MUST schedule exactly one local notification for `ends_at`.
  Cancelling MUST cancel it.
- R3.20 The countdown ring MUST animate on the UI thread, driven by a Reanimated
  worklet derived from timestamps — never `setInterval` + `setState`.

### 3.5 Reminders and notifications *(A-08, A-09)*

- R3.21 Two independent channels:
  - **Local notifications** — scheduled reminders. Work fully offline.
  - **Expo Push (free)** — cross-user events (the other person completed a task,
    started a walk, is handling something). Degrades to in-app-only if unavailable.
- R3.22 `reminder_class = critical` (medication) MUST request exact-alarm
  permission. If not granted, the app MUST tell the user plainly that reminders
  may arrive late and offer a Settings deep link. It MUST NOT silently promise
  precision the OS has not granted.
- R3.23 `reminder_class = routine` MUST deliberately use inexact alarms.
- R3.24 `POST_NOTIFICATIONS` (Android 13+) MUST be requested with a rationale
  screen, not cold on first launch.
- R3.25 The app MUST NOT notify a user about an event they themselves caused.
- R3.26 Scheduled local notifications MUST be reconciled on every app foreground
  (schedule the next 7 days, cancel orphans) — Android caps pending alarms.

### 3.6 Photo-proof *(A-14)*

- R3.27 `requires_photo` tasks MUST require a capture before completion.
- R3.28 Flow: capture → compress (longest edge 1600 px, JPEG q≈0.7, target
  < 400 KB) → persist locally → **complete immediately** against a local
  `pending_asset` → enqueue upload.
- R3.29 The task MUST be marked done offline. Completion MUST NOT block on upload.
- R3.30 The UI MUST show an honest per-photo state: `pending upload` / `uploaded` /
  `failed (tap to retry)`.
- R3.31 The upload queue MUST retry with exponential backoff and survive app
  restarts. Assets uploaded but referenced by nothing MUST be swept weekly.

---

## 4. Walks (GPS)

### 4.1 Permission ladder *(A-06)*

- R4.1 The app MUST implement a staged ladder, each stage with its own rationale
  screen, never a cold system dialog:
  1. `ACCESS_FINE_LOCATION` (foreground)
  2. `POST_NOTIFICATIONS` (Android 13+) — required for the foreground service
  3. `ACCESS_BACKGROUND_LOCATION` — on Android 11+ this MUST be requested by
     deep-linking to system Settings, because it cannot be granted in-flow
  4. Battery-optimization exemption (see 4.2)
- R4.2 `FOREGROUND_SERVICE_LOCATION` MUST be declared with
  `foregroundServiceType="location"` (Android 14+), or starting a walk throws.
- R4.3 The app MUST expose an explicit state machine —
  `granted | foreground_only | denied | blocked` — and render it honestly.
  In `foreground_only`, walk tracking MUST be offered with a visible warning that
  it stops when the screen locks. It MUST NEVER appear to work and silently not.
- R4.4 Permission state MUST be re-read on every app foreground; the user can
  revoke it in Settings at any time.

### 4.2 Durability *(A-07)*

- R4.5 Every GPS point MUST be written to local SQLite the instant it arrives,
  before any aggregation. A process kill may cost seconds, never a session.
- R4.6 The app MUST prompt once for a battery-optimization exemption and deep-link
  to the OEM settings page on known-aggressive manufacturers.
- R4.7 On foreground, an `active` walk with no recent points MUST be detected and
  the user offered **resume** or **finalize with what we have**. Data is never
  discarded silently.
- R4.8 Only one walk may be `active` at a time, enforced by a partial unique index.

### 4.3 Tracking and metrics

- R4.9 Sampling: `Accuracy.High`, `distanceInterval: 5 m`, `timeInterval: 3000 ms`.
- R4.10 Points with `accuracy > 30 m` MUST be discarded from distance accumulation
  but retained raw, so a bad fix cannot inflate the distance.
- R4.11 Distance MUST be accumulated incrementally client-side (haversine) as
  points arrive — never recomputed over the full array on every render.
- R4.12 Live metrics: distance (m), elapsed (s), average pace (s/km), current
  speed. Pace MUST show `--` below 0.5 m/s rather than a nonsense number.
- R4.13 Pause/resume MUST be supported; paused time MUST NOT count toward
  elapsed time or pace.
- R4.14 On finish, the walk MUST be written to Katarina's care history with
  distance, duration, pace, route, and a static route preview.
- R4.15 The route MUST be stored as JSONB `[[lat, lon, t, acc], ...]`, downsampled
  (Douglas–Peucker, ~5 m tolerance) before upload. No PostGIS. *(A-17)*
- R4.16 Map rendering MUST use MapLibre + OSM tiles. No API key, no billing
  account. *(A-05)*
- R4.17 The map MUST NOT be on the critical path: if tiles fail to load, metrics,
  tracking and saving all still work.

---

## 5. Sync

- R5.1 Every mutation MUST carry a `client_mutation_id` and be idempotent.
- R5.2 The outbox MUST persist to SQLite, survive restarts, and drain in order
  with exponential backoff + jitter.
- R5.3 The client MUST track `last_revision`. On reconnect or any detected gap it
  MUST call `GET /sync?since=` and reconcile **before** trusting the socket. *(A-10)*
- R5.4 The WebSocket is an optimization. The app MUST be fully correct with the
  socket permanently down (reconciling on foreground and pull-to-refresh).
- R5.5 A connection indicator MUST be visible but non-intrusive:
  `synced` / `syncing (n)` / `offline`. Offline MUST NOT be styled as an error —
  it is a supported mode.
- R5.6 Conflicts MUST be resolved by the rules in §3.3 with no user-facing dialog.

---

## 6. Dashboard (the screen that matters)

- R6.1 "Today" MUST render from cache in under 1500 ms from cold start, with no
  spinner — skeletons only. *(A-22)*
- R6.2 Grouping: **Atrasadas** → **Agora** → **Mais tarde** → **Concluídas** (collapsed).

### 6.1 Scope filter *(ADR-012)*

- R6.7 The dashboard MUST default to the viewer's **own scope**: tasks assigned to
  them, plus unassigned tasks. This is the default **for leaders too** — a leader's
  home screen is their home, not an admin console. Defaulting a leader to "all"
  is the clutter problem this feature exists to solve.
- R6.8 A leader MUST get a scope filter to widen the view:
  `Minhas` (default) · `Todas` · one chip per member. Members MUST NOT see this
  control at all.
- R6.9 The chosen scope MUST persist per device and survive a restart.
- R6.10 While viewing another member's scope, completion controls MUST still work
  (leader override — §3.3 path 2) and each card MUST visibly attribute the task to
  its assignee, so the leader always knows whose task they are touching.
- R6.11 An unassigned task MUST be visually distinct from an assigned one; it is a
  claim, not a duty, and the UI should read that way.
- R6.3 Each card MUST show the pet avatar(s), title, time, and — when done — who
  did it and when.
- R6.4 Completing from the dashboard MUST NOT require opening the task.
- R6.5 An all-done state MUST play a Lottie celebration, once per day, never twice.
- R6.6 Pull-to-refresh MUST trigger reconciliation, never a full refetch.

---

## 7. Diagnostics *(A-24)*

- R7.1 A Diagnostics screen MUST show: socket state, `last_revision`, pending
  mutations, queued uploads, permission states, notification-channel status,
  server health, and app/build version.
- R7.2 It MUST offer "export logs" as a shareable file. When something breaks in
  six months, this screen is the only debugging tool available.

---

## 8. Out of scope for v1

Explicitly excluded, so no one builds them by accident: iOS, multi-family,
social/sharing, vet integrations, food inventory, expense tracking, AI features,
web client, Google Play distribution, wearables.
