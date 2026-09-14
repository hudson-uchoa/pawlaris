# 03 — Data Model

PostgreSQL 16. No PostGIS *(A-17)*. All timestamps `timestamptz`, stored UTC.
All ids `uuid` generated client-side where the client originates the row (so
offline creation works without a server round-trip).

**Sizing reality:** 2 users, 5 pets, ~15 task templates, ~30 completions/day.
Ten years of data is well under 100 MB. Index for correctness, not for scale.

---

## 1. Sync primitives

Every syncable table carries:

```sql
revision    bigint NOT NULL DEFAULT nextval('family_revision_seq'),
updated_at  timestamptz NOT NULL DEFAULT now(),
deleted_at  timestamptz            -- soft delete; tombstones replicate
```

A single family-scoped sequence gives a **total order over all changes**.
`GET /sync?since=<revision>` returns everything with `revision > since` across
every table. This is the backbone of gap recovery *(A-10)*.

```sql
CREATE SEQUENCE family_revision_seq AS bigint START 1;
```

A trigger bumps `revision` and `updated_at` on every `INSERT`/`UPDATE`:

```sql
CREATE OR REPLACE FUNCTION bump_revision() RETURNS trigger AS $$
BEGIN
  NEW.revision   := nextval('family_revision_seq');
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

> **Invariant SY-1:** no row may be written without passing through this trigger.
> A harness test inserts directly into every syncable table and asserts the
> revision advanced.

---

## 2. Identity

```sql
CREATE TABLE family (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE family_role AS ENUM ('leader', 'member');   -- ADR-012

CREATE TABLE app_user (
  id            uuid PRIMARY KEY,
  family_id     uuid NOT NULL REFERENCES family(id),
  role          family_role NOT NULL DEFAULT 'member',
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,          -- Argon2id (A-12)
  display_name  text NOT NULL,
  avatar_color  text NOT NULL,          -- deterministic per-user accent
  push_token    text,                   -- Expo push token (A-08)
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);
CREATE INDEX ON app_user (family_id) WHERE disabled_at IS NULL;
```

Membership lives on `app_user` rather than in a `family_member` join table because
a user belongs to exactly one family in v1 *(P7 — build for what exists)*. The
migration path is mechanical if that ever changes: move `family_id` and `role`
into a join table; nothing else in the schema references them.

> **Invariant FM-1:** a family must always retain at least one non-disabled
> `leader` *(R1.12)*. Enforced in the service layer inside the same transaction
> as the demotion/removal, and covered by a gate test that attempts to demote the
> last leader and asserts 409.

```sql

-- A-11: rotating refresh tokens with family-based theft detection
CREATE TABLE refresh_token (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  chain_id     uuid NOT NULL,        -- token lineage (NOT the family tenant)
  token_hash   text NOT NULL UNIQUE,    -- SHA-256 of the token; never the token
  expires_at   timestamptz NOT NULL,
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_token (user_id) WHERE revoked_at IS NULL;

-- A-13: closed family
CREATE TABLE invite_code (
  code         text PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES family(id),
  created_by   uuid NOT NULL REFERENCES app_user(id),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  used_by      uuid REFERENCES app_user(id)
);
```

> **Invariant ID-1:** `password_hash` and `token_hash` must never appear in any
> serialized response. Enforced by a harness test that walks every Pydantic
> response schema and fails on a field name matching `/(hash|password|secret)/i`.

---

## 3. Pets

```sql
CREATE TYPE species AS ENUM ('cat', 'dog');
CREATE TYPE pet_sex AS ENUM ('female', 'male', 'unknown');

CREATE TABLE pet (
  id           uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES family(id),
  name         text NOT NULL,
  species      species NOT NULL,
  sex          pet_sex NOT NULL DEFAULT 'unknown',
  breed        text,
  color        text,
  birthdate    date,
  microchip_id text,
  avatar_asset_id uuid REFERENCES asset(id),
  notes        text,
  sort_order   int NOT NULL DEFAULT 0,
  archived_at  timestamptz,             -- R2.2: archive, never delete
  revision     bigint NOT NULL,
  updated_at   timestamptz NOT NULL,
  deleted_at   timestamptz
);

CREATE TABLE weight_entry (
  id          uuid PRIMARY KEY,
  pet_id      uuid NOT NULL REFERENCES pet(id),
  weight_kg   numeric(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 120),
  measured_at timestamptz NOT NULL,
  note        text,
  created_by  uuid NOT NULL REFERENCES app_user(id),
  revision    bigint NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz
);
CREATE INDEX ON weight_entry (pet_id, measured_at DESC);

CREATE TYPE health_event_type AS ENUM
  ('vaccine','medication','vet_visit','symptom','procedure','other');

CREATE TABLE health_event (
  id            uuid PRIMARY KEY,
  pet_id        uuid NOT NULL REFERENCES pet(id),
  type          health_event_type NOT NULL,
  title         text NOT NULL,
  notes         text,
  occurred_at   timestamptz NOT NULL,
  next_due_at   timestamptz,            -- R2.10: drives upcoming + reminder
  attachment_asset_id uuid REFERENCES asset(id),
  created_by    uuid NOT NULL REFERENCES app_user(id),
  revision      bigint NOT NULL,
  updated_at    timestamptz NOT NULL,
  deleted_at    timestamptz
);
CREATE INDEX ON health_event (pet_id, occurred_at DESC);
CREATE INDEX ON health_event (next_due_at) WHERE next_due_at IS NOT NULL;
```

---

## 4. Tasks and recurrence *(A-03 — the core correction)*

```sql
CREATE TYPE task_category AS ENUM
  ('feeding','medication','hygiene','litter','play','vet','other');
CREATE TYPE completion_mode AS ENUM ('together','per_pet');   -- A-19
CREATE TYPE reminder_class  AS ENUM ('critical','routine');   -- A-09

CREATE TABLE task_template (
  id            uuid PRIMARY KEY,
  family_id  uuid NOT NULL REFERENCES family(id),
  title         text NOT NULL,
  description   text,
  category      task_category NOT NULL DEFAULT 'other',

  -- Recurrence: a RULE, never materialized rows. No cron. (A-03)
  recurrence    jsonb NOT NULL,
  times_of_day  text[] NOT NULL DEFAULT '{}',   -- ['07:00','19:00'] local time
  starts_on     date NOT NULL,
  ends_on       date,

  -- ADR-012: NULL means "anyone in the family may do it".
  -- Only a leader may set this to someone other than themselves (R3.1b).
  assigned_to   uuid REFERENCES app_user(id),

  completion_mode completion_mode NOT NULL DEFAULT 'together',
  requires_photo  boolean NOT NULL DEFAULT false,
  timer_seconds   int CHECK (timer_seconds IS NULL OR timer_seconds > 0),
  reminder_class  reminder_class NOT NULL DEFAULT 'routine',

  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_by  uuid NOT NULL REFERENCES app_user(id),
  revision    bigint NOT NULL,
  updated_at  timestamptz NOT NULL,
  deleted_at  timestamptz
);

CREATE TABLE task_pet (
  task_id uuid NOT NULL REFERENCES task_template(id) ON DELETE CASCADE,
  pet_id  uuid NOT NULL REFERENCES pet(id),
  PRIMARY KEY (task_id, pet_id)
);
```

### 4.1 The `recurrence` shape

```jsonc
{ "freq": "daily",   "interval": 1 }
{ "freq": "weekly",  "interval": 1, "byday": ["MO","WE","FR"] }
{ "freq": "monthly", "interval": 1, "bymonthday": [1, 15] }
{ "freq": "once",    "date": "2026-10-03" }
```

Deliberately a **strict subset of RFC 5545** — enough for a family, small
enough to implement twice and prove equal.

### 4.2 The occurrence function

```
occurrences(recurrence, times_of_day, starts_on, ends_on, tz, from, to)
    -> OccurrenceKey[]
```

Pure. No I/O. No ambient clock. Implemented in:

- `packages/shared/src/recurrence.ts`
- `services/api/app/domain/recurrence.py`

`occurrence_key` format *(R3.8)*:

| `times_of_day` | Key                | Example            |
|----------------|--------------------|--------------------|
| 0 or 1 entry   | `YYYY-MM-DD`       | `2026-09-14`       |
| 2+ entries     | `YYYY-MM-DDTHH:mm` | `2026-09-14T19:00` |

> **Invariant RC-1:** both implementations MUST return identical arrays for every
> vector in `spec/fixtures/recurrence-vectors.json`. Gate: `make parity`.
>
> **Invariant RC-2:** the function MUST be a pure function of its arguments.
> Calling it twice with the same input MUST yield identical output; it MUST NOT
> read the system clock. Gate: a frozen-clock test at three different fake
> "now"s asserting identical results.
>
> Vectors MUST include: midnight boundaries, month ends (28/29/30/31), leap day,
> the `starts_on`/`ends_on` edges, and a DST-observing timezone
> (`America/New_York`) to prove the logic is not accidentally-correct in a
> DST-free country *(A-23)*.

---

## 5. Completions *(A-04, rescoped by ADR-013 — idempotent writes)*

Assignment *(ADR-012)* removes the everyday two-user race, but not the need for
an idempotent write: an outbox retry after a lost response, a leader override, an
unassigned task, and a reassignment race all still produce a second write against
the same occurrence *(02-spec.md §3.3)*. The natural key below is what makes all
four harmless.


```sql
CREATE TABLE task_completion (
  id                uuid PRIMARY KEY,
  task_id           uuid NOT NULL REFERENCES task_template(id),
  occurrence_key    text NOT NULL,
  pet_id            uuid REFERENCES pet(id),   -- NULL when mode = 'together'
  completed_by      uuid NOT NULL REFERENCES app_user(id),
  completed_at      timestamptz NOT NULL,
  photo_asset_id    uuid REFERENCES asset(id),
  note              text,

  undone_at         timestamptz,               -- R3.15: tombstone, not delete
  undone_by         uuid REFERENCES app_user(id),

  client_mutation_id uuid NOT NULL UNIQUE,     -- R3.12: replay = no-op
  revision          bigint NOT NULL,
  updated_at        timestamptz NOT NULL
);

-- The conflict rule, enforced by the database, not by application code.
-- COALESCE gives 'together' completions a stable non-null pet slot.
CREATE UNIQUE INDEX task_completion_natural_key
  ON task_completion (task_id, occurrence_key,
                      COALESCE(pet_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX ON task_completion (occurrence_key);
CREATE INDEX ON task_completion (completed_at DESC);
```

**Write path (the only accepted implementation):**

```sql
INSERT INTO task_completion (...) VALUES (...)
ON CONFLICT ON CONSTRAINT task_completion_natural_key DO NOTHING
RETURNING *;
-- If no row returned, SELECT the existing row and return it with HTTP 200.
```

> **Invariant CP-1:** the endpoint MUST never return 409. Two concurrent
> completions of the same occurrence both return 200 with the *same* row.
> Gate: a concurrency test firing 10 parallel requests and asserting exactly one
> row exists and all 10 responses are identical.
>
> **Invariant CP-2:** replaying the same `client_mutation_id` MUST return the
> same row and create nothing. Gate: a test that posts the same payload 5 times.
>
> **Invariant CP-3:** un-completing sets `undone_at`. A row is *logically*
> complete iff `undone_at IS NULL`. No query may treat presence-of-row as done.

---

## 6. Timers *(A-18 — a timestamp, not a process)*

```sql
CREATE TABLE task_timer (
  id             uuid PRIMARY KEY,
  task_id        uuid NOT NULL REFERENCES task_template(id),
  occurrence_key text NOT NULL,
  started_at     timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,     -- the entire mechanism
  cancelled_at   timestamptz,
  started_by     uuid NOT NULL REFERENCES app_user(id),
  revision       bigint NOT NULL,
  updated_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX ON task_timer (task_id, occurrence_key)
  WHERE cancelled_at IS NULL;
```

> **Invariant TM-1:** no background process, worker, or foreground service may
> exist for timers. Remaining time is `ends_at - now()`, computed at render.
> Gate: a test that starts a timer, simulates a cold restart, and asserts the
> remaining time is still correct.

---

## 7. Walks

```sql
CREATE TYPE walk_status AS ENUM ('active','paused','finished','discarded');

CREATE TABLE walk_session (
  id           uuid PRIMARY KEY,
  pet_id       uuid NOT NULL REFERENCES pet(id),
  user_id      uuid NOT NULL REFERENCES app_user(id),
  status       walk_status NOT NULL DEFAULT 'active',
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  paused_ms    bigint NOT NULL DEFAULT 0,      -- R4.13: excluded from elapsed
  distance_m   numeric(10,2) NOT NULL DEFAULT 0,
  duration_s   int NOT NULL DEFAULT 0,
  avg_pace_s_per_km int,
  route        jsonb NOT NULL DEFAULT '[]',    -- [[lat,lon,t,acc],...] (A-17)
  point_count  int NOT NULL DEFAULT 0,
  note         text,
  client_mutation_id uuid NOT NULL UNIQUE,
  revision     bigint NOT NULL,
  updated_at   timestamptz NOT NULL,
  deleted_at   timestamptz
);

-- R4.8: only one walk in flight
CREATE UNIQUE INDEX walk_single_active
  ON walk_session (pet_id) WHERE status IN ('active','paused');

CREATE INDEX ON walk_session (pet_id, started_at DESC);
```

**Client-side only** (SQLite, never uploaded raw) *(A-07)*:

```sql
-- Every fix lands here the instant it arrives. Durability against OEM kills.
CREATE TABLE local_walk_point (
  walk_id   TEXT NOT NULL,
  seq       INTEGER NOT NULL,
  lat       REAL NOT NULL,
  lon       REAL NOT NULL,
  t         INTEGER NOT NULL,   -- epoch ms
  acc       REAL NOT NULL,
  PRIMARY KEY (walk_id, seq)
);
```

> **Invariant WK-1:** a GPS fix MUST be persisted before it is aggregated.
> Gate: a test that feeds 100 points, kills the store mid-stream, reopens, and
> asserts ≥99 points survived.
>
> **Invariant WK-2:** points with `acc > 30` are excluded from distance but kept
> in `route`. Gate: a test with an injected 500 m-accuracy outlier asserting the
> distance does not jump *(R4.10)*.
>
> **Invariant WK-3:** the route is downsampled (Douglas–Peucker, 5 m) before
> upload. Gate: a 2 000-point route must serialize to under 100 KB.

---

## 8. Assets *(A-14)*

```sql
CREATE TYPE asset_kind AS ENUM ('pet_avatar','task_proof','health_attachment');

CREATE TABLE asset (
  id           uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES family(id),
  kind         asset_kind NOT NULL,
  storage_key  text NOT NULL,          -- opaque; adapter resolves it (A-01)
  mime         text NOT NULL,
  bytes        int NOT NULL,
  width        int,
  height       int,
  sha256       text NOT NULL,          -- dedupe + integrity
  uploaded_by  uuid NOT NULL REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON asset (sha256);
```

**Client-side upload queue** (SQLite):

```sql
CREATE TABLE local_upload_queue (
  id           TEXT PRIMARY KEY,   -- becomes the server asset id
  local_uri    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at   INTEGER NOT NULL
);
```

> **Invariant AS-1:** a completion may reference an asset id that does not yet
> exist server-side. The server MUST accept it and reconcile when the upload
> lands. Completion never blocks on upload *(R3.29)*.
>
> **Invariant AS-2:** assets referenced by nothing for over 7 days are swept.
> Gate: a test creating an orphan, running the sweeper, asserting removal — and
> a second asserting a *referenced* asset survives.

---

## 9. Outbox (client-side)

```sql
CREATE TABLE local_outbox (
  client_mutation_id TEXT PRIMARY KEY,
  endpoint      TEXT NOT NULL,
  method        TEXT NOT NULL,
  payload       TEXT NOT NULL,        -- JSON
  created_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  last_error    TEXT
);
```

> **Invariant OB-1:** the outbox drains in `created_at` order and survives
> restarts. Gate: queue 20 mutations offline, restart the app, go online, assert
> all 20 applied exactly once and in order.

---

## 10. Migrations

Alembic, one migration per task, never edited after merge. Every migration MUST
have a tested `downgrade()`. Gate: CI runs `upgrade head` → `downgrade base` →
`upgrade head` on a scratch database.

## 11. Entity map

```
family ──┬── app_user ──── refresh_token
            │              └── invite_code
            ├── pet ──┬── weight_entry
            │         ├── health_event ──── asset
            │         └── walk_session
            ├── task_template ──┬── task_pet ──── pet
            │                   ├── task_completion ──── asset
            │                   └── task_timer
            └── asset
```
