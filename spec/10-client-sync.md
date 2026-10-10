# 10 — Client Sync Engine

How the phone stores, changes and synchronizes data. This is the part of the app
that is hardest to get right and easiest to get subtly wrong, so it is specified
as algorithms, not as intentions. *(ADR-019, ADR-020, ADR-021, ADR-022)*

The model in one paragraph: **the phone owns a replica**. The UI reads only the
replica. A mutation changes the replica and joins the outbox in one local
transaction, and the UI is already up to date. In the background, a sync cycle
pushes the outbox and pulls whatever the server has that the phone does not.
The network is never on the path between a tap and the screen *(pillar 2)*.

---

## 1. Modules and their seams

Everything here lives in `apps/mobile/src/` and is plain TypeScript with its
dependencies injected, so it runs under Jest with no device.

| Module | Responsibility |
|---|---|
| `db/driver.ts` | `SqlDriver` interface + the `expo-sqlite` implementation |
| `db/migrations.ts` | ordered schema migrations (`03` §10) |
| `db/replicaRepo.ts` `outboxRepo.ts` `deadLetterRepo.ts` `kv.ts` `assetRepo.ts` `walkRepo.ts` | typed access to each table |
| `replica/store.ts` | the in-memory store (Zustand vanilla) |
| `replica/apply.ts` | the one module that writes rows into SQLite **and** the store |
| `replica/selectors.ts` | pure functions from store state to view data |
| `api/client.ts` | `fetch` wrapper: base URL of the active server, auth header, timeouts, error mapping |
| `sync/serverSelect.ts` | which server is active, and when to move *(`11` §4.2)* |
| `sync/arrive.ts` | reseed, full pull, sweep, on arriving at a server *(`11` §4.3)* |
| `auth/session.ts` | tokens, single-flight refresh, login/logout |
| `sync/mutations.ts` | the catalogue of mutations (§3) |
| `sync/outbox.ts` | drain loop and error taxonomy (§4) |
| `sync/pull.ts` | cursor pull (§5) |
| `sync/socket.ts` | the poke socket (§6) |
| `sync/engine.ts` | the cycle and the connection state (§8) |
| `assets/files.ts` | upload loop and download cache (§7) |
| `walks/routes.ts` | lazy loader for a finished walk's full route (§7.3) |

Injected seams — tests substitute every one of them:

```ts
interface SqlDriver {
  run(sql: string, params?: unknown[]): void;
  all<T>(sql: string, params?: unknown[]): T[];
  transaction<T>(fn: () => T): T;     // re-entrant: an inner call joins the outer transaction
}
interface Clock      { now(): number }                       // epoch ms
interface Random     { next(): number }                      // [0, 1)
interface Http       { request(req: HttpRequest): Promise<HttpResponse> }
interface SecretBox  { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }
interface IdGen      { uuid(): string }
interface FileSystem { exists(uri: string): Promise<boolean>;
                       download(url: string, uri: string, headers: Headers): Promise<HttpResult>;
                       upload(url: string, uri: string, headers: Headers): Promise<HttpResult>;
                       remove(uri: string): Promise<void> }
```

`Date.now()`, `Math.random()` and `crypto.randomUUID()` are called only inside
the production implementations of `Clock`, `Random` and `IdGen`. Tests use
`sql.js` (WebAssembly SQLite, no native build) behind `SqlDriver`.

**`transaction` is re-entrant.** The outermost call issues `BEGIN IMMEDIATE` …
`COMMIT` (or `ROLLBACK` if `fn` throws); a call made while one is open just
runs `fn`. Every multi-step state change below says "one transaction": that
means one outermost `transaction`, with nothing that can fail left outside it.

---

## 2. The replica

### 2.1 On disk

Table `replica` (`03` §10): one row per synced row, holding the server's JSON.
`pending = 1` marks a row with local changes the server has not acknowledged;
it exists for the UI (a "not sent yet" hint) and for the day view. **Whether a
server row may overwrite local state is decided by the outbox, not by this
flag** (§2.3).

### 2.2 In memory

```ts
type ReplicaState = {
  ready: boolean;                               // false until hydrate() finishes
  family: Family | null;
  members: Record<string, Member>;
  pets: Record<string, Pet>;
  weightEntries: Record<string, WeightEntry>;
  healthEvents: Record<string, HealthEvent>;
  taskTemplates: Record<string, TaskTemplate>;
  completions: Record<string, Completion>;      // window: see below
  timers: Record<string, Timer>;
  walks: Record<string, Walk>;
  assets: Record<string, Asset>;
  pending: Record<string, true>;                // key = `${entity}:${id}`
};
```

- `hydrate()` runs synchronously at startup, before the first render: it reads
  every `replica` row except `task_completions` with
  `sort_key < (today − 120 days)`. Older completions stay on disk and are read
  on demand by history screens through `replicaRepo.range()`.
- Soft-deleted rows (`deleted_at` set) are removed from memory and **kept on
  disk as tombstones** (`deleted = 1`): never hydrated, never returned by a
  selector or by `range()`, and sent in a reseed *(`11` §2.2)*.
- The store exposes no setters to the UI. The only writers are `apply.ts`
  functions.

### 2.3 Writing — `apply.ts`

```ts
applyServerRows(changes: {entity, row}[], opts?: {cursor?: number}): void
applyLocalRow(entity, row): void            // upsert with pending = 1, revision untouched
removeRow(entity, id): void
```

Each does its SQLite work inside a `transaction`. **The store is updated only
after the outermost transaction commits**, in a single `setState`: the module
collects the changes made during the transaction and flushes them once on
commit, or discards them on rollback. React therefore renders once per batch
and never sees a state that was rolled back.

`applyServerRows` rule, per change, in order:

```
if the outbox holds an entry for (entity, id):
       skip                      -- local intent wins until the server answers it
else if row.deleted_at is set:
       upsert as a tombstone (deleted = 1); remove it from the store
else:
       upsert with pending = 0, revision = row.revision
if opts.cursor is given: kv.last_revision.<server> = opts.cursor   -- same transaction
```

The skip test looks at the **outbox**, not at the replica row, so it also
protects a local delete: a row removed locally, whose `DELETE` is still queued,
is not resurrected by a pull.

Skipping is safe: the pending mutation's own response carries the full row at a
later revision, which then replaces whatever is there.

> **RP-1** `hydrate()` after a restart reproduces exactly the state that
> `apply*` built before it. Gate: build a state through a mixed sequence of
> applies, snapshot the store, create a fresh store over the same SQLite,
> hydrate, compare.
>
> **RP-2** A server row never overrides local intent that still has an outbox
> entry. Gate: (a) local edit → pull delivers an older version → the local value
> survives → the ack arrives → the server value is in. (b) local delete → pull
> delivers the row → it stays deleted → the delete's ack arrives → still gone.
>
> **RP-3** A transaction that throws leaves SQLite **and** the store exactly as
> they were. Gate: throw after `applyLocalRow` inside an outer transaction; the
> row is in neither place and no subscriber was notified.

---

## 3. Mutations

A mutation is created by one function in `sync/mutations.ts`:

```ts
type Mutation = {
  clientMutationId: string;      // IdGen.uuid() — becomes the Idempotency-Key
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown | null;
  entity: SyncEntity;
  entityId: string;
  localRow: unknown | null;      // full row in server shape, or null to remove locally
};

enqueue(...mutations: Mutation[]): void
    // ONE transaction: for each mutation, applyLocalRow / removeRow + INSERT INTO outbox
    // after commit: engine.kick('mutation')
```

`enqueue` is synchronous. When it returns, the UI already reflects the change,
and the engine has been kicked: the request leaves on the same tick, with no
debounce and no batching window *(R5.10)*. Passing several mutations (a fork)
makes them one atomic local change.

**The catalogue** (every offline-capable write in the app):

| Function | Request | Local effect |
|---|---|---|
| `createPet` / `patchPet` | `POST /pets` · `PATCH /pets/{id}` | upsert pet |
| `archivePet` / `unarchivePet` | `POST /pets/{id}/archive` · `/unarchive` | set / clear `archived_at` |
| `createWeight` / `deleteWeight` | `POST /weights` · `DELETE /weights/{id}` | upsert / remove |
| `createHealthEvent` / `patchHealthEvent` / `deleteHealthEvent` | `/health-events…` | upsert / remove |
| `createTask` / `patchTask` / `deleteTask` | `/tasks…` | upsert / remove |
| `forkTask` | `createTask(new)` **then** `patchTask(old, {ends_on})` — two outbox entries, in that order, one `enqueue` *(04 §9)* | both |
| `createCompletion` | `POST /completions` | upsert with `completed_by = me`, `title_snapshot = template.title` |
| `undoCompletion` | `POST /completions/{id}/undo` | set `undone_at = now`, `undone_by = me` |
| `startTimer` / `cancelTimer` | `/timers…` | upsert |
| `startWalk` / `finishWalk` / `discardWalk` | `/walks…` | upsert / upsert / remove |

Local rows are complete server-shaped rows with `revision: null` and
`updated_at` = now. Fields the server assigns are filled with the best local
value so the UI needs no special case.

**Online-only actions** — login, logout, redeem, change password, invites,
`PATCH /family`, member role change, member removal — do not use the outbox.
They call the API directly (sending a fresh `Idempotency-Key` where the route
is marked ⟳ in `04`), show a button-level loading state, apply the returned
row with `applyServerRows`, and are disabled while offline.

---

## 4. Draining the outbox

```
drain():
  loop:
    e = first outbox entry by seq whose user_id = session user
    if none: return 'empty'
    if e.next_retry_at > clock.now(): return 'waiting'
    res = api.request(e.method, e.path, e.body, { 'Idempotency-Key': e.client_mutation_id })
    switch classify(res, e):
      'ok'        -> ONE transaction: onAck(e, res.body) + delete e
      'transient' -> ONE transaction: e.attempts += 1; if res is an HTTP 5xx: e.server_errors += 1
                                      e.next_retry_at = now + backoff(e.attempts, res.retryAfter)
                                      e.last_error = summary(res)
                     return 'waiting'                 -- order is preserved: nothing overtakes
      'permanent' -> ONE transaction: reject(e, res)  -- §4.3
      'auth'      -> return 'signed_out'
```

### 4.1 Classification

| Result | Class |
|---|---|
| 2xx | `ok` |
| `fetch` threw, or timed out (15 s) | `transient` — retried without limit |
| 408, 425, 429 | `transient` (429 honours `Retry-After`) |
| 5xx — the entry's 1st to 7th HTTP 5xx response | `transient` (503 honours `Retry-After`) |
| 5xx — the entry's 8th HTTP 5xx response | `permanent` — a request the server can never handle must not block the queue forever |
| 401 after one refresh and one retry | `auth` |
| any other 4xx (400, 403, 404, 409, 410, 413, 422) | `permanent` |

`outbox` has a `server_errors` counter beside `attempts` for this (`03` §10).

`backoff(n, retryAfter) = retryAfter ?? min(60 s, 1 s × 2ⁿ) × (0.5 + 0.5 × random)`

### 4.2 `onAck(e, row)`

```
if row.id == e.entity_id:
    if another outbox entry still targets (e.entity, e.entity_id):  leave the replica row alone
    else:  write the server row (pending = 0)
else:                                             -- only completions: we lost the race (R3.21)
    removeRow(e.entity, e.entity_id)
    delete every remaining outbox entry with entity_id = e.entity_id    -- they are moot
    write the server row (pending = 0)
    after commit: emit 'completion_lost' { winner: row }               -- the UI shows the toast
```

`onAck` writes directly, without the outbox check of §2.3 for this entry: the
acknowledgement is the server's answer to it.

### 4.3 `reject(e, res)` — all in one transaction

```
upsert e into dead_letter (INSERT OR REPLACE)       -- a crash and re-run cannot collide
if no other outbox entry targets (e.entity, e.entity_id):
    removeRow(e.entity, e.entity_id)                -- an optimistic create vanishes;
                                                    -- an optimistic edit is restored by the full pull
delete e from the outbox
kv.last_revision = 0                                -- the next pull is a full snapshot
after commit: emit 'mutation_rejected' { entry: e } -- one toast: "Uma alteração não pôde ser aplicada"; log it
```

The cursor reset is written in the **same transaction** as the row removal, so
a process killed right after it still pulls everything on the next start. A
full pull upserts every row the outbox does not protect and applies every
tombstone, so the replica converges on the server without wiping anything.

> **OB-1** 20 queued mutations, a simulated restart, then network → all 20
> requests are sent exactly once each, in `seq` order.
>
> **OB-2** A `422` on entry 3 of 5 → entry 3 is in `dead_letter`, its optimistic
> row is gone, `kv.last_revision` is 0, entries 4 and 5 are still sent — and all
> of that holds if the process is killed right after the rejection commits.
>
> **OB-3** A transient failure on entry 2 sends nothing after it until the retry
> succeeds. With the fake clock advanced by the backoff, it is retried and the
> rest follows.
>
> **OB-4** A lost completion race removes the local row, stores the winner,
> drops a queued undo for the local id, and emits `completion_lost` once.
>
> **OB-5** An entry answered `500` eight times is dead-lettered on the eighth,
> and the entries behind it drain. Network errors never count toward that limit.
>
> **OB-6** Running `reject` twice for the same entry (a crash between its steps
> cannot happen, but a replay must be harmless) leaves one dead-letter row and
> does not throw.

---

## 5. Pulling

```
pull():
  loop:
    -- every kv key below is the active server's: kv.last_revision.<server>, … (11 §4.1)
    since = kv.last_revision ?? 0
    res = GET /sync?since=<since>&limit=500
    if not ok: return classify(res)                       -- transient / auth
    if res.epoch != kv.reseeded_epoch:
        return arrive(server)                             -- reseed, full pull, sweep: 11 §4.3
    if kv.sync_epoch is absent: kv.sync_epoch = res.epoch
    applyServerRows(res.changes, { cursor: res.revision })   -- rows + cursor, one transaction
    if not res.has_more: return 'ok'
```

After a pull that applied anything: prefetch avatar files (§7), and ask the
notification layer to reconcile reminders (`09` §9).

> **PL-1** A pull interrupted between pages resumes from the stored cursor with
> no duplicate and no omission.
>
> **PL-2** The cursor and the rows of a page commit together: a crash injected
> inside `applyServerRows` leaves both at their previous values.
>
> **PL-3** A changed `epoch` starts `arrive` *(`11` §4.3)*: the phone reseeds
> the server, pulls from zero, and only then removes the synced rows the server
> did not return. Every row protected by the outbox, and the outbox itself, is
> kept, and the replica ends equal to the server *(SY-7, RS-7)*.
>
> **PL-4** After a rejection (OB-2), the next pull makes the replica equal to
> the server: a rejected optimistic edit shows the server's value again, and a
> row removed by `reject` is back.

---

## 6. The socket

```
connect when: signed in AND app in foreground AND network reachable
on open:      send {type:'auth', access_token}
on 'ready', 'poke' or 'pong':  if msg.revision > kv.last_revision: engine.kick('poke')
every 30 s:   send {type:'ping'}; no 'pong' within 10 s → close and reconnect
on close 4401: refresh the access token (single-flight), then reconnect
on any other close or error: reconnect after backoff(n) (1 s … 60 s, with jitter); n resets on 'ready'
on app background: close; on foreground: connect and engine.kick('foreground')
```

The `pong` carries the family revision, so a poke lost on an open socket is
caught within 30 seconds. While the app is in the foreground and the socket is
**not** open, the engine pulls every 60 seconds. Together they keep the app
correct with the socket unreliable or permanently down *(R5.5)*. These are
plain JS timers; they drive data, not animation.

---

## 7. Files

Photos follow the same idea as rows: the UI reads a **local file**.

### 7.1 Capture and upload

```
capture (avatar, photo proof, health attachment):
    id = uuid()
    compress → write to <documentDirectory>/assets/<id>.jpg
    INSERT asset_file (id, kind, local_uri, state='to_upload', sha256)
    then enqueue the mutation that references id        -- completion never waits (R3.45)
    uploads.kick()
```

The upload loop is **its own single-flight loop, independent of the sync
cycle**: a slow photo on a bad network never delays a row mutation.

```
uploads.run():                                   -- one at a time
  for each asset_file with state='to_upload' and next_retry_at <= now, oldest first:
      PUT /assets/<id>?kind=<kind>   (raw file body, Content-Length, X-Content-SHA256; 60 s timeout)
      201 or 200  → state = 'uploaded'
      transient   → attempts += 1; next_retry_at = now + backoff(attempts)
      permanent   → state = 'failed'             -- UI: "falhou — toque para tentar de novo"
  if any 'to_upload' row remains: schedule uploads.kick() at the earliest next_retry_at
```

`uploads.kick()` is called after a capture, when the network returns, on app
foreground, on a manual retry, and by its own retry timer. Tapping a failed
photo sets it back to `to_upload` with `attempts = 0`.

### 7.2 Download cache

```
ensureFile(assetId):
    row = asset_file[assetId]
    if row?.local_uri exists on disk: return ready(local_uri)
    if replica.assets[assetId] is absent: return pending      -- "foto a caminho" (R3.46)
    download GET /assets/<id>/file with the auth header → <documentDirectory>/assets/<id>.<ext>
    upsert asset_file (state='downloaded', local_uri)
    return ready(local_uri)
```

- Avatars of non-archived pets are downloaded eagerly after every pull.
- Photo proofs and health attachments are downloaded when first shown.
- `useAssetFile(id)` returns `{ status: 'ready' | 'pending' | 'failed', uri? }`
  and re-evaluates when the `assets` slice of the store changes.

### 7.3 Walk routes

A walk row carries a small `preview` (at most 32 points) for list thumbnails,
so lists need no extra request. The full route is loaded on the detail screen:

```
ensureRoute(walkId):
    if walk_route_cache has walkId: return it
    GET /walks/<id>/route → store in walk_route_cache → return it
    offline or failed → return 'unavailable'      -- the screen says so and still shows the metrics
```

The device that recorded a walk writes the route to `walk_route_cache` when it
finishes, so it never needs the request.

> **AF-1** A completion created with a photo is in the replica and the outbox
> before any upload request is made.
>
> **AF-2** The upload loop survives a restart: a `to_upload` row created before
> the restart is uploaded after it.
>
> **AF-3** With an empty outbox and no other activity, a failed upload is retried
> by its own timer when its backoff expires.
>
> **AF-4** A sync cycle completes while an upload is in flight (the upload's
> promise is left pending in the test).

---

## 8. The engine

One object, created once at startup, owns the cycle and the connection state.

```
kick(reason):  if a cycle is running: rerun = true; return
               run cycle

cycle:
  server = serverSelect.current()                       -- may have moved: 11 §4.2
  if server changed since the last cycle: arrive(server) -- 11 §4.3; it ends in this same cycle
  if kv.signed_out or no session for this server: state = 'signed_out'; return
  if network unreachable: state = 'offline'; return
  state = 'syncing'
  r1 = drain()          -- outbox first, so acknowledgements land before the pull
  if r1 == 'signed_out': → signed-out flow (§8.1)
  r2 = pull()
  state = (r1 or r2 failed at the network level) ? 'offline'
        : (outbox non-empty) ? 'syncing' : 'synced'
  schedule kick('retry') at the earliest of:
      the head outbox entry's next_retry_at, if the outbox is non-empty
      now + backoff(pullFailures), if r2 was a transient failure      -- pullFailures resets on success
  if rerun: rerun = false; run cycle again
```

**Triggers:** startup after `hydrate()`; app foreground; network regained;
socket `ready`/`poke`/`pong` with a newer revision; every `enqueue`;
pull-to-refresh; the scheduled retry; the 60-second fallback of §6.

**Connection state** shown by the indicator *(R5.6)*:

| State | Shown as | When |
|---|---|---|
| `synced` | `sincronizado` — on the reserve, `sincronizado · reserva` | online, outbox empty, last cycle clean |
| `syncing` | `sincronizando (n)` — `n` = outbox length, omitted when 0; on the reserve, ending with `· reserva` | a cycle is running, the outbox is non-empty, or `arrive` has not ended |
| `offline` | `offline` | no network, or the last request failed at the network level |
| `signed_out` | (login screen) | refresh is no longer possible |

### 8.1 Session lifecycle

**Stored where:**

| What | Where |
|---|---|
| refresh token | `SecretBox` — one per server *(`11` §4.1, RS-9)* |
| access token and its expiry | `SecretBox`, one per server — so a cold start does not spend a refresh rotation it does not need |
| `session_user` (the `/me` JSON) | `kv` — kept across a session expiry, so "same user?" can be answered |
| `signed_out` (`'1'` when the session can no longer be refreshed) | `kv`, one per server |

- **Startup:** `kv.session_user` absent → login screen. Present and
  `kv.signed_out` set → login screen, with the replica and outbox untouched.
  Otherwise → hydrate, render, `kick('start')`.
- **`session.accessToken()`** returns the stored token if it has more than 30 s
  left; otherwise it awaits `refresh()`.
- **`refresh()` is single-flight:** concurrent callers share one in-flight
  promise *(R1.9)*. It writes the new tokens to `SecretBox` before resolving.
  Network failure → the caller treats it as transient. `401` → the session is
  over: set `kv.signed_out`, state `signed_out`, the login screen appears,
  **the outbox and replica are kept** *(R1.11)*.
- **Login:** clear `kv.signed_out`. If the user id equals the previous
  `kv.session_user` → keep everything and `kick('login')`. If it differs → when
  the outbox is non-empty, first confirm that N unsynced changes of the previous
  user will be discarded; then **wipe** (below) before the first pull.
- **Logout:** if the outbox is non-empty, confirm *(R1.11)*. Then
  `DELETE /me/push-token`, `POST /auth/logout` (both best effort), and wipe.

**Wipe** — one transaction plus file cleanup: delete every row of `replica`,
`outbox`, `dead_letter`, `asset_file`, `local_walk`, `walk_point`,
`walk_route_cache`; delete every `kv` key except `device_id`; delete the files
under `assets/`; clear `SecretBox`; cancel all scheduled notifications; stop any
location tracking; reset the store.

> **SE-1** Five requests that all receive `401` cause exactly one call to
> `/auth/refresh`, and all five succeed on retry.
>
> **SE-2** A refresh answered `401` sets `kv.signed_out`, leaves the outbox
> intact and moves the engine to `signed_out`; after a simulated restart the app
> still starts at the login screen; logging in as the same user drains the
> outbox.
>
> **SE-3** Logging in as a different user leaves no row, outbox entry, file,
> walk point or cached route of the previous user.
>
> **SE-4** A cold start with a stored, unexpired access token makes no call to
> `/auth/refresh`.

---

## 9. What the UI may and may not do

- Read: only through selectors over the store, `useAssetFile`, `ensureRoute`,
  or `replicaRepo.range()` for history older than the in-memory window.
- Write: only by calling a function from `sync/mutations.ts` or an online-only
  action from `auth/` / `features/family/`.
- Never: call `fetch` from a component, `await` anything before the first
  paint of a screen, write to SQLite directly, or keep a copy of server data in
  component state.

A `useNow(intervalMs)` hook provides the current instant to selectors that
depend on time (dashboard grouping, timers' text). It ticks on a JS timer
aligned to the minute. This is data, not animation; animations never read it.
