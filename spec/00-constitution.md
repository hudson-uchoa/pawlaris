# 00 — Constitution

Non-negotiable principles. Violating one is a defect, not a trade-off.
Amendments require an ADR in `05-architecture.md`, written by the orchestrator.

## Pillars

What the owner wants the finished app to be. Every decision the spec does not
make for you is decided by these, in this order when they pull apart.

| # | Pillar | What it means here | Where it is enforced |
|---|---|---|---|
| 1 | **Stable** | It never loses a tap, a dose record or a walk. It never shows a state the server refused. It does not crash. | the invariants of `03`, `04`, `10`; the harness in `07` |
| 2 | **Instant** | A tap changes the screen in the same interaction, with no network in the way. The other phone knows within seconds. The server answers in milliseconds. | P4, P5; the latency budgets of `06` §1; R5.8, R5.9 |
| 3 | **Light** | Few dependencies, each the leanest modern choice for its job. A small APK, little memory, an idle JS thread when nothing is touched, a server that fits in 1 GB. | P1, P7; the size and memory budgets of `06` §1; the dependency list of `05` §1 |
| 4 | **Beautiful and alive** | A night sky: stars, orbits, constellations. Motion everywhere it means something, made well, on the UI thread, never at the cost of pillars 1–3. | P6; `06` §3–§5 |
| 5 | **Presentable in light and dark** | Deep space and dawn are both first-class. Nothing is designed for one theme and tolerated in the other. | P9; `06` §2 |

Stability outranks speed, speed outranks weight, and all three outrank
ornament: an effect that drops frames, bloats the build or drains the battery
is removed, not optimized later.

## P1 — Zero cost is a correctness requirement

Every dependency must have a **documented permanent free tier** and a **named
fallback**. No service that bills after a free threshold. No "free until you
grow" pricing. The fallback must be reachable by changing configuration or one
adapter, never by rewriting a feature.

| Concern | Primary | Fallback |
|---|---|---|
| Compute | any Linux box with ≥ 1 GB RAM — a free-tier VM or a spare machine at home | another such box; the stack is plain Docker Compose |
| Ingress | whichever of the three profiles of `05` §4.4 fits the box | another of the three — a Tailscale tailnet needs neither a domain nor a public address |
| Blobs | local volume | — (S3 is out of scope for v1) |
| Push | Expo Push over FCM (free; needs a Firebase project and an Expo account, no card) | local notifications only — degraded, still correct |
| Maps | MapLibre + OSM raster tiles | any raster tile source, one constant |
| CI / images | GitHub Actions + GHCR free tier (no payment method on file: at the quota it stops, it does not bill) | `pnpm verify` locally; build the image on the box |

**Rule:** the app must be fully functional with every fallback active.

**Card-gated sign-ups.** Some free tiers (OCI among them) ask for a card to
verify identity. Using one is the owner's decision, never the implementer's, and
is never required: the spare-machine path has no card anywhere.

## P2 — The spec is the source of truth

Code is an implementation detail of the spec. If they disagree, the code is
wrong until the orchestrator says otherwise. Contract changes land before the
code that depends on them.

## P3 — No task is done until its gate is green

There is no "works on my machine", no "will fix in the polish pass", no manual
check standing in for a test that could exist. The definition of done is in
`07-test-harness.md` §1.

## P4 — Offline-first

The phone owns a replica and is the primary place work happens. Every mutation
is idempotent and replayable, carries a client-generated id, and is applied
locally before it is sent. The UI is fully usable in airplane mode for
everything except first login, family administration, and photo *upload*
(capture still works; upload queues).

## P5 — Deterministic time

Storage is UTC. Display is the family timezone. Occurrences are a **pure
function** of the rule and a date range. Timezone enters only in the four
functions of `03` §4.3. Time is injected, never read from a global, so every
time-dependent test is frozen and deterministic.

## P6 — Motion runs on the UI thread

Every animation is a Reanimated worklet, drawing with views, SVG or Skia. An
animation driven by `setState`, a JS timer, or the core `Animated` API is a
defect. Nothing animates while its screen is out of focus. Motion quality is
part of the product here; its budgets are in `06` §1.

## P7 — Two users, five pets. Build for that.

No sharding, no replicas, no PostGIS, no message broker, no microservices, no
Redis, no second implementation of anything. Complexity that does not serve
these seven beings is waste. When two designs work, the one with fewer moving
parts wins.

## P8 — Reversible infrastructure

The backend is reconstructible from `infra/` plus one encrypted archive holding
the database **and** the photos. Every nightly backup is restore-verified.
Losing the box costs an afternoon, not the data.

## P9 — Accessible and respectful

Honour Reduce Motion with a designed fallback for every animation. Touch targets
of at least 44×44 dp. WCAG AA contrast in both themes. Layouts hold at 130%
font scale.

## P10 — Closed family

Membership is by bootstrap and leader-issued invite only. There is no public
sign-up route.

## P11 — Honest UI

The app never pretends. Offline is shown as offline, a queued photo as queued, a
permission that is missing as missing. A state the server rejected is never left
on screen. A completed task is never un-checked under the user's eyes.

## How work flows

```
orchestrator (Claude)                          implementer (Codex)
─────────────────────                          ───────────────────
writes and owns spec/                          reads the task's sections
answers spec/QUESTIONS.md                      contract first, if the task has routes
                                               red tests → minimum code → gate
reviews the branch against the spec     ◄──    marks the task [~], reports
accepts → [x], merges                          never edits spec/, never weakens a test
or returns findings                     ──►    fixes on the same branch
```
