# 05 — Architecture

## Stack

### Mobile (`apps/mobile`)

| Concern | Choice | Note |
|---|---|---|
| Framework | Expo, custom dev client, New Architecture on | Pin the SDK at `init`; do not guess a version |
| Language | TypeScript, `strict: true` | No `any` |
| Navigation | `expo-router` (typed routes) + `react-native-screens` | Native stack, not JS |
| Server state | TanStack Query + persisted cache | Cache-first render, background revalidate |
| Client state | Zustand | UI/session only — never server data |
| Local DB | `expo-sqlite` | Outbox, GPS points, upload queue |
| Animation | `react-native-reanimated` (latest stable) | Worklets, UI thread only |
| Gestures | `react-native-gesture-handler` | |
| Vector art | `lottie-react-native`, `react-native-svg` | CC0/owned assets only |
| Images | `expo-image` | `memory-disk`, `recyclingKey`, blurhash |
| Location | `expo-location` + `expo-task-manager` | Foreground service, typed |
| Camera | `expo-camera` + `expo-image-manipulator` | |
| Maps | `@maplibre/maplibre-react-native` | No API key — ADR-005 |
| Notifications | `expo-notifications` | Local + Expo Push |
| Secrets | `expo-secure-store` | Refresh tokens only |
| Haptics | `expo-haptics` | |

### API (`services/api`)

| Concern | Choice |
|---|---|
| Framework | FastAPI (async) |
| Server | Uvicorn, **1 worker** — ADR-002 |
| ORM | SQLAlchemy 2.x async + Alembic |
| Validation | Pydantic v2 |
| Auth | PyJWT + `argon2-cffi` |
| Package manager | `uv` |
| Lint / types | Ruff + `mypy --strict` |

### Shared (`packages/shared`)

Types generated from `spec/contracts/openapi.json`, plus the TypeScript half of
the recurrence engine. The Python half lives in `services/api/app/domain/`.
`make parity` proves they agree.

---

## Infrastructure — sized for 1 OCPU / 2 GB *(A-02)*

This is the real constraint. Every decision below follows from it.

```
                  Cloudflare Tunnel (free, no open ports, TLS included)
                                   │
                              ┌────▼────┐
                              │  Caddy  │  64 MB   proxy + static blobs
                              └────┬────┘
                         ┌─────────┴─────────┐
                    ┌────▼────┐         ┌────▼─────┐
                    │ FastAPI │ 384 MB  │  blobs/  │  local volume
                    │ 1 worker│         │  (ADR-006)│
                    └────┬────┘         └──────────┘
                    ┌────▼──────┐
                    │ PostgreSQL│ 512 MB
                    └───────────┘
             ~1 GB left for the OS, page cache, and the nightly dump
```

### Memory budget (enforced by `mem_limit` in compose)

```yaml
postgres: { mem_limit: 512m }
api:      { mem_limit: 384m }
caddy:    { mem_limit: 64m  }
```

### PostgreSQL tuning — required, not optional

```
shared_buffers        = 128MB
effective_cache_size  = 512MB
work_mem              = 4MB
maintenance_work_mem  = 64MB
max_connections       = 20
wal_compression       = on
```

Defaults assume far more RAM than exists and will OOM-kill under the nightly dump.

### Swap is mandatory

OCI micro instances ship with none. A single spike kills a process outright.
Provision **2 GB** before the first deploy:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10
```

### Never build on the VM

One core will thrash for many minutes and likely OOM. The pipeline is:

```
GitHub Actions (free) → build multi-arch image → push to GHCR (free)
                                                       │
                                     VM: docker compose pull && up -d
```

The VM only ever pulls. Deploy is `infra/deploy.sh` — pull, migrate, restart,
health-check, roll back on failure.

### Connection pool

`pool_size=5, max_overflow=5` against `max_connections=20`. Two users do not need
more, and an oversized pool is pure memory waste here.

---

## Security

- Argon2id, `m=19456, t=2, p=1` — tuned down from library defaults for this box
  *(A-12)*. Target ~200–300 ms per hash; benchmark on the actual VM.
- Access 15 min / refresh 30 days, rotating, family-revocable *(A-11)*.
- No public registration; invite codes only *(A-13)*.
- Login rate limit 5 / 15 min per account.
- Cloudflare Tunnel means **no inbound ports open** — no SSH, HTTP or Postgres
  exposed to the internet. This is a larger security win than any WAF.
- Upload validation on magic bytes, not the client's MIME.
- Postgres binds to the Docker network only, never `0.0.0.0`.
- Secrets in `.env` (gitignored) + GitHub Actions secrets. A pre-commit hook
  (`gitleaks`) blocks committed credentials.

## Observability *(A-24)*

- `GET /health`: db reachable, disk free, current revision, version, uptime.
- Structured JSON logs with a request id, `stdout`, captured by the Docker
  json-file driver with `max-size=10m, max-file=3` — **capped, because disk on
  this box is finite too**.
- In-app Diagnostics screen (§7 of `02-spec.md`) is the primary field debugger.
- No SaaS. Nothing here costs money or ships data off the box.

## Backup *(A-16)*

```
nightly 03:00 → pg_dump -Fc | age -r <pubkey> → backups/YYYY-MM-DD.dump.age
                14-day retention
                copied to a second location (dev machine / free remote)
weekly  → restore into a scratch database, assert row counts, alert on mismatch
```

An unverified backup is not a backup. The weekly restore job is the deliverable,
not the dump. Scheduled off-peak: it competes for the single core.

## Build & distribution *(A-20)*

- **Local builds are the default**: `npx expo run:android` / `eas build --local`
  on the Windows dev machine with Android Studio + JDK 17.
- EAS cloud builds are an occasional convenience, never a dependency.
- Distribution: **signed APK sideloaded to two phones**. No Google Play — which
  also avoids the Console fee and the background-location policy review entirely.
- The signing keystore is backed up alongside the database. Losing it means no
  more upgrades-in-place.

---

## Architecture Decision Records

### ADR-001 — Provider-portable, not OCI-native *(A-01)*
**Context:** OCI Always Free capacity is unreliable and idle instances are
reclaimed. **Decision:** plain Docker Compose, no cloud SDKs, storage behind an
adapter. OCI is one target among several. **Consequence:** migrating to any other
box is a restore, not a rewrite. **Cost:** we forgo managed conveniences we were
never going to pay for anyway.

### ADR-002 — One Uvicorn worker, images built off-box *(A-02)*
**Context:** 1 OCPU / 2 GB, no swap by default. **Decision:** single async worker;
container memory limits; mandatory swapfile; tuned Postgres; CI builds images,
the VM only pulls. **Consequence:** deploys need network but never CPU.
**Rejected:** Gunicorn with N workers — multiplies memory and contends on one core.

### ADR-003 — Recurrence rules, not materialized schedules *(A-03)*
**Context:** cron-generated tasks cannot exist on an offline phone.
**Decision:** occurrences are a pure function computed identically in TS and
Python, proven by golden vectors. The server stores only completions.
**Consequence:** the app works for 30 days with no server at all. **Cost:** the
same logic twice, which the parity gate makes safe.

### ADR-004 — Completions are idempotent events with a DB-enforced natural key *(A-04)*
**Context:** the whole point is preventing double-feeding.
**Decision:** `UNIQUE (task_id, occurrence_key, pet_id)`, `ON CONFLICT DO
NOTHING`, always `200` with the winning row, tombstones for undo.
**Consequence:** concurrent completion is a normal path, not an error.
**Rejected:** last-write-wins — erases who actually did the work, which is the
one fact the app exists to record.

### ADR-005 — MapLibre + OSM instead of Google Maps *(A-05)*
**Context:** `react-native-maps` on Android needs a billing-enabled GCP project.
**Decision:** MapLibre with OSM raster tiles and attribution. **Consequence:**
no credit card anywhere in the stack. **Cost:** slightly less polished tiles and
a less familiar API. Worth it — a card-gated dependency violates P1 outright.

### ADR-006 — Local volume for blobs, S3 behind an adapter *(A-01)*
**Context:** OCI Object Storage couples us to a provider for ~200 MB of photos.
**Decision:** Caddy serves a local volume; `StorageAdapter` has one other
implementation (S3-compatible) available but unused by default.
**Consequence:** photos are in the same backup as the database.

### ADR-007 — Two notification channels *(A-08)*
**Context:** local notifications cannot inform the *other* person.
**Decision:** local for scheduled reminders, Expo Push (free) for cross-user
events. **Consequence:** the headline feature actually works. **Correction:** the
PRD's premise that push costs money was simply wrong.

### ADR-008 — Revision cursor as the source of truth, WebSocket as an optimization *(A-10)*
**Context:** mobile sockets drop constantly. **Decision:** a monotonic
family revision sequence; gap detection forces a `/sync` reconcile; the socket
never authoritative. **Consequence:** the app is correct with the socket
permanently down. **Rejected:** trusting socket delivery — silent staleness is
worse than visible offline.

### ADR-009 — No PostGIS *(A-17)*
**Context:** no spatial query exists in the feature set. **Decision:** JSONB
routes, client-side haversine. **Consequence:** ~200 MB of RAM and a pile of ARM
build pain avoided on a 2 GB box. **Revisit if:** a real spatial query appears.

### ADR-010 — Timers are timestamps *(A-18)*
**Context:** background workers inherit Doze and OEM kills for nothing.
**Decision:** persist `ends_at`; derive remaining time at render; one local
notification. **Consequence:** correct across reboots and offline stretches, at
zero runtime cost.

### ADR-011 — Hand-built measured hero transition *(A-21)*
**Context:** Reanimated's shared-element API has churned and misbehaves in nested
navigators. **Decision:** `measure()` the source, animate an absolute overlay with
a worklet spring, hand off to the target screen. **Consequence:** deterministic,
upgrade-proof, testable. **Cost:** ~150 lines we own instead of an API we don't.

### ADR-012 — Family, roles and task assignment *(added 2026-09-14, after the spec pack)*
**Context:** the user specified a GoPuppy-style family system: a leader assigns
tasks to members, each member sees their own tasks, and the leader sees everyone's
but only behind a filter so the home screen stays clean.
**Decision:** `family` is the tenant; `app_user.role` is `leader | member`;
`task_template.assigned_to` is a nullable member (NULL = anyone). The dashboard
defaults to `scope=mine` **for every role**, and only leaders get the widening
filter. Membership lives on `app_user` rather than a join table because a user
belongs to exactly one family in v1 *(P7)*.
**Consequence:** this introduces the project's **first real privilege boundary**.
Every endpoint now needs a role check and a matrix test (`RB-1`, `RB-2`); the
route census is no longer just "is it authenticated" but "is it authorized".
That is a genuine increase in scope, accepted deliberately.
**Rejected:** giving leaders an all-tasks home by default — it recreates exactly
the clutter the feature exists to prevent.
**Deferred:** rotation (alternating assignees by day). The scalar `assigned_to`
can become an `assignment_rule` later without touching completions *(R3.1d)*.
**Resolved (OPEN-1, same day):** scoping is a **view filter, not an access
boundary**. Reads are family-wide; the role boundary covers **mutations only**.
So the added surface is narrower than first feared — no read-authorization layer,
no split of the pet's care history, and the cross-check that lets one person
confirm the other's medication dose survives intact. Anyone may complete anyone's
task, with `completed_by` recording who actually did it.

### ADR-013 — The conflict model is rescoped, not removed *(supersedes the framing of ADR-004)*
**Context:** with per-user assignment, the user correctly observed that two people
racing to complete the same task largely stops being the normal case.
**Decision:** keep the idempotent completion mechanism exactly as specified in
ADR-004 (natural key, `ON CONFLICT DO NOTHING`, always `200`, tombstones), but
restate *why* it exists. It is not primarily about two equal users colliding; it
is about making writes idempotent for four paths that assignment does not remove:
outbox retry after a lost response, leader override, unassigned tasks, and a
reassignment race.
**Consequence:** the mechanism is unchanged, so no code is affected. What changes
is the UX weighting — "Duda já alimentou às 07:12" moves from headline behavior to
an edge case, and the dashboard's primary job becomes *your* list, not the
family's.
**Rejected:** dropping the natural key and relying on assignment for uniqueness.
Retry alone would then create duplicate completions, and retry is unavoidable in
an offline-first app. This would have been a real data-integrity bug.

### ADR-014 — `pnpm verify` is the canonical harness entry point, not `make` *(P0-1)*
**Context:** the spec named `make verify` as the one command that decides done.
The Windows dev machine has no `make`, and Git Bash does not ship one. Requiring
a global GNU Make install would put friction directly in front of the single
command the whole method depends on — and P3 says the gate must be trivially
runnable or it stops being run.
**Decision:** `scripts/verify.mjs` (Node built-ins only, zero dependencies) is the
runner; `pnpm verify` is the canonical invocation. A thin `Makefile` delegates to
it so Linux, CI and muscle memory keep working.
**Consequence:** the gate runs identically on Windows and Linux with no extra
install, since Node is already a hard dependency. Every spec reference to
`make verify` should be read as `pnpm verify`; both work on Linux.
**Bonus:** the runner distinguishes **PENDING** (the gate's tooling does not exist
yet, with the implementing task id) from **FAIL** (it ran and broke). PENDING is
not success and still exits non-zero, which makes the backlog in `08-tasks.md`
self-enforcing rather than aspirational.

---

## Repository layout

```
Pawlaris/
├── CLAUDE.md
├── Makefile                  # verify, parity, contract-check, types, deploy
├── spec/                     # THE SPEC — read before writing code
│   ├── 00-constitution.md ... 08-tasks.md
│   ├── contracts/openapi.json
│   └── fixtures/recurrence-vectors.json
├── apps/mobile/
│   ├── app/                  # expo-router routes
│   ├── src/
│   │   ├── domain/           # pure logic — recurrence, metrics, occurrences
│   │   ├── sync/             # outbox, revision cursor, socket client
│   │   ├── features/         # pets, tasks, walks, health
│   │   ├── ui/               # design system, motion primitives
│   │   └── db/               # expo-sqlite schema + migrations
│   └── .maestro/             # E2E flows
├── services/api/
│   ├── app/
│   │   ├── domain/           # recurrence.py — mirrors packages/shared
│   │   ├── routers/ models/ schemas/ services/
│   │   └── main.py
│   ├── migrations/           # alembic
│   └── tests/
├── packages/shared/
└── infra/
    ├── docker-compose.yml  Caddyfile  deploy.sh  backup.sh  restore-verify.sh
    └── bootstrap.sh          # swap, docker, tunnel, seed users
```
