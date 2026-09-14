# 00 — Constitution

Non-negotiable principles. Violating one is a defect, not a trade-off.
Amendments require an ADR in `05-architecture.md`.

## P1 — Zero cost is a correctness requirement

Every dependency must have a **documented permanent free tier** and a **named
fallback** if that tier disappears. No credit-card-gated services. No
"free until you grow" pricing. The fallback must be reachable by changing one
adapter, never by rewriting a feature.

| Concern   | Primary                      | Fallback (must stay one adapter away) |
|-----------|------------------------------|---------------------------------------|
| Compute   | OCI Always Free ARM A1 or AMD E2 micro        | Any x86/ARM VPS, or a spare machine at home — the stack is plain Docker Compose |
| Ingress   | Cloudflare Tunnel (free)      | Caddy + Let's Encrypt on an open port |
| DNS       | DuckDNS / Cloudflare (free)   | Any free DDNS                         |
| Blobs     | Local volume behind Caddy     | S3-compatible (OCI Object Storage / R2) |
| Push      | Expo Push (free, unlimited)   | Local notifications only (degraded)   |
| Maps      | MapLibre + OSM raster tiles   | Any MVT/raster tile source            |
| CI        | GitHub Actions free tier      | `pnpm verify` locally                 |

**Rule:** the app must be fully functional with *all* fallbacks active.

## P2 — The spec is the source of truth

Code is an implementation detail of the spec. If they disagree, the code is
wrong until an ADR says otherwise. Contract changes land *before* the code that
depends on them.

## P3 — No task is done until its gate is green

`pnpm verify` is the gate. There is no "works on my machine", no "will fix in
the polish pass", no manual verification substituting for a test.

## P4 — Offline-first, event-shaped

The phone is the primary replica. Every mutation is an **idempotent, replayable
event** with a client-generated ID. The server is a merge point, not a
gatekeeper. The UI must be fully usable in airplane mode for everything except
first login and photo *upload* (capture still works, upload queues).

## P5 — Deterministic time

Storage is UTC. Display is `America/Sao_Paulo`. Recurrence occurrences are a
**pure function** of (rule, timezone, date range) — computed identically in
TypeScript and Python, proven by shared golden vectors. Time is injected, never
read from a global, so every time-dependent test is frozen and deterministic.

## P6 — 60fps or it's a bug

Animations run on the UI thread (Reanimated worklets). Transitions render their
first frame within one frame budget. A dropped frame during a hero transition is
a defect with the same severity as a crash in the checkout of an e-commerce app —
because motion quality *is* the product here.

## P7 — Two users, five pets. Build for that.

Total lifetime data: well under 100 MB. No sharding, no read replicas, no
PostGIS, no message broker, no microservices, no Redis unless a gate proves it
is needed. Complexity that does not serve these 7 entities is waste.

## P8 — Reversible infrastructure

The entire backend must be reconstructible from `infra/` + one encrypted
`pg_dump`. A nightly restore-verification job proves the backup is real.
Losing the VM must cost an afternoon, not the data.

## P9 — Accessible and respectful

Respect `Reduce Motion` (crossfade fallback for every hero/spring). Minimum
44×44dp touch targets. WCAG AA contrast. Dynamic type up to 130% must not clip.

## P10 — Closed family

Registration is invite-only (seeded users + one-time invite codes). There is no
public sign-up. An open registration endpoint on a free-tier box is an abuse
vector, not a feature.

## The SDD loop

```
   ┌─ spec/02-spec.md  (WHAT, behavior, acceptance language)
   │
   ├─ spec/03-data-model.md + spec/contracts/  (the contract — changes land first)
   │
   ├─ RED: tests from the task's Acceptance Criteria
   │
   ├─ GREEN: minimum implementation
   │
   ├─ GATE: pnpm verify
   │
   └─ ADR on any deviation → back to the top
```
