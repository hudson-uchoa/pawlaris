# 05 — Architecture

## 1. Stack

### Mobile (`apps/mobile`)

| Concern | Choice | Note |
|---|---|---|
| Framework | Expo, custom dev client, New Architecture, Hermes | Pin the SDK at init; record versions in `docs/versions.md` |
| Language | TypeScript, `strict: true` | No `any` |
| Navigation | `expo-router` (typed routes), native stack | |
| Replica + UI state | Zustand | The replica store is the app's data layer *(ADR-020)* |
| Local DB | `expo-sqlite` (synchronous API) | Replica, outbox, GPS points, asset files |
| Network status | `@react-native-community/netinfo` | |
| Animation | `react-native-reanimated` (current major, New Architecture) | Every animated value; worklets on the UI thread |
| Canvas effects | `@shopify/react-native-skia` | Star fields, particles, gradients, trails *(ADR-031)* |
| Gestures | `react-native-gesture-handler` | |
| Lists | `@shopify/flash-list` | History lists. The dashboard uses Reanimated's `Animated.FlatList` *(06 §1.3)* |
| Vector shapes | `react-native-svg` | Icons, the weight chart, route thumbnails |
| Icons | `lucide-react-native` | Tree-shaken outline icons |
| Fonts | `expo-font` (config plugin) | Space Grotesk embedded at build time; Roboto is the system font |
| Images | `expo-image` | Always from local `file://` URIs |
| Camera / picker | `expo-camera`, `expo-image-picker`, `expo-image-manipulator` | |
| Files / crypto | `expo-file-system`, `expo-crypto` | UUIDs and SHA-256 |
| Location | `expo-location` + `expo-task-manager` | Foreground service, type `location` |
| Maps | `@maplibre/maplibre-react-native` | No API key *(ADR-005)* |
| Notifications | `expo-notifications` | Local + Expo Push |
| Secrets | `expo-secure-store` | The refresh token only |
| Device | `expo-haptics`, `expo-device`, `expo-battery`, `expo-intent-launcher`, `expo-sharing`, `expo-clipboard` | |
| Date/time input | `@react-native-community/datetimepicker` | |
| Tests | Jest (`jest-expo`) + React Native Testing Library; `sql.js` as the SQLite test driver | |

Not used, on purpose: Lottie (or any pre-rendered animation format), TanStack
Query, AsyncStorage, any date library, any form library, any charting library,
any bottom-sheet library, any i18n library, any UI kit. Each one would cost
weight for something the three motion libraries and plain components already
do *(pillar 3)*.
Adding a dependency that is not in this table needs an orchestrator decision.

### API (`services/api`)

| Concern | Choice |
|---|---|
| Framework | FastAPI (async), Pydantic v2, `pydantic-settings` |
| Server | Uvicorn, **1 worker** *(ADR-002)* |
| Database | PostgreSQL 16, SQLAlchemy 2.x async, `asyncpg`, Alembic |
| Auth | PyJWT (HS256) + `argon2-cffi` |
| Uploads | Pillow (header validation only); the body is read as a raw stream — no multipart |
| Timezones | `zoneinfo` + the `tzdata` package (Windows ships no IANA database) |
| Outbound HTTP | `httpx` (Expo push) |
| Tooling | `uv`, Ruff, `mypy --strict`, pytest + `pytest-asyncio` + `pytest-cov` |
| Python | 3.12 |

### Shared (`packages/shared`)

Pure TypeScript with no React Native imports: the recurrence engine, timezone
functions, the day-view builder, the reminder planner, walk math, validators,
and the API types generated from `spec/contracts/openapi.json`. Tested with
Vitest on Node. This is where the app's logic lives; `apps/mobile` is storage,
transport and pixels around it.

---

## 2. Server structure

```
services/api/
├── pyproject.toml  alembic.ini  Dockerfile
├── app/
│   ├── main.py            create_app(): routers, error handlers, lifespan
│   ├── settings.py        Settings (env) — see §2.2
│   ├── clock.py           Clock protocol, SystemClock, FrozenClock
│   ├── db.py              engine, session factory, get_session dependency
│   ├── errors.py          ApiError + problem+json handlers (04 §1.1)
│   ├── deps.py            current_user, require_leader, get_clock, after_commit
│   ├── idempotency.py     the wrapper of 03 §9
│   ├── security/          passwords.py  tokens.py  ratelimit.py
│   ├── models/            SQLAlchemy models, one module per table group
│   ├── schemas/           Pydantic request/response models (04 §2)
│   ├── routers/           auth  family  sync  pets  tasks  completions  timers
│   │                      walks  assets  health  ws
│   ├── services/          business rules called by routers
│   ├── storage/           StorageAdapter protocol + LocalStorage
│   ├── realtime.py        in-process socket hub (poke)
│   ├── push.py            Expo push sender
│   ├── cli.py             bootstrap, maintenance
│   └── export_openapi.py  prints the OpenAPI document
├── migrations/            alembic
└── tests/                 conftest.py  db/  auth/  api/  sync/  security/
```

### 2.1 Rules

- **Time:** application code never calls `datetime.now()` / `utcnow()`. It asks
  the injected `Clock`. Tests override the dependency with `FrozenClock`. The
  only use of the database's `now()` is in the revision trigger and the
  `created_at` defaults, which no test asserts on. Gate: Ruff rule `DTZ` plus a
  test that greps `app/` for `datetime.now` and `utcnow` outside `clock.py`.
- **Layers:** routers parse and authorize; services hold rules and touch the
  session; models are data. Routers do not write SQL.
- **Family scoping:** every query filters by the caller's `family_id`. A helper
  `get_owned(session, Model, id, user)` returns the row or raises 404; routers
  never fetch by id without it.
- **After commit:** pokes and pushes must not fire for a transaction that rolls
  back, and must not fire before it commits. Handlers register callbacks
  through the `after_commit` dependency; `transactional` runs them right after
  the commit — never through Starlette `BackgroundTasks`. A poke is awaited
  inline (it is local and fast). A push is started with `asyncio.create_task`
  and not awaited, so Expo's response time never adds to the request *(R5.9)*;
  the task is kept in a set until it finishes. A failure in a callback is
  logged and never changes the response.
- **No documentation routes.** `create_app()` passes `docs_url=None,
  redoc_url=None, openapi_url=None`; `export_openapi.py` calls `app.openapi()`.
- **One transaction per request, committed before the response exists.** Do
  not rely on dependency teardown to commit: in current FastAPI the code after
  a dependency's `yield` runs after the response has been sent, so a phone
  could be told `200` for a write that then fails to commit. Every mutating
  route runs its body through one helper, `transactional(session, fn)` (the
  idempotency wrapper calls it for ⟳ routes): it runs `fn`, **commits**, then
  runs the after-commit callbacks, and only then is the response returned. A
  commit failure is a `500`. `get_session` teardown only closes the session,
  rolling back anything left uncommitted. The single exception that commits
  and still answers with an error is refresh-chain revocation *(04 §3)*.
- **The family lock comes first.** Every mutation calls `lock_family` before it
  checks or writes anything *(03 §1.2)*.
- **CPU-bound work leaves the event loop.** Argon2 runs in a thread behind a
  semaphore of 2. Image validation runs in a thread.
- **Latency *(R5.9)*:** a handler issues a small, fixed number of queries — no
  query inside a loop over rows. Responses over 1 KB are gzip-compressed
  (`GZipMiddleware`). The request log's `ms` field is the measurement; Argon2
  runs only on login, redeem and password change.

### 2.2 Settings (environment)

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…` | — required |
| `JWT_SECRET` | HS256 key, ≥ 32 bytes | — required |
| `BLOB_DIR` | directory for asset files | `/data/blobs` |
| `PUSH_ENABLED` | send Expo pushes | `true` |
| `APP_VERSION` | reported by `/health` | `dev` |
| `LOG_LEVEL` | | `INFO` |
| `WS_AUTH_TIMEOUT_SECONDS` | time allowed for the socket's `auth` frame | `5` |
| `WS_SWEEP_SECONDS` | interval of the socket token-expiry sweep | `30` |

`.env.example` is committed; `.env` never is.

---

## 3. Mobile structure

```
apps/mobile/
├── app.config.ts          permissions, plugins, EXPO_PUBLIC_API_URL
├── index.ts               entry: imports the background-task modules, then `expo-router/entry`
├── app/                   expo-router routes (09 §1) — routes and layouts ONLY, no tests
├── __tests__/             screen-level tests (never inside app/)
├── src/
│   ├── db/                driver, migrations, repos            (10 §1)
│   ├── replica/           store, apply, selectors              (10 §2)
│   ├── api/               client, errors
│   ├── auth/              session, secure store
│   ├── sync/              mutations, outbox, pull, socket, engine   (10 §3–§8)
│   ├── assets/            upload queue, download cache         (10 §7)
│   ├── notifications/     channels, reconcile, push handling   (09 §9)
│   ├── walks/             permissions, tracking task, point store, recovery
│   ├── features/          shell/ auth/ pets/ tasks/ dashboard/ health/ walks/ family/ settings/
│   ├── ui/                tokens/ motion/ primitives/ cosmos/
│   ├── i18n/              strings.ts, format.ts
│   ├── platform/          production Clock, Random, IdGen, logger
│   └── perf/              the startup marker
├── assets/                app icon, splash, fonts/ (+ LICENSES.md)
└── .maestro/              E2E flows
```

**The entry file matters.** Background tasks (location fixes, the push that
cancels a reminder) can start the JS runtime with no UI. A task defined inside
a route or layout module does not exist then, because expo-router evaluates
those only when the tree renders. So `package.json` `main` is `index.ts`,
which imports `src/walks/task` and `src/notifications/backgroundTask` — each
calling `TaskManager.defineTask` at module scope — and then imports
`expo-router/entry`.

`features/*` contain screens' components and hooks. They import from
`replica/selectors`, `sync/mutations`, `ui/` and `@pawlaris/shared` — never
from `db/`, `api/` or `sync/outbox` directly *(10 §9)*. An ESLint
`no-restricted-imports` rule enforces it.

---

## 4. Infrastructure

The box does not exist yet. The stack is sized so it runs on the **smallest**
candidate — 1 vCPU and **1 GB** of RAM — and simply has headroom on anything
bigger *(ADR-025)*.

**Where the box lives matters for latency *(pillar 2)*.** Network round-trip is
most of what a phone waits for, so the box goes as close to the family as
possible: a cloud region in São Paulo, or a machine on the home network. A
free VM on another continent adds 150–250 ms to every request and is the wrong
trade.

```
        phones ──HTTPS/WSS──►  ingress  ──►  api (FastAPI, 1 worker)  ──►  postgres
                               (profile)        │
                                                └──►  /data/blobs  (local volume)
```

### 4.1 Compose services and memory limits

```yaml
postgres:    { mem_limit: 256m }
api:         { mem_limit: 256m }
cloudflared: { mem_limit: 64m, profiles: [tunnel] }   # ingress option A
caddy:       { mem_limit: 64m, profiles: [caddy] }    # ingress option B
```

About 580 MB committed, leaving ~400 MB for the OS and page cache on a 1 GB box.

### 4.2 PostgreSQL tuning — required

```
shared_buffers        = 64MB
effective_cache_size  = 192MB
work_mem              = 2MB
maintenance_work_mem  = 32MB
max_connections       = 15
wal_compression       = on
```

API pool: `pool_size=4, max_overflow=2`.

### 4.3 Swap is mandatory

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
```

### 4.4 Ingress — one of three profiles, chosen at deploy time

| | A — `tunnel` | B — `caddy` | C — `tailnet` |
|---|---|---|---|
| What | Cloudflare Tunnel → `api:8000` | Caddy on 80/443 with Let's Encrypt → `api:8000` | Tailscale on the box and on both phones; `tailscale serve` → `api:8000` with a `*.ts.net` certificate |
| Needs | a domain whose DNS is on Cloudflare | a free DuckDNS name, a **public IPv4**, ports 80 and 443 reachable from the internet | the Tailscale app, always on, on both phones (free personal plan, no card) |
| Inbound ports | none | 80, 443 | none |
| Works behind CGNAT | yes | **no** | yes |
| Pick when | the family already owns a domain | the box has a real public address and there is no domain | no domain and no public address — the usual case for a machine at home |

All three terminate TLS before the API; the API itself speaks plain HTTP on the
Docker network only. None exposes Postgres. All cap the request body at 10 MB
where the proxy allows it (Caddy: `request_body { max_size 10MB }`); the API's
own 8 MB check is authoritative.

Profile B also needs the DuckDNS updater (a five-minute systemd timer calling
the DuckDNS update URL), which `infra/` provides.

SSH stays reachable on port 22 with **key-only** authentication
(`PasswordAuthentication no`) — over the tailnet in profile C. That is how
deploys and backup pulls happen.

### 4.5 Images are never built on the box

```
GitHub Actions → build linux/amd64 + linux/arm64 → push ghcr.io/<owner>/pawlaris-api:<sha> and :stable
                                                                │
                                              box: infra/deploy.sh <tag>
```

The image is pulled from GHCR. A public package needs no credentials; a private
one needs a read-only token on the box (`docker login ghcr.io`) — an owner
prerequisite. If CI is ever unavailable, the documented fallback is to build on
the box (`docker compose build`, slow, with swap) — an exception, never the
routine.

`deploy.sh <tag>`: record the running tag → `docker compose pull` → run
`alembic upgrade head` in a one-off container (abort on failure, nothing
restarted) → `docker compose up -d` → poll `$HEALTH_URL` (default
`http://localhost:8000/api/v1/health`) for up to 60 s → on
failure, restore the recorded tag and `up -d` again, exit non-zero. It is run by
hand over SSH. Migrations must be backward compatible with the previous image
(add first, remove in a later release), so an image rollback is always safe.

### 4.6 Scheduled jobs on the box

A systemd timer, not an application scheduler, runs `infra/nightly.sh` at 03:30
family time:

1. `backup.sh` (§6)
2. `docker compose run --rm api python -m app.cli maintenance` — sweep
   unreferenced assets *(AS-2)*, delete refresh tokens expired for more than
   30 days, delete used or expired invites older than 30 days

"No cron" in this project means *no server-side scheduling of pet tasks*. Host
housekeeping on a timer is fine.

---

## 5. Security

- Argon2id, `m=19456, t=2, p=1`. Parameters are fixed by the spec; the hash
  time is measured on the box once (P8-1) and must be under 500 ms.
- Access 15 min; refresh 30 days, rotating, with a 60 s reuse grace *(ADR-024)*.
- No public registration; leader-issued invites only.
- Login rate limit: 5 failures per email per 15 min, in memory. A restart clears
  it, which is acceptable for two users.
- Tokens never appear in URLs or logs. The socket authenticates in a frame.
- Uploads are validated by decoding the image, never by the claimed MIME.
- Asset files are served by the API behind authentication, never as public
  static files.
- Postgres listens only on the Docker network.
- Secrets live in `.env` on the box (mode 600) and in GitHub Actions secrets.
  `gitleaks` runs in pre-commit and CI.
- Log lines never contain `Authorization` headers, tokens, passwords, or
  request bodies of `/auth/*`.

## 6. Backup and restore *(P8)*

`infra/backup.sh`, nightly:

```
1. pg_dump -Fc                       → tmp/db.dump
2. VERIFY before encrypting:
     count rows of every syncable table in the live DB        (before)
     createdb pawlaris_verify; pg_restore db.dump into it
     count the same tables in pawlaris_verify                 (restored)
     count the live DB again                                  (after)
     require before ≤ restored ≤ after for every table; dropdb pawlaris_verify
     any failure → exit non-zero, keep no archive, write status failed
3. tar db.dump + the blobs directory | age -r <public key>   → backups/YYYY-MM-DD.tar.age
4. sha256sum → backups/YYYY-MM-DD.tar.age.sha256
5. keep the newest 14 archives
6. write backups/last_backup.json { finished_at, bytes, verified: true }
```

- The dump is verified **before** encryption, so the private key never needs to
  be on the box. The private `age` key lives in the family's password manager.
- Photos are in the same archive as the database.
- **Second location:** `scripts/pull-backup.ps1` on the dev machine, weekly via
  Windows Task Scheduler: `scp` the newest archive and its checksum, verify the
  checksum, keep the newest 8, and fail loudly if `last_backup.json` is older
  than 48 h.
- **Restore** (`infra/restore.sh <archive> <age key file>`): decrypt, untar,
  `pg_restore` into an empty database, copy blobs into place, then
  `UPDATE server_meta SET sync_epoch = gen_random_uuid()` so every phone
  rebuilds its replica from the restored history *(03 §1.3)*. Changes made
  after the backup was taken are gone from the server; mutations still waiting
  in a phone's outbox are sent again.
- The release keystore is stored in the same password manager entry as the
  `age` key. Losing it means the phones can no longer upgrade in place.

## 7. Observability

- `GET /health` *(04 §14)*.
- JSON logs to stdout: `ts, level, msg, request_id, method, path, status, ms,
  user_id`. `X-Request-ID` is accepted or generated, and echoed.
- One timing middleware measures each request with a monotonic clock, writes
  `ms` to the log line and the same value to the `Server-Timing` response
  header *(04 §1, R5.9)*.
- Docker `json-file` driver with `max-size=10m, max-file=3`.
- On the phone: a rotating log file (256 KB) and the Diagnostics screen.
- No SaaS. Nothing here costs money or ships data off the box.

## 8. Build and distribution

- **Local builds are the default:** `npx expo run:android` for the dev client;
  `npx expo run:android --variant release` (or `eas build --local`) for release,
  on the Windows dev machine with Android Studio and JDK 17.
- EAS cloud builds are a convenience, never a dependency.
- Distribution: a **signed APK sideloaded to two phones**. No Google Play.
- Push needs a Firebase project (free, no card) with its `google-services.json`
  in `apps/mobile/` (git-ignored) and the FCM V1 service-account key uploaded
  to the Expo project (free Expo account) so Expo's push service can deliver.
- The API URL is baked in at build time from `EXPO_PUBLIC_API_URL`. When it
  starts with `http://` (development against the dev machine), `app.config.ts`
  enables cleartext traffic through `expo-build-properties`; with `https://` it
  does not.
- Release builds target `arm64-v8a` only — both phones are 64-bit ARM, and it
  halves the native libraries in the APK *(pillar 3)*.
- A release APK and a dev client are signed with different keys. Android will
  not install one over the other: uninstall first. The app's data is a replica,
  so nothing is lost beyond an outbox that should be empty before switching.

## 9. Development environment

Windows 11 Home, no Docker required for development *(ADR-030)*:

- Node 22 + pnpm; Python 3.12 + `uv`
- **PostgreSQL 16 installed natively**; tests connect with `TEST_DATABASE_URL`
  and create a throw-away database per test session
- JDK 17 + Android Studio (SDK, platform-tools/`adb`)
- Docker exists only in CI and on the box

`scripts/doctor.mjs` checks all of it and prints what is missing.

**No spaces in build paths.** The Android NDK and CMake tools used by the New
Architecture break on paths containing a space. The Android SDK lives at
`C:\Android\Sdk` (`ANDROID_HOME`), and the repository must be on a path without
spaces before the first Android build (P0-6) — for example `C:\dev\Pawlaris`.

**The dev shell is Windows PowerShell 5.1**, which has no `&&`. Commands in this
spec are written one per line; run them one at a time and stop at the first
non-zero exit.

---

## 10. Architecture Decision Records

ADR-001 … ADR-014 predate the second review (2026-10-03). Where a later ADR
changes one, the older one says so.

### ADR-001 — Provider-portable, not OCI-native
Plain Docker Compose, no cloud SDKs, storage behind an adapter. Moving to
another box is a restore, not a rewrite. *(Sizing and ingress: see ADR-025.)*

### ADR-002 — One Uvicorn worker, images built off-box
Single async worker; container memory limits; mandatory swap; tuned Postgres;
CI builds images, the box only pulls. The in-process socket hub *(ADR-019)*
depends on there being exactly one worker.

### ADR-003 — Recurrence rules, not materialized schedules
Occurrences are a pure function of the rule; the server stores rules and
completions and never materializes a schedule. *(Amended by ADR-015: the
function exists in TypeScript only.)*

### ADR-004 — Completions are idempotent events with a DB-enforced natural key
*(Restated by ADR-013 and made precise by ADR-017.)*

### ADR-005 — MapLibre + OSM instead of Google Maps
`react-native-maps` on Android needs a billing-enabled GCP project. MapLibre
with OSM raster tiles and attribution needs no account. The tile URL lives in
one constant.

### ADR-006 — Local volume for blobs
Asset files live on a local volume. *(Amended by ADR-023: served by the API,
not by a static file server; S3 is not implemented in v1.)*

### ADR-007 — Two notification channels
Local notifications for scheduled reminders; Expo Push for cross-user events.
*(Detailed by ADR-027.)*

### ADR-008 — Revision cursor as the source of truth
A per-family revision; the phone pulls `revision > cursor`; the socket is never
authoritative. *(Made precise by ADR-018 and ADR-019.)*

### ADR-009 — No PostGIS
No spatial query exists. Routes are JSONB; distance is computed on the phone.

### ADR-010 — Timers are timestamps
Persist `ends_at`; derive remaining time at render; one local notification.

### ADR-011 — Hand-built measured hero transition
Reanimated's shared-element API has churned. Measure the source, animate an
overlay, hand off to the target. Android has no interactive back; none is built.

### ADR-012 — Family, roles and task assignment
`family` is the tenant; `app_user.role` is `leader | member`;
`task_template.assigned_to` is a nullable member. Reads are family-wide; roles
restrict writes only. Scope on the dashboard is a client-side view filter.
*(Amended 2026-10-03: only leaders invite; "own task" means `created_by`.)*

### ADR-013 — The conflict model is rescoped, not removed
With assignment, two people racing is no longer the common case, but retry,
override, unassigned tasks and reassignment still write twice. The idempotent
mechanism stays.

### ADR-014 — `pnpm verify` is the canonical harness entry point
`scripts/verify.mjs`, Node built-ins only. The `Makefile` delegates to it.

### ADR-015 — The recurrence engine exists in TypeScript only *(2026-10-03)*
**Context:** the spec required a second, identical engine in Python and called
their parity "the most important gate". Nothing on the server ever evaluates a
rule: there is no schedule endpoint and completions are accepted as sent. Both
phones run the same TypeScript.
**Decision:** delete the Python engine and the TS↔Python parity gate. The
server validates a rule's *shape* and an `occurrence_key`'s *format*, nothing
more. The golden vectors stay and gate the TypeScript engine.
**Consequence:** half the work of the core phase disappears. The parity that
can actually bite — Node (tests) versus Hermes (device) — is covered by the
on-device Autoteste *(RC-3)*.
**Decided by:** the user, 2026-10-03.

### ADR-016 — Uniform occurrence keys; schedule edits fork the template
**Context:** the key format used to depend on how many times of day a template
had, and schedule fields were editable in place. Adding a second time, moving
08:00 to 09:00, or removing a pet orphaned existing completions and rewrote
which past days had occurrences.
**Decision:** the key is `date` for all-day templates and `dateTHH:mm` for any
template with times. Schedule fields are immutable. Changing them ends the
template and creates a successor (`replaces_task_id`), effective today if
nothing was completed today, else tomorrow. Pets are an array on the template.
Each completion snapshots the title.
**Consequence:** history is never rewritten; `task_pet` and its tombstones are
gone. **Cost:** a "rename the schedule" produces two rows; the Encerradas list
exists to keep them out of the way.

### ADR-017 — Completion write path
**Decision:** a partial unique index over live rows
(`NULLS NOT DISTINCT … WHERE undone_at IS NULL`); `INSERT … ON CONFLICT DO
NOTHING` with no conflict target; the first transaction to commit wins;
the loser gets `200` with the winner's row; undo is a tombstone and frees the
slot for a new completion; anyone in the family may undo.
**Rejected:** ordering by client `completed_at` — it needs trusted phone clocks
and a conditional upsert, for a case two people resolve by talking.
**Decided by:** the user (arrival order; anyone may undo), 2026-10-03.

### ADR-018 — The revision is a per-family counter row
**Context:** a sequence is not transactional: a lower number can commit after a
higher one, and a phone that already pulled past it never sees it.
**Decision:** `family_revision`, bumped by a `BEFORE INSERT OR UPDATE` trigger
with an upsert. The row lock serializes writers of a family until commit.
**Consequence:** revisions are commit-ordered. Write throughput per family is
one transaction at a time — irrelevant here.

### ADR-019 — The socket pokes; `/sync` is the only read path
**Decision:** the socket sends `{type:"poke", revision}` and nothing else. The
phone pulls. There are no per-resource `GET` endpoints.
**Consequence:** one code path applies server data; no gap arithmetic; no
entity payloads to keep in step with `/sync`. **Cost:** one extra request per
change, which two users will never notice.

### ADR-020 — The local replica is SQLite plus an in-memory store; no TanStack Query
**Context:** the original stack used TanStack Query's persisted cache for server
data and SQLite only for the outbox. In an offline-first app there is no
request whose response is being cached; the replica *is* the state.
**Decision:** every synced row lives in a generic SQLite `replica` table and in
a Zustand store hydrated synchronously at startup. The UI reads the store
through selectors.
**Consequence:** first render needs no async work; optimistic updates and
server data share one write path (`apply.ts`). This supersedes "Zustand never
holds server data".

### ADR-021 — One idempotency mechanism: `Idempotency-Key` + `applied_mutation`
**Decision:** every mutating request carries a client-generated key; the server
records it in the same transaction as the write and answers a replay with the
row's current state.
**Consequence:** `PATCH`, `DELETE`, undo and cancel are exactly-once too, not
only creates.

### ADR-022 — Outbox error taxonomy: retry, dead-letter, rebuild
**Decision:** transient failures retry in order with backoff; permanent
failures move to a dead-letter table and reset the pull cursor so the replica
converges on the server; an unrecoverable session pauses the outbox without
discarding it.
**Consequence:** one rejected mutation can never block the queue or leave the
phone showing a state the server refused.

### ADR-023 — Assets: soft references, no dedupe, served by the API, cached on the phone
**Decision:** asset references are plain ids with no foreign key, so a row may
name a photo before it is uploaded. No SHA-256 dedupe. The API streams files
behind auth. Phones render local files.
**Consequence:** completion never waits on an upload, and no photo is public.

### ADR-024 — Refresh rotation with a reuse grace window; single-flight on the phone
**Context:** on a flaky network the response to a refresh is often lost; the
retry presents a rotated token; strict reuse detection then signs the user out.
**Decision:** a rotated token presented again is honoured as long as no token
issued from it has been used; once one has, two parties hold the chain and it
is revoked. (A fixed 60-second window was rejected: a phone that loses the
response and then loses signal for two minutes is not a thief.) The phone
funnels all refreshes through one in-flight promise and keeps its access token
across restarts, so a cold start does not rotate at all.

### ADR-025 — Infra sized for 1 GB; two ingress profiles; verified backups include photos
**Context:** the box is not provisioned and its shape is unknown. OCI's AMD
micro shape has 1 GB; OCI asks for a card at sign-up; Cloudflare Tunnel needs a
domain on Cloudflare.
**Decision:** memory limits that fit 1 GB; ingress by Cloudflare Tunnel, by
Caddy + DuckDNS, or by a Tailscale tailnet (the only one that needs neither a
domain nor a public address); Caddy is in front of the API only in its own
profile;
backups contain database and blobs and are restore-verified before encryption.
**Consequence:** the stack runs on any small Linux box, including a spare
machine at home — the only path with no card anywhere.

### ADR-026 — Definition of done; orchestrator and implementer roles
**Context:** "`pnpm verify` fully green" could not be true for any task before
the last gate's task, so the rule was being waived from the first commit.
**Decision:** a task is done when its own gate passes **and**
`pnpm verify --allow-pending` reports zero failures. A release additionally
needs the strict `pnpm verify`. The implementer marks a task `[~]`; the
orchestrator reviews and marks `[x]`. Only the orchestrator edits `spec/`.
Work happens on one branch per phase (`phase/P2-server`), so a task's state
travels with the code and the next session sees it. Checks that need a phone
or the box are tracked separately from code acceptance (`Device: [ ]`), run by
whoever has the hardware — usually the owner — and are all required only for
the release.

### ADR-027 — Reminders: exact alarms, class by channel, two-message push
**Decision:** the manifest declares `USE_EXACT_ALARM` (and
`SCHEDULE_EXACT_ALARM` up to API 32), so reminders are exact without a runtime
prompt. `reminder_class` selects the notification channel. A completion push is
two messages: a visible one, and a data-only one that lets a background task
cancel the now-stale local reminder.
**Consequence:** the phone that was not opened stops reminding its owner about
a dose already given — best effort, since Android may not wake a force-stopped
app.

### ADR-028 — Performance gates use `adb`, with percentiles
**Decision:** startup from logcat timestamps; frames from `dumpsys gfxinfo`;
thresholds as jank percentage and a 99th percentile, on a release build.
**Rejected:** "zero dropped frames" and a 16 ms first-frame budget — neither is
measurable with free tooling, and both fail on noise.

### ADR-029 — Walks: no server-side uniqueness; pause is local
**Decision:** the server accepts any walk. "One at a time" is a per-device rule.
Pause state never leaves the phone; `finish` is an upsert.
**Consequence:** a walk recorded offline can never be rejected and lost.

### ADR-030 — Tests run against a native PostgreSQL; Docker only in CI and on the box
**Context:** the dev machine is Windows Home with no Docker.
**Decision:** API tests create a throw-away database on whatever PostgreSQL 16
`TEST_DATABASE_URL` points to.
**Consequence:** the server phase is unblocked on the dev machine as it is.

### ADR-031 — One identity, the night sky; Skia for effects; no Lottie *(2026-10-03)*
**Context:** the owner set the product pillars: stable, light, beautiful and
full of well-made motion built on modern, lean libraries, a stars-and-galaxies
identity, first-class light and dark themes. The spec until then described a
warm terracotta palette with Lottie celebrations and no theme of its own.
**Decision:** the identity is the night sky — deep space in dark, dawn in
light — specified in `06`. Motion uses three libraries: Reanimated (values),
Gesture Handler (input), Skia (drawing that views cannot do cheaply). Every
effect and illustration is drawn in code. Lottie is removed. Headings use
Space Grotesk, embedded; icons come from Lucide.
**Consequence:** effects follow the theme and Reduce Motion for free, weigh
kilobytes, and need no asset licences. **Cost:** Skia adds a few megabytes of
native code to the APK; the size budget in `06` §1 accounts for it.
**Rejected:** Lottie files — pre-rendered, theme-blind, licence-tracked, and a
fourth animation runtime. An SVG-only star field — hundreds of animated view
nodes for what Skia draws in three calls.
**Decided by:** the owner (pillars and theme); the orchestrator (libraries).

### ADR-032 — Latency is budgeted end to end *(2026-10-03)*
**Context:** "as responsive as possible" needs numbers or it is declared done
by whoever is tired.
**Decision:** three budgets, each with a gate: the tap resolves locally in the
same interaction (already true by design, ADR-020); the server answers
mutations and incremental syncs in under 100 ms at p95 on the box; a change
reaches the other phone within 3 s. The outbox and the pull are never
debounced. The box is placed near the family.
**Consequence:** the dominant remaining delay is one network round trip, which
no code can remove.
