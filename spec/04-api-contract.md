# 04 — API Contract

Base: `https://<host>/api/v1`. Realtime: `wss://<host>/api/v1/ws`.
Content type `application/json` except asset upload (`multipart/form-data`).

**This file is the contract.** `spec/contracts/openapi.json` is generated from the
running FastAPI app and committed. `make contract-check` fails the build if the
generated schema drifts from the committed one without an intentional update.
TypeScript client types are generated from that same file via `openapi-typescript`,
so a backend change that breaks the client breaks `tsc` *(A-15)*.

---

## Conventions

| Rule | Detail |
|---|---|
| Ids | Client-generated UUIDv4 for anything creatable offline |
| Idempotency | Every mutation carries `client_mutation_id`; replay returns the original result, never a duplicate or an error |
| Time | ISO-8601 with offset, UTC on the wire (`2026-09-14T10:30:00Z`) |
| Errors | RFC 7807 problem+json: `{type, title, status, detail, instance}` |
| Auth | `Authorization: Bearer <access_token>` |
| Revisions | Every response body carries `revision` where the entity has one |

**Status codes that carry meaning:**

- `200` — success, *including* an idempotent replay and a lost completion race
- `401` — access token expired → refresh once, retry once *(R1.9)*
- `409` — **reserved and unused for completions** *(A-04, CP-1)*
- `429` — rate limited; `Retry-After` present

---

## Auth *(A-11, A-12, A-13)*

```
POST   /auth/login          {email, password} -> {access_token, refresh_token, user}
POST   /auth/refresh        {refresh_token}   -> {access_token, refresh_token}
POST   /auth/logout         {refresh_token}   -> 204
GET    /me                                    -> User
PATCH  /me                  {display_name?, push_token?} -> User
POST   /invites                               -> {code, expires_at}   (auth required)
POST   /auth/redeem         {code, email, password, display_name} -> tokens
```

- `POST /auth/register` **MUST return 404**. There is no public registration.
  Gate: a test asserting 404 for unauthenticated callers *(R1.1)*.
- `/auth/refresh` rotates: the presented token is marked `rotated_at` and a new
  one issued. Presenting an already-rotated token revokes the **entire token chain**
  and returns 401 *(R1.8)*.
- `/auth/login` is rate-limited 5 per 15 min per account, 429 + `Retry-After`.
- No response may contain a password hash or a raw token hash *(ID-1)*.

---

## Family & members *(ADR-012)*

```
GET    /family                          -> Family + members[]
PATCH  /family          {name?, timezone?}            -> Family      (leader)
GET    /family/members                  -> Member[]
PATCH  /family/members/{user_id}  {role?}             -> Member      (leader)
DELETE /family/members/{user_id}                      -> 204         (leader)
POST   /invites                 {role}  -> {code, expires_at}        (leader)
```

- Demoting or removing the **last** leader MUST return `409` *(FM-1, R1.12)*.
- A leader MUST NOT be able to demote themselves if they are the last leader —
  the check is on the resulting state, not on who is acting.
- `DELETE` a member disables the account; it never deletes their completion
  history. Who did the work is a permanent fact *(R3.1c)*.

## Permissions

The role check lives here, in the API. The UI hiding a button is a convenience,
never a control *(R1.16)*.

| Action | Member | Leader |
|---|---|---|
| Read pets, weights, health events, walks | ✅ | ✅ |
| Create / edit pets, weights, health events | ✅ | ✅ |
| Archive a pet | ❌ | ✅ |
| Create a task assigned to **self** or unassigned | ✅ | ✅ |
| Create a task assigned to **someone else** | ❌ | ✅ |
| Edit / delete a task **they own** | ✅ | ✅ |
| Edit / delete a task **someone else owns** | ❌ | ✅ |
| Reassign any task | ❌ | ✅ |
| Read another member's tasks / completions | ✅ | ✅ |
| Complete a task **in their scope** | ✅ | ✅ |
| Complete a task **assigned to someone else** | ✅ † | ✅ |
| Invite / remove members, change roles | ❌ | ✅ |
| Edit family name / timezone | ❌ | ✅ |

† **Anyone may complete anyone's task**, and `completed_by` records who actually
did it. Blocking this would make the data wrong: if Hudson feeds Aurora on a day
the task belongs to Duda, the honest record is "Hudson fed her", not a refusal.
This is the same principle as R3.1c — history records what happened, never what
was scheduled. It also widens §3.3 path 2 from "leader override" to "anyone
override", which is precisely why the idempotent write still matters.

> **Gate RB-1 — role matrix.** A parametrized test walks every row of this table
> for both roles and asserts the exact status code. Adding an endpoint without a
> row here fails the route census *(Gate 4)*.
>
> **Gate RB-2 — privilege escalation.** A member calling every leader-only
> endpoint MUST get `403`, never `200` and never `404`-by-accident. Includes the
> subtle one: a member `PATCH`ing a task to set `assigned_to` to themselves on a
> task they do not own.

## Task scope *(R6.7–R6.10)*

```
GET /tasks?scope=mine            # default: assigned_to = me OR assigned_to IS NULL
GET /tasks?scope=all             # leader only
GET /tasks?scope=user&user_id=   # leader only
```

- `scope` defaults to `mine` for **every** role, leaders included. A leader's home
  is their home, not an admin console *(R6.7)*.

> **OPEN-1 — RESOLVED 2026-09-14: scoping is a view filter, not an access boundary.**
>
> Reads are **family-wide**. Any member may read any task, completion, pet and
> care history in their family. `scope` is a query convenience and the widening
> control is simply not rendered for members — it is **not** a security control
> and MUST NOT be described as one. A member passing `scope=all` gets `200`, not
> `403`: declaring a boundary the system does not actually enforce is worse than
> having none, because it implies a guarantee the code cannot keep.
>
> **Roles govern writes, not reads.** Everything in the matrix above that is
> leader-only is a mutation.
>
> Consequence: the pet's care history stays visible to the whole family, so Duda
> can confirm Aurora got her medication even when the task belongs to Hudson.
> That cross-check is the app's safety property and it survives intact.

---

## Sync *(A-10 — the backbone)*

```
GET /sync?since=<revision>&limit=500
```

```jsonc
{
  "revision": 10432,          // highest revision in this response
  "has_more": false,          // true -> call again with since=revision
  "server_time": "2026-09-14T10:30:00Z",
  "changes": {
    "pets":             [ /* ... */ ],
    "task_templates":   [ /* ... */ ],
    "task_pets":        [ /* ... */ ],
    "task_completions": [ /* ... */ ],
    "task_timers":      [ /* ... */ ],
    "weight_entries":   [ /* ... */ ],
    "health_events":    [ /* ... */ ],
    "walk_sessions":    [ /* ... */ ],
    "assets":           [ /* ... */ ]
  }
}
```

- `since=0` returns a full snapshot (small — this family will never exceed a
  few thousand rows).
- Deleted rows appear as tombstones with `deleted_at` set. The client must apply
  them, not skip them.
- Ordering across the response is by `revision` ascending; the client applies in
  that order and then stores `revision` as `last_revision`.

> **Gate SY-2:** a test that mutates 5 entities, calls `/sync?since=` with the
> pre-mutation revision, and asserts exactly those 5 changes come back, in
> revision order, with nothing else.

---

## Realtime

```
WSS /ws?access_token=<jwt>
```

Server → client:

```jsonc
{ "type": "change", "revision": 10433, "entity": "task_completion", "op": "upsert",
  "payload": { /* full row */ } }

{ "type": "pong", "server_time": "..." }
```

Client → server:

```jsonc
{ "type": "ping" }
{ "type": "hello", "last_revision": 10432 }
```

**Client rules (non-negotiable):**

1. On `change`, if `revision != last_revision + 1`, a gap exists → call
   `GET /sync?since=last_revision` and reconcile **before** applying anything
   further from the socket *(R5.3)*.
2. Ping every 30 s; no pong within 10 s → drop and reconnect.
3. Reconnect with exponential backoff **plus jitter**, capped at 60 s. Two phones
   must not reconnect in lockstep after a server restart.
4. On every reconnect, send `hello` and run a `/sync` reconcile regardless of
   whether a gap was detected. Sockets lie; the cursor does not.
5. **The socket is never the source of truth.** With the socket permanently down,
   the app must be fully correct via foreground reconcile + pull-to-refresh *(R5.4)*.

> **Gate WS-1:** a test that connects, kills the socket server-side, mutates data
> out-of-band, reconnects, and asserts the client converged to the correct state
> without any user action.

---

## Pets

```
GET    /pets                         -> Pet[]        (includes archived)
POST   /pets            Pet          -> Pet
PATCH  /pets/{id}       PetPatch     -> Pet
POST   /pets/{id}/archive            -> Pet          (never DELETE — R2.2)

GET    /pets/{id}/weights            -> WeightEntry[]
POST   /pets/{id}/weights  {id, weight_kg, measured_at, note?, client_mutation_id} -> WeightEntry
DELETE /weights/{id}                 -> 204          (soft)

GET    /pets/{id}/health-events      -> HealthEvent[]
POST   /pets/{id}/health-events      -> HealthEvent
PATCH  /health-events/{id}           -> HealthEvent
DELETE /health-events/{id}           -> 204          (soft)
```

---

## Tasks

```
GET    /tasks                        -> TaskTemplate[]   (with pet_ids inlined)
POST   /tasks           TaskTemplate -> TaskTemplate
PATCH  /tasks/{id}                   -> TaskTemplate
DELETE /tasks/{id}                   -> 204              (soft; history preserved — R3.5)
```

`TaskTemplate`:

```jsonc
{
  "id": "uuid",
  "title": "Remédio da Aurora",
  "description": null,
  "category": "medication",
  "recurrence": { "freq": "daily", "interval": 1 },
  "times_of_day": ["08:00", "20:00"],
  "starts_on": "2026-09-01",
  "ends_on": null,
  "pet_ids": ["uuid-aurora"],
  "assigned_to": "uuid-duda",        // null = anyone in the family (ADR-012)
  "completion_mode": "per_pet",
  "requires_photo": false,
  "timer_seconds": null,
  "reminder_class": "critical",
  "active": true,
  "sort_order": 0,
  "revision": 10433
}
```

> **No endpoint returns "today's tasks."** Occurrences are computed client-side
> from the rule *(A-03)*. The server never materializes a schedule. A gate test
> asserts no route path matches `/occurrences|/today|/schedule/`.

---

## Completions *(A-04 — the most important contract in the app)*

```
POST   /completions                  -> Completion   (200, always)
POST   /completions/{id}/undo        -> Completion   (200; sets undone_at)
GET    /completions?from=&to=        -> Completion[]
```

Request:

```jsonc
{
  "id": "uuid",
  "task_id": "uuid",
  "occurrence_key": "2026-09-14T08:00",
  "pet_id": "uuid-aurora",          // null when completion_mode = "together"
  "completed_at": "2026-09-14T11:02:31Z",
  "photo_asset_id": null,            // may reference a not-yet-uploaded asset (AS-1)
  "note": null,
  "client_mutation_id": "uuid"
}
```

**Server behavior — exhaustive:**

| Situation | Response |
|---|---|
| New completion | `200` + the created row |
| Same `client_mutation_id` replayed | `200` + the original row, nothing created |
| Different device already completed this occurrence | `200` + **the winning row** (`completed_by` = the other user). **Never 409.** |
| `photo_asset_id` references an unuploaded asset | `200`, accepted, reconciled later |
| Task deleted after the client queued the completion | `200`, accepted — history is preserved |

The client compares `completed_by` in the response to its own user id. If they
differ, it lost the race: reconcile silently and display "Duda já alimentou às
07:12" *(R3.14)*. **This is a success path, not an error path.** The UI must
never show a failure here.

> **Gate CP-1:** 10 concurrent POSTs for the same occurrence from 2 users →
> exactly 1 row, 10 × `200`, all 10 bodies byte-identical.
>
> **Gate CP-2:** the same payload posted 5 times → 1 row, 5 identical `200`s.

---

## Timers *(A-18)*

```
POST   /timers          {id, task_id, occurrence_key, ends_at, client_mutation_id} -> Timer
POST   /timers/{id}/cancel -> Timer
```

The server stores `ends_at` and broadcasts it so the other phone sees the
countdown too. It runs no job, schedules no callback, and does nothing at
expiry. The notification is local, on each device *(TM-1)*.

---

## Walks

```
POST   /walks              {id, pet_id, started_at, client_mutation_id} -> Walk
PATCH  /walks/{id}         {status?, paused_ms?}                        -> Walk
POST   /walks/{id}/finish  {ended_at, distance_m, duration_s,
                            avg_pace_s_per_km, route, point_count}      -> Walk
GET    /walks?pet_id=&limit=                                            -> Walk[]
```

- The live walk is **not** streamed point-by-point. Points live in device SQLite
  and upload once, downsampled, at finish *(WK-3)*. Streaming would burn battery
  and bandwidth for a feature nobody asked for.
- `PATCH` with `status` is throttled to at most once per 30 s so the other phone
  can show "Hudson está passeando com a Katarina" without chatter.
- Starting a second walk for a pet that already has an active one returns `409`
  with the existing walk id — the one place 409 is correct *(R4.8)*.

---

## Assets *(A-14)*

```
POST   /assets            multipart: file, id, kind, sha256 -> Asset
GET    /assets/{id}                                          -> 302 → storage URL
DELETE /assets/{id}                                          -> 204
```

- `id` is client-supplied so a completion can reference the asset **before** the
  upload finishes.
- If `sha256` already exists in the family, the server returns the existing
  asset with `200` instead of storing a duplicate.
- Max 8 MB (rejected at the proxy — the 2 GB box must not buffer more).
- Server-side validation: real image magic bytes, dimensions sane, MIME in
  `{image/jpeg, image/png, image/webp}`. Never trust the client's MIME.

---

## Health *(A-24)*

```
GET /health   -> { status, db, disk_free_mb, revision, version, uptime_s }
```

Unauthenticated, rate-limited, no sensitive data. Used by the deploy script and
by the in-app Diagnostics screen.

---

## Contract governance

1. Change this file first.
2. Change the FastAPI schemas.
3. `make contract-freeze` regenerates `spec/contracts/openapi.json`.
4. `make types` regenerates `packages/shared/src/api-types.ts`.
5. `tsc` breaks at every client call site that no longer matches.

Skipping step 1 is a spec violation. `make contract-check` in CI fails on any
drift between the running app and the committed schema, which makes step 1
non-optional in practice *(A-15)*.
