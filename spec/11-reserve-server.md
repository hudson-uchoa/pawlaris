# 11 — The reserve server

> **Approved by the owner on 2026-10-10** *(ADR-038)*. Built by P2-16 and
> P2-17 (server), P3-9 and P3-10 (phone), P8-8 and P8-9 (the computer and
> the drill); it also changes what P3-1, P3-2, P3-3, P3-5, P3-7, P4-3, P4-4,
> P4-9, P5-8, P8-4, P8-5 and P8-6 build.

The family has **two servers**: a *primary* that is always on, and a *reserve*
that the owner switches on when the primary is gone. The app knows both,
moves between them by itself, and **the phones carry the data**: a phone that
connects to a server lacking what it holds uploads its replica — a *reseed* —
and then pulls the merged result. The servers never talk to each other.

This is the one place where Pawlaris has a second copy of anything *(00 P7, as
amended by ADR-038)*. It exists because the primary may be a free virtual
machine that its provider can reclaim, and because an outage hides one
person's dose from the other.

Read with `03` §1 (revisions, the family lock, the epoch), `04` §6 (sync) and
`10` (the client engine). Where this file changes one of them, it says so.

---

## 1. The model

| | Primary | Reserve |
|---|---|---|
| Where | the box (`05` §4) | the owner's computer, off most of the time |
| How it is born | `bootstrap`, once | `restore.sh` from a backup of the primary — never `bootstrap` |
| `SERVER_ROLE` | `primary` (the default) | `reserve` |
| Accounts | the authority | a copy, as old as its backup; cannot change them (§5) |
| People it does not know | become stubs (§5) | become stubs (§5) |
| Family data | merged from the phones | merged from the phones |

- Both run the same image and the same code. The role is one setting.
- Each server is its own *history*: its own `sync_epoch`, its own revision
  counter, its own sessions, its own idempotency records. Nothing of one is
  ever valid on the other *(RS-9)*.
- **Exactly one rule keeps two histories safe: every row is merged by rules
  that give the same result whatever the order** (§3). Two phones on two
  servers for a while is therefore an inconvenience — neither sees the other,
  as when offline — and not a danger.
- The reserve needs one backup to exist at all: without accounts nobody can
  log in. What the backup lacks in family data, the first phone brings.

---

## 2. What changes underneath

### 2.1 The change time travels with the row

`updated_at` is the instant a row last changed, and it is what a merge
compares. Today the trigger always sets it to `now()` *(03 §1)*. A reseed must
keep the instant the phone carries, so `bump_revision` (and its `family`
twin) becomes:

```sql
IF current_setting('pawlaris.reseed', true) = 'on' AND NEW.updated_at IS NOT NULL THEN
  NULL;                       -- keep the supplied instant
ELSE
  NEW.updated_at := now();
END IF;
```

Only the reseed service sets `SET LOCAL pawlaris.reseed = 'on'`, and it
clamps every supplied `updated_at` to at most five minutes ahead of the
server's clock, so no phone can make a row win forever. `revision` is still
assigned by the trigger, always: it belongs to the server, not to the row.

Under that setting the trigger stamps nothing that already has an instant,
and an `UPDATE` that leaves `updated_at` alone carries the old one. So the
reseed service sets `updated_at` itself on every row it writes: the instant
the rules of §3.1 give, or the `Clock`'s now for a change the merge itself
makes — a completion it turns into a duplicate. A stub (§5) is an inserted
row like any other and keeps the instant its `members` row carries.

### 2.2 The phone keeps tombstones

Today a row that arrives with `deleted_at` is removed from the phone's disk
*(10 §2.3)*, so the phone could never tell another server that it was deleted.
From now on a tombstone **stays in `replica`**, with its JSON, and is not
hydrated into memory: selectors, `range()` and the UI never see it. Undone
completions and cancelled timers were already kept. At this family's size the
growth does not matter *(03, sizing)*.

### 2.3 A duplicate completion is recorded, not dropped

```sql
ALTER TABLE task_completion
  ADD COLUMN duplicate_of uuid REFERENCES task_completion(id);
```

When two servers each hold a live completion of the same
`(task, occurrence, pet)`, both people may really have done it, hours apart.
The earlier one stays live; the other stays in history with `duplicate_of`
naming it, `undone_at` set to the merge instant and `undone_by` null — which
keeps the live-completion index of `03` §5 intact. `duplicate_of` is part of
the Completion row and reaches the phones through `/sync`. On one server, with
two taps racing, nothing changes: the loser's row is still never written.

---

## 3. Reseed — `POST /reseed`

```
POST /reseed   { "rows": [ { "entity": "<name>", "row": { … } }, … ] }   -> ReseedResult
```

```jsonc
// ReseedResult
{ "inserted": 12, "updated": 3, "unchanged": 480, "duplicates": 1, "refused": 0 }
```

- Any enabled member may call it; the route is in the permission matrix with
  `200` for both roles. It takes the family lock first, like every mutation,
  and is one transaction per call.
- At most 500 rows a call. It is **not** ⟳: sending the same rows again leaves
  the server as it was *(RS-2)*, so a retry needs no key.
- Each `row` has the shape `/sync` gives for that entity *(04 §2)*, checked
  with the same bounds as the bodies of that entity's routes, and through the
  shared body rules (U+0000, non-finite numbers). A `walk_routes` row is
  `{ "walk_id", "points" }`, its points those of `04` §12 —
  `[lat, lon, t, acc]`, at most 5 000. A `members` row has no route of its
  own to borrow bounds from: its `display_name` is 1 to 40 characters and its
  `color` one of the eight identity keys *(`03` §2)*. The family is always
  the caller's; a `family_id` is neither sent nor read. `revision` is
  ignored.
- Every row counts in exactly one of `inserted`, `updated`, `unchanged` and
  `refused`. `duplicates` is apart: the completions this call turned into a
  duplicate.
- Entities, applied in this order whatever order they arrive in:
  `members`, `family`, `pets`, `task_templates` (a template after the one it
  replaces), `weight_entries`, `health_events`, `task_completions`,
  `task_timers`, `walk_sessions`, `walk_routes`. Among completions, those
  with no `duplicate_of` go first. `assets` is not accepted: files arrive
  through `PUT /assets/{id}` (§4.4).
- A row whose id belongs to another family, or that names a pet, template or
  member the server does not have after this call's earlier entities were
  applied, is **refused**: counted, skipped, nothing of the other family
  shown *(RS-10)*. A refusal never fails the call.
- After the commit the family is poked *(`04` §7)*, as after any mutation,
  when the call inserted or updated anything; a call that left every row
  unchanged pokes nobody.

### 3.1 The rules

`S` is the server's row, `I` the incoming one. "Editable fields" are those a
route of `04` can change for that entity; everything else never changes.

Three rules apply to every entity, each on its own, so that the order in
which rows arrive cannot matter:

| What | Rule |
|---|---|
| The editable fields | those of the row with the newer `updated_at`; on an equal instant, the server's |
| `updated_at` | the newer of the two |
| The tombstone (`deleted_at`; `undone_at` with `undone_by`; `cancelled_at`) | set if either row has it, to the **earlier** of the two instants. **A tombstone is never undone** *(RS-3)* |

A row the server lacks is inserted as given — its attribution, its
`updated_at` — with a new revision. A row that these rules leave as it was
is `unchanged` and gets no new revision.

And these, for the entities that are more than fields:

| Entity | Rule |
|---|---|
| `walk_sessions` | the status, the metrics and the note — everything `finish` writes — are those of the row with the further status — `active` < `finished` < `discarded`; on an equal status, of the newer `updated_at`. `has_route` and `point_count` are not metrics and are never taken from the row: they say what **this** server stores, and only a `walk_routes` row sets them. A walk that arrives is stored with `false` and `0` until its route does |
| `walk_routes` | stored when the walk exists, is `finished` and has no route; sets `has_route` and `point_count`; otherwise unchanged |
| `task_completions` | when two live rows hold the same `(task, occurrence, pet)`, the one with the earlier `completed_at` (then the smaller id) stays live and the other becomes its duplicate *(§2.3, RS-4)*; every row that named the loser in `duplicate_of` now names the winner. After the commit each of the two authors is told that the other also marked it *(`04` §15)*. A `duplicate_of` naming a completion the server lacks after the call is stored as null |
| `family` | `name` and `timezone` only. Nothing deletes a family: a `deleted_at` the row carries is ignored |
| `members` | a member the server does not know becomes a *stub* (§5); a known one is never changed *(RS-5)* |

Archiving a pet is an editable field, not a tombstone: a pet can be
unarchived, so the newer change wins.

Two different versions of one row with the same `updated_at` could only come
from two servers stamping the same microsecond on the same row; the server's
stays, and no vector holds such a pair.

The merge is specified by vectors, not by prose alone:
`spec/fixtures/reseed-vectors.json` — each vector a server state, incoming
rows and the expected state *(`07` §3)*.

> **RS-1** After a reseed and the full pull that follows, every row the phone
> held without an outbox entry is on the server, or was counted as refused.
>
> **RS-2** The merge is idempotent and independent of order. Gate: every
> vector gives the expected state when its rows are sent once, twice, in
> reverse order, and one row per call. Inside a call the order of the rows
> never matters. From one call to the next a row must follow what it names
> — a completion its template, a duplicate its winner — which is the order
> a phone sends its batches in (§4.3): one row per call means in the entity
> order above.
>
> **RS-3** A tombstone is never undone: no vector, and no sequence of two
> reseeds, turns a deleted, undone or cancelled row live again.
>
> **RS-4** After any reseed there is at most one live completion per
> `(task, occurrence, pet)`. Of the completions that were live when a merge
> met them, the one with the earliest `completed_at` (then the smaller id)
> is the one left live; each of the others is undone, with `undone_by` null
> and `duplicate_of` naming it. A completion that a person undid is not a
> duplicate: it competes with nobody and its `duplicate_of` stays null.
>
> **RS-10** A row of another family in a reseed is refused: nothing is
> written, and the response carries nothing of that row.

---

## 4. The phone

Everything here extends `10`; the engine's cycle, the outbox and the pull are
unchanged unless said.

### 4.1 Two addresses

`EXPO_PUBLIC_API_URL` is the primary. `EXPO_PUBLIC_RESERVE_API_URL` is
optional; without it the app never looks for a second server (§4.2).
Arriving (§4.3) applies to the one server all the same: a primary restored
from a backup is brought up to date by the phones in the same way. Both
addresses are baked in at build time *(05 §8)*; there is no screen for them.

State that was one value becomes one per server:

| Was | Becomes |
|---|---|
| `kv.last_revision`, `kv.sync_epoch` | `kv.last_revision.primary` / `.reserve`, `kv.sync_epoch.primary` / `.reserve` |
| — | `kv.reseeded_epoch.primary` / `.reserve` — the epoch this phone last reseeded |
| — | `kv.active_server` — `primary` or `reserve` |
| the refresh and access tokens in `SecretBox` | one pair per server |
| `kv.push_token_sent` | one per server: the phone registers its push token with each server it arrives at |
| `kv.signed_out` | one per server: a session that ended on one says nothing about the other |

Wherever another file names one of these keys, or the session, it means the
active server's.

> **RS-9** A token, a cursor or an epoch of one server is never sent to the
> other, nor compared with one of the other.

### 4.2 Which server

- The app uses the **primary whenever it answers**.
- On the primary: after **three consecutive cycles that fail at the network
  level** (the request threw, timed out, or answered 502, 503 or 504),
  spanning at least 60 seconds, it asks the reserve's `/health`. `200` with
  `role: "reserve"` → switch.
- On the reserve: every 60 seconds it asks the primary's `/health`. **Three
  consecutive** `200` with `role: "primary"` → switch back.
- With no network at all the phone is offline, as today, and changes nothing.

> **RS-8** One failure never moves the phone, and one success never moves it
> back. Gate: scripted sequences of results through the fake `Http`, with the
> fake clock: two failures then a success stays; three failures inside 60
> seconds stays; three across 60 seconds with a healthy reserve switches; two
> healthy probes of the primary stay on the reserve; three return.

### 4.3 Arriving at a server

Whenever the phone starts using a server — a switch, or a first login — and
whenever that server's `epoch` is not the one in `kv.reseeded_epoch` for it:

```
arrive(server):
  kv.active_server = server
  if no usable session for this server: state = signed_out      -- §4.5
  read the server's epoch (GET /sync?since=<its cursor>&limit=1)
  reseed:  send every replica row that has no outbox entry — tombstones and
           rows older than 120 days included — and every cached walk route,
           in batches of 500, in the entity order of §3
  kv.reseeded_epoch.<server> = epoch;  kv.last_revision.<server> = 0
  full pull, marking each row it writes with this pull's generation
  when the pull has ended: remove the synced rows this pull did not mark
                           and that no outbox entry protects
  then drain the outbox, as in any cycle
```

- Rows with an outbox entry are not reseeded: their mutation is sent to the
  new server by the outbox, which is what its idempotency is for.
- **Nothing is removed before the pull has ended.** This replaces the
  "discard, then pull from zero" of `10` §5 and of PL-3: the result is the
  same replica, reached without ever holding less than before.
- A `/reseed` call that fails at the network level, or with a 5xx, stops
  `arrive`; the next cycle starts it again from the top, which is safe
  *(RS-2)*. A `401` is the session's (§4.5).
- A batch answered `422` is sent again one row a call. A row that alone is
  still `422` is logged — its entity and id, never its content — and left
  out, as a refused row is. One bad row never keeps a phone from arriving.
- With nothing to send — a first login on a new phone — no `/reseed` call
  is made.

> **RS-7** An interruption anywhere in `arrive` — between two reseed batches,
> between two pull pages, before the sweep — leaves the replica holding
> everything it held, and running `arrive` again completes it.

### 4.4 Photos and routes

After the pull of `arrive`, every file the phone holds whose asset the server
does not list goes back to `to_upload`; the upload loop sends it, and
`PUT /assets/{id}` is idempotent by id and hash. A photo that no phone holds
comes only from the reserve's backup.

### 4.5 Sessions

Each server has its own session. Arriving at a server with no usable session
is the `signed_out` state of `10` §8.1 for that server: the login screen, with
the replica and the outbox kept, and the note of `09`. After the same user
logs in, `arrive` continues. The reserve's refresh token expires like any
other, so the first switch in a long while asks for the password once.

Logout and a wipe *(`10` §8.1)* remove both servers' tokens and every
per-server key. Their two best-effort requests go to the active server only.

### 4.6 What the engine reports

The connection state of `10` §8 gains the server. On the reserve the
indicator reads `sincronizado · reserva` or `sincronizando (n) · reserva`.
`offline` and `signed_out` are unchanged.

---

## 5. Accounts stay on the primary

A phone holds no email but its user's, no hash and no token of anyone, so
accounts cannot be healed by phones. On the **reserve** these routes answer
`409 reserve_read_only` and write nothing:

`POST /invites` · `POST /auth/redeem` · `PATCH /me` · `POST /me/password` ·
`PATCH /family/members/{user_id}` · `DELETE /family/members/{user_id}`

Login, refresh, logout, `PUT`/`DELETE /me/push-token` and `PATCH /family`
work on both. The app disables the six actions on the reserve with the note
of `09`.

**Stubs.** A person who joined after a server's backup is unknown to it, yet
rows name them. From the `members` row a phone sends, the server — reserve or
primary — creates an `app_user` with that id, name and colour, the role
`member` whatever the row says, the email `stub+<id>@pawlaris.invalid` and a
password hash that verifies nothing. A stub exists so that history has an
owner; it cannot log in, and being a member it never counts as the family's
leader. On the reserve that person keeps working offline until the primary
returns. On a primary restored from a backup older than their arrival, they
need a new invite, and their earlier history stays under the stub.

> **RS-5** A reseed changes no account: no email, hash, name, role or
> `disabled_at` of an existing user, no invite, no token. The only user it
> can create is a stub: a member, with an address nobody can register and a
> hash no password matches.
>
> **RS-6** On the reserve each of the six routes answers
> `409 reserve_read_only` and the database is unchanged; on the primary the
> code never occurs.

`/health` gains `role`.

---

## 6. Running the reserve

Detailed in `05` §4.7 and §6, and built in P8; in outline:

- The owner's computer pulls the newest backup at logon and every six hours
  while it is on.
- One command restores it into a database of its own, starts the API with
  `SERVER_ROLE=reserve` and publishes it to the two phones through the
  tailnet *(profile C of `05` §4.4)*. One command stops it.
- The backup stays nightly. What it lacks, the phones bring.

---

## 7. What this does not do

- **It does not make accounts survive the primary.** Inviting, removing,
  changing a role and changing a password wait for it.
- **It does not sync the servers.** A server learns only what a phone brings.
- **It does not show one phone the other's work while they are on different
  servers.** That is the offline case, and the indicator says which server.
- **It does not protect a photo that no phone and no backup holds.**
- **It trusts the family.** A member can reseed rows attributed to another
  member. For two people who share five pets that is acceptable; it is
  decided, not overlooked *(ADR-038)*.
