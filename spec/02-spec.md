# 02 — Functional Specification

What the app does, as requirements a test can fail. `MUST` = gate.
`SHOULD` = strong default; deviating needs an ADR from the orchestrator.

How each screen looks and behaves is in `09-screens.md`. How data is stored is
in `03-data-model.md`. How it moves is in `04-api-contract.md` and
`10-client-sync.md`.

**Family:** one, seeded. **Members:** Hudson, Duda — each `leader` or `member`.
**Pets:** Aurora, Asteria, Aelin, Andrômeda (cats); Katarina (dog).
**Timezone:** `America/Sao_Paulo`. **UI language:** pt-BR. **Platform:** Android.

Vocabulary used everywhere:

| Term | Meaning |
|---|---|
| *template* | a task definition with a recurrence rule (`task_template`) |
| *occurrence* | one scheduled instance of a template, identified by `occurrence_key` |
| *completion* | the record that someone did an occurrence (for one pet, or for all) |
| *live completion* | a completion whose `undone_at` is null |
| *today* | the current calendar date **in the family timezone** |
| *replica* | the phone's local copy of all family data (SQLite + memory) |
| *outbox* | the phone's queue of mutations not yet acknowledged by the server |

---

## 1. Identity & access

### 1.1 Accounts

- **R1.1** There is no public registration. No `/auth/register` route exists;
  requesting it returns 404.
- **R1.2** The first family and its users are created by a bootstrap CLI run by
  the operator on the server. Never over the public API.
- **R1.3** Only a **leader** may create an invite. An invite is single-use,
  expires after 24 h, and carries the role the new member will get.
- **R1.4** Passwords are hashed with Argon2id (`m=19456, t=2, p=1`). No response
  body may contain a hash, ever *(ID-1)*.
- **R1.5** Login is rate-limited: after 5 failed attempts for the same email
  within 15 minutes, further attempts return 429 with `Retry-After`. An unknown
  email and a wrong password are indistinguishable to the caller.

### 1.2 Sessions

- **R1.6** Access tokens expire after 15 minutes. Refresh tokens expire after
  30 days and rotate on every use.
- **R1.7** The refresh token is stored only in `expo-secure-store`. It never
  touches SQLite, AsyncStorage, logs, or the Diagnostics export.
- **R1.8** Presenting an already-rotated refresh token issues a fresh token in
  the same chain **as long as no token issued from it has itself been used** — a
  response lost on a bad network is not theft, however long ago it was. If one
  has been used, two parties hold the chain: the whole chain is revoked and the
  caller gets 401.
- **R1.9** Refresh is transparent and **single-flight**: any number of requests
  hitting 401 at once trigger exactly one refresh, then each retries once. The
  user never sees a login screen while a valid refresh token exists.
- **R1.10** The app is fully usable offline with an expired access token. Reads
  come from the replica; writes go to the outbox.
- **R1.11** If the session can no longer be refreshed, the app shows the login
  screen and **keeps the outbox**, across restarts. After the same user logs in
  again, the outbox drains. Logging out voluntarily — or logging in as a
  different user — with a non-empty outbox requires confirming that N unsynced
  changes will be discarded.
- **R1.12** A user can change their password by providing the current one. Doing
  so signs that user out on every other device; the device that made the change
  stays signed in.

### 1.3 Family and roles

- **R1.13** Every user belongs to exactly one family, with role `leader` or `member`.
- **R1.14** A family always has at least one enabled leader. Demoting or removing
  the last one fails with 409 *(FM-1)*.
- **R1.15** Several leaders are allowed and are the expected setup for a couple.
- **R1.16** Only a leader may: invite or remove members, change roles, edit the
  family name or timezone, archive or unarchive a pet, assign a task to someone
  else, and edit, end or delete a task created by someone else.
- **R1.17** Any member may: create and edit pets, log weights and health events,
  create tasks assigned to themselves or to nobody, edit/end/delete tasks they
  created, complete or undo **any** occurrence, start timers, and record walks.
- **R1.18** Permissions are enforced by the API, per the matrix in
  `04-api-contract.md` §Permissions. A hidden button is a convenience, never a
  control *(RB-1, RB-2)*.
- **R1.19** Reads are family-wide. Every member can see every task, completion,
  pet and walk of the family. Roles restrict writes only.
- **R1.20** Removing a member disables the account, revokes their sessions, and
  sets every task assigned to them to unassigned. Their past completions keep
  their name.

---

## 2. Pets

### 2.1 Profiles

- **R2.1** Fields: `name` (required), `species` (`cat` | `dog`, required),
  `sex` (`female` | `male` | `unknown`), `breed`, `color`, `birthdate`,
  `microchip_id`, `notes`, avatar photo, `sort_order`.
- **R2.2** Pets are archived, never deleted. An archived pet disappears from the
  pets grid and from task occurrences, and its history stays readable. A leader
  can unarchive.
- **R2.3** Avatars are compressed on the device before upload (longest edge
  1024 px, JPEG quality 0.8) and rendered from a local file, so the grid never
  waits on the network.
- **R2.4** Age is derived from `birthdate` and *today*; never stored. Format:
  `3 anos`, `1 ano e 4 meses`, `5 meses`, `12 dias`.

### 2.2 Weight

- **R2.5** A weight entry has `weight_kg` (0.01–119.99, two decimals),
  `measured_at`, optional `note`.
- **R2.6** The profile shows a weight trend chart. With fewer than 2 entries it
  shows an empty state, not a broken axis.
- **R2.7** A new entry more than 20% above or below the most recent one asks for
  confirmation, naming both values ("2,00 kg → 12,00 kg — está certo?").
- **R2.8** A weight entry can be deleted (soft). It cannot be edited; delete and
  re-add.

### 2.3 Health timeline

- **R2.9** Event types: `vaccine`, `medication`, `vet_visit`, `symptom`,
  `procedure`, `other`.
- **R2.10** Fields: `title` (required), `notes`, `occurred_at`, optional
  `next_due_on` (a date), optional photo attachment.
- **R2.11** An event with `next_due_on` appears in the dashboard's
  **Próximos cuidados** section from 7 days before the due date until the event
  is edited or deleted, and schedules one local notification for 09:00 family
  time on the due date.
- **R2.12** The timeline is reverse-chronological, grouped by month, rendered
  from the replica with no spinner.

---

## 3. Tasks

### 3.1 Templates

- **R3.1** A template applies to **one or more pets**. Creating one with zero
  pets is rejected.
- **R3.2** A template has `assigned_to`: a family member, or nobody. Nobody means
  anyone in the family may do it.
- **R3.3** A member may set `assigned_to` only to themselves or nobody, and only
  on templates they created. A leader may set it to anyone on any template.
- **R3.4** A template has a `completion_mode`:
  - `together` — one completion covers every linked pet (cleaning the litter box)
  - `per_pet` — one completion per pet (medication for four cats); the card shows
    one toggle per pet and `2/4` progress
- **R3.5** Choosing category `medication` in the form presets
  `completion_mode = per_pet` and `reminder_class = critical`. The user may
  change both before saving.
- **R3.6** Template fields:

  | Class | Fields |
  |---|---|
  | **schedule** (immutable after creation) | `recurrence`, `times_of_day`, `starts_on`, `pet_ids`, `completion_mode` |
  | **cosmetic** (editable in place) | `title`, `description`, `category`, `assigned_to`, `requires_photo`, `timer_seconds`, `reminder_class`, `sort_order` |
  | **lifecycle** | `ends_on`, `deleted_at` |

  Categories: `feeding`, `medication`, `hygiene`, `litter`, `play`, `vet`, `other`.
- **R3.7** Editing only cosmetic fields updates the template in place.
- **R3.8** Editing any schedule field **forks** the template: the old one gets
  `ends_on = E − 1 day`, and a new template is created with `starts_on = E` and
  `replaces_task_id` pointing at the old one. `E` is *today* when the old
  template has no live completion for any of today's occurrences in the replica;
  otherwise `E` is tomorrow. `E` is never earlier than the old template's own
  `starts_on`, so editing a task that has not started yet does not start it
  early. The form says which: "Vale a partir de hoje" or
  "Vale a partir de amanhã". Past occurrences and their completions are never
  rewritten *(ADR-016)*.
- **R3.9** **Encerrar** a template sets `ends_on = E − 1 day` with the same `E`.
  An ended template produces no further occurrences and moves to the
  "Encerradas" list.
- **R3.10** **Excluir** soft-deletes a template. The UI offers it only for a
  template with no completions in the replica; otherwise it offers Encerrar.
- **R3.11** Each completion stores the template's title at the moment of
  completion (`title_snapshot`). History shows that title, so renaming a task
  never rewrites the past.

### 3.2 Recurrence and occurrences

- **R3.12** There is no server-side scheduling. Occurrences are a pure function
  of `(recurrence, times_of_day, starts_on, ends_on, from, to)`, computed on the
  phone. The server stores the rule and never evaluates it *(ADR-015)*.
- **R3.13** Supported rules:
  - `daily` every `interval` days, counted from `starts_on`
  - `weekly` every `interval` weeks on `byday` (weeks start on Monday; the week
    containing `starts_on` is week 0)
  - `monthly` every `interval` months on `bymonthday` (a day that does not exist
    in a month is skipped, never clamped)
  - `once` on a single date
- **R3.14** `occurrence_key` is `YYYY-MM-DD` when `times_of_day` is empty (an
  all-day task) and `YYYY-MM-DDTHH:mm` when it has one or more entries. The date
  part is a family-local calendar date.
- **R3.15** The phone renders any day from 90 days back to 30 days ahead with
  zero network calls.
- **R3.16** The engine must reproduce every vector in
  `spec/fixtures/recurrence-vectors.json` and `spec/fixtures/time-vectors.json`
  exactly *(RC-1, TZ-1)*.
- **R3.17** The Diagnostics screen has an **Autoteste** action that runs the same
  vectors on the device and reports pass/fail, because the engine that matters
  runs on Hermes, not on Node *(RC-3)*.

### 3.3 Completion

- **R3.18** Completing is optimistic and local: a tap updates the replica, writes
  the outbox, updates the UI and fires the haptic before any network call. Press-in
  gives visual feedback only; the completion is committed on **release**, so a
  scroll that starts on a checkbox never completes a task.
- **R3.19** Every mutation carries a client-generated id and is idempotent.
  Retrying it never double-applies *(CP-2)*.
- **R3.20** At most one live completion exists per
  `(task, occurrence_key, pet)`. When two arrive, the **first to reach the
  server** wins. The other request still gets `200` with the winning row — never
  409 *(CP-1)*.
- **R3.21** A device that lost keeps the row checked, swaps the attribution to
  the winner, and shows one toast: "Duda já tinha feito às 07:12". It never
  shows an error and never un-checks.
- **R3.22** Undoing writes a tombstone (`undone_at`, `undone_by`) and never
  deletes. Any family member may undo any completion. The UI asks for
  confirmation first, naming who did it and when.
- **R3.23** After an undo, the occurrence can be completed again; that creates a
  new completion row *(CP-4)*.
- **R3.24** A completed occurrence shows **who** did it and **when**, in family
  time. This is the product's core promise.
- **R3.25** A `per_pet` completion names a pet that belongs to the template; a
  `together` completion names none. The server rejects anything else with 422.
- **R3.26** Occurrences of past days (down to 90 days back) can be completed and
  undone. Future days are read-only.

### 3.4 Timers

- **R3.27** A timer is a persisted `ends_at`, not a running process. No background
  worker, no foreground service, no interval that must survive *(TM-1)*.
- **R3.28** Remaining time is derived from the wall clock at render. It is correct
  after an app kill, a reboot, or three days offline.
- **R3.29** Starting a timer schedules exactly one local notification at `ends_at`
  on the device that started it. Cancelling the timer cancels the notification.
- **R3.30** A running timer is visible on the other phone as a countdown, without
  a notification there.
- **R3.31** The countdown ring animates on the UI thread *(P6)*.

### 3.5 Reminders (local notifications)

- **R3.32** Reminders are local notifications, so they work with no network. Each
  phone schedules reminders only for occurrences that have a time of day and
  whose template is assigned to that phone's user or to nobody.
- **R3.33** The phone keeps reminders scheduled for the next 7 days and
  reconciles them (schedule missing, cancel stale, reschedule changed) on every
  app foreground and after every change to templates or completions.
- **R3.34** A completed occurrence has no pending reminder on a phone that knows
  about the completion. For `per_pet`, the reminder stays until every pet is done.
- **R3.35** `reminder_class` picks the Android notification channel: `critical`
  → high-importance channel with sound; `routine` → default importance.
- **R3.36** Reminders use exact alarms. The manifest declares `USE_EXACT_ALARM`
  (and `SCHEDULE_EXACT_ALARM` for Android 12) *(ADR-027)*.
- **R3.37** `POST_NOTIFICATIONS` (Android 13+) is requested from a rationale
  screen, never as a cold system dialog on first launch.
- **R3.38** Tapping a reminder opens the dashboard on that occurrence's day.

### 3.6 Family activity (push)

- **R3.39** When someone completes an occurrence, every **other** enabled member
  gets a push: `Duda concluiu "Remédio da Aurora" às 07:12`. A user is never
  notified about their own action.
- **R3.40** That push also cancels the matching local reminder on the receiving
  phone in the background, best effort, so a phone that has not been opened does
  not remind its owner to give a dose already given.
- **R3.41** When a completion loses the race *(R3.20)*, the **winner** gets a
  push: `Hudson também marcou "Remédio da Aurora"`. Two people acting on the same
  dose is exactly what the family needs to hear about.
- **R3.42** When a walk starts, the other members get "Hudson saiu para passear
  com Katarina".
- **R3.43** Push is an enhancement. With push unavailable the app stays correct:
  state arrives by sync, only later.

### 3.7 Photo proof

- **R3.44** A template with `requires_photo` cannot be completed without a
  capture. Tapping its checkbox opens the camera.
- **R3.45** Flow: capture → compress (longest edge 1600 px, JPEG quality 0.7) →
  save to app storage → complete immediately → upload in the background.
  Completion never waits on the upload.
- **R3.46** Each photo shows an honest state: `enviando…` while it waits to be
  uploaded, `falhou — toque para tentar de novo` when the upload was refused,
  and no label once it has been sent. On the other phone, a completion whose
  photo has not arrived yet shows `foto a caminho`.
- **R3.47** Uploads retry with exponential backoff and survive app restarts.

---

## 4. Walks

### 4.1 Permissions

- **R4.1** Permissions are requested in stages, each from its own rationale
  screen, never as a cold system dialog:
  1. precise foreground location
  2. notifications (Android 13+) — the tracking service needs its notification
  3. battery-optimization exemption
- **R4.2** The manifest declares `FOREGROUND_SERVICE_LOCATION` and a foreground
  service of type `location`. Without it, starting a walk on Android 14 throws.
- **R4.3** A walk is recorded by a foreground service started while the app is
  visible. On Android that keeps delivering fixes with the screen locked using
  the foreground ("while using the app") permission alone, so "Permitir o tempo
  todo" is **not** part of the normal ladder. If, on a given phone, starting the
  service fails for lack of background permission, the app then asks for it;
  and if it is refused, the walk is recorded only while the app is visible and
  the live screen says so. Tracking never appears to work while silently not
  working.
- **R4.4** The app exposes one location state — `granted` | `approximate` |
  `denied` | `blocked` — and renders it honestly. `approximate` means the user
  allowed only approximate location: every fix would be too coarse to count, so
  walks are not offered and the app asks for precise location. The state is
  re-read on every app foreground.

### 4.2 Durability

- **R4.5** Every GPS fix is written to SQLite the moment it arrives, before any
  aggregation. A process kill costs seconds, never the walk *(WK-1)*.
- **R4.6** On app start and on foreground, an unfinished walk on this device is
  detected and the user is offered **Continuar** or **Encerrar com o que temos**.
  Nothing is discarded silently.
- **R4.7** One device runs at most one walk at a time.
- **R4.8** Before the first walk, the app asks once for the battery-optimization
  exemption and shows manufacturer-specific instructions.

### 4.3 Tracking and metrics

- **R4.9** Sampling: high accuracy, a fix about every 3 seconds whether or not
  the phone moved. (A distance filter on the location request would silence the
  stream while the dog sniffs a tree, and the app would wrongly report no
  signal.)
- **R4.10** A fix with accuracy worse than 30 m is stored but excluded from
  distance and from the saved route *(WK-2)*.
- **R4.11** Distance accumulates incrementally as fixes arrive. A fix adds
  distance only when it is at least 5 m from the last counted position, so GPS
  jitter while standing still adds nothing.
- **R4.12** Live metrics: distance, elapsed time, average pace, current speed.
  Pace shows `--` while average speed is below 0.5 m/s.
- **R4.13** Pause and resume are supported. Paused time counts toward neither
  elapsed time nor pace.
- **R4.14** Finishing saves distance, duration, average pace and the route. The
  route is simplified (Douglas–Peucker, 5 m) before upload *(WK-3)*.
- **R4.15** A finished walk shows its route on a MapLibre map with
  OpenStreetMap tiles and attribution. No API key, no billing account.
- **R4.16** The map is never on the critical path: if tiles do not load, tracking,
  metrics, saving and the route line still work.
- **R4.17** A walk under way is visible on the other phone as "Hudson está
  passeando com a Katarina desde 18:02". One that has been "under way" for more
  than 12 hours is shown as interrupted.
- **R4.18** A walk can be discarded by the person who recorded it or by a leader.

---

## 5. Sync

- **R5.1** The replica is the only thing the UI reads. No screen awaits the
  network to render.
- **R5.2** A mutation applies to the replica and joins the outbox in one local
  transaction. The outbox survives restarts and drains in creation order.
- **R5.3** Transient failures (no network, timeout, 5xx, 429) retry with
  exponential backoff and jitter. Permanent failures (other 4xx) move the
  mutation to a dead-letter list, and the replica is rebuilt from the server so
  the phone never shows a state the server rejected *(OB-2)*.
- **R5.4** The phone pulls changes with a revision cursor. It pulls on app start,
  on foreground, after the outbox drains, on pull-to-refresh, and when the
  socket pokes.
- **R5.5** The socket only says "something changed". The app is fully correct
  with the socket permanently down *(WS-1)*.
- **R5.6** A status indicator shows `sincronizado`, `sincronizando (n)` or
  `offline`. Offline is a supported mode and is not styled as an error.
- **R5.7** Concurrent edits to the same row resolve last-writer-wins by arrival at
  the server, field by field. Completions resolve by R3.20. Neither shows a dialog.
- **R5.8** A change made on one phone appears on the other within 3 seconds when
  both are online with the app open — typically under one.
- **R5.9** The server answers any mutation and any incremental `/sync` in under
  100 ms at the 95th percentile, measured on the box. Login is exempt (Argon2).
- **R5.10** The outbox starts draining the moment a mutation is queued, and a
  pull starts the moment a poke arrives. Nothing is debounced or batched on a
  timer.

---

## 6. Dashboard — "Hoje"

- **R6.1** The dashboard renders from the replica with no spinner. First launch
  with an empty replica shows skeletons until the first pull completes.
- **R6.2** It shows one day. The header moves between days: 90 back, 30 ahead.
  Opening the app always lands on today.
- **R6.3** Sections, top to bottom: **Próximos cuidados** (R2.11, only when
  non-empty, only on today) → **Atrasadas** → **Agora** → **Mais tarde** →
  **Concluídas** (collapsed, with a count).
- **R6.4** Grouping, for the day being shown, at instant `now`:

  | Group | Contains |
  |---|---|
  | Concluídas | every occurrence that is fully complete |
  | Atrasadas | incomplete timed occurrences with `slot + 60 min < now`, plus carry-overs (R6.5) |
  | Agora | incomplete timed occurrences with `slot − 60 min ≤ now ≤ slot + 60 min`, and all incomplete all-day occurrences |
  | Mais tarde | incomplete timed occurrences with `now < slot − 60 min` |

  A past day has no Agora or Mais tarde: everything incomplete is Atrasadas. A
  future day has everything in Mais tarde. `slot` is the occurrence's local time
  resolved to an instant in the family timezone.
- **R6.5** Carry-over: an incomplete occurrence of a **non-daily** template
  (weekly, monthly, once) from the previous 30 days stays in today's Atrasadas,
  labelled with its original date, until it is completed or until the same
  template has an occurrence dated today. Daily occurrences never carry
  over; a missed breakfast is not owed tomorrow.
- **R6.6** Inside a group, order is by slot time, then `sort_order`, then title.
  All-day occurrences have no slot and come first.
- **R6.7** A `per_pet` occurrence is fully complete when every linked,
  non-archived pet has a live completion. Partially complete, it stays in its
  time group and shows `2/4`.
- **R6.8** Each card shows the pet avatars, title, time, the assignee when it is
  not the viewer, and — when done — who did it and when.
- **R6.9** Completing never requires opening the task.
- **R6.10** The dashboard defaults to the viewer's scope: templates assigned to
  them plus unassigned ones. This is the default for leaders too.
- **R6.11** A leader gets a scope filter: `Minhas` · `Todas` · one chip per other
  member. A member gets no filter control. The choice persists per device.
- **R6.12** An unassigned task is visually distinct ("Qualquer um") from an
  assigned one.
- **R6.13** When every occurrence in the viewer's scope for today is complete,
  and there was at least one, the sky celebrates — shooting stars and the
  header "Céu completo" — once per device per day.
- **R6.14** Pull-to-refresh runs a sync pull; it never wipes the list.
- **R6.15** A dose that was given is never hidden. A live completion dated on
  the day being shown, whose template no longer has that occurrence (it was
  re-scheduled or ended on another phone in the meantime), still appears under
  Concluídas with its stored title. If the template's successor has an
  occurrence with the same key and pet, the completion counts for it.

---

## 7. Settings and diagnostics

- **R7.1** Settings shows the family, its members and roles, and to a leader the
  controls to invite, change roles and remove.
- **R7.2** Diagnostics shows: connection state, last synced revision, outbox
  count, dead-letter count with details, pending uploads, permission states,
  notification channel states, battery-optimization state, API health, app
  version and build.
- **R7.3** Diagnostics can export logs as a shareable text file. The export
  never contains tokens or passwords.
- **R7.4** Diagnostics has **Autoteste** *(R3.17)* and **Reconstruir dados
  locais** (wipe the replica and pull everything again; the outbox is kept).
- **R7.5** The app has a light theme (dawn) and a dark theme (deep space) and
  follows the system setting. Both are complete: every screen, effect and
  illustration is designed for both.
- **R7.6** The app has one visual identity — the night sky *(06)*. A completed
  task is a lit star; a pet is a star with an orbit; a finished day is a
  complete sky. Every effect is drawn in code, respects Reduce Motion, and stops
  when its screen is out of focus.

---

## 8. Out of scope for v1

Listed so nobody builds them by accident: iOS, more than one family, task
rotation between members, skipping an occurrence, editing a weight entry,
per-user notification preferences, public sharing, vet integrations, food
inventory, expenses, AI features, a web client, Google Play distribution,
wearables, S3 storage, server-side recurrence, multi-device push per user beyond
what `push_device` gives for free.
