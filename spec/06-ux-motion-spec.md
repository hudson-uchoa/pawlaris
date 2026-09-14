# 06 — UI, Motion & Performance Specification

"Beautiful and fast" is not a review opinion here — it is a set of numbers the
harness measures. This file turns the PRD's §3 into gates *(A-22)*.

---

## 1. Performance budgets (gates, not goals)

| Metric | Budget | How it is measured |
|---|---|---|
| Cold start → interactive dashboard | **< 1500 ms** | `expo-performance` mark, asserted in a Maestro flow |
| Warm start → dashboard | < 400 ms | same |
| Screen transition, first frame | **< 16 ms** | no blank frame permitted; navigation renders cached data synchronously |
| Tap → visible feedback | **< 100 ms** | optimistic + haptic on press-in, never on response |
| Dropped frames during a hero transition | **0** | `react-native-performance` frame monitor in the E2E run |
| List scroll (90 items) | 60 fps sustained | FlashList, fixed `estimatedItemSize` |
| JS bundle (Android, Hermes) | < 4 MB | `make size` |
| Time to first pixel of an avatar | < 50 ms cached | `expo-image` `memory-disk` + blurhash placeholder |

**Three hard rules that make the numbers achievable:**

1. **Navigation never awaits the network.** Every screen renders from the
   TanStack Query cache immediately and revalidates in the background. An
   `await` before a first paint is a defect *(R6.1)*.
2. **A spinner on screen entry is a defect.** Skeletons that match the final
   layout, so nothing shifts when data lands.
3. **Prefetch on intent.** Pressing-in on a pet card starts the profile query
   before the finger lifts. The data is usually there before the animation ends.

### Enabling conditions

- Hermes + New Architecture (Fabric) on.
- `react-native-screens` native stack — screens are real Android views.
- Inline requires / lazy route modules via `expo-router`.
- `FlashList` for any list that can exceed 20 rows.
- Every list row memoized, with stable `keyExtractor` and no inline closures in
  props (they defeat memoization and are the #1 cause of list jank).

---

## 2. Design tokens

### Color

Warm, calm, low-chroma ground with one strong accent. Cards on a soft ground,
never pure white on pure white. Full light and dark palettes are required —
Android dark mode is not optional.

```ts
// ui/tokens/color.ts — semantic names only; components never use raw hex
export const light = {
  bg:            '#FAF7F3',   // warm off-white ground
  surface:       '#FFFFFF',
  surfaceSunken: '#F2EDE7',
  border:        '#E8E0D6',
  text:          '#1C1917',
  textMuted:     '#78716C',
  accent:        '#E07A5F',   // terracotta — warm, not a generic SaaS blue
  accentSoft:    '#FBEAE3',
  success:       '#4F8A5B',
  warning:       '#C88A2E',
  danger:        '#C0503F',
  // Per-user identity — the app's core question is "who did this?"
  userHudson:    '#5B7DB1',
  userDuda:      '#B15B8E',
} as const;
```

Each pet also gets a deterministic accent derived from its id, used in avatar
rings and task cards so the four cats are distinguishable at a glance.

### Elevation

Soft shadows only. On Android, `elevation` plus a subtle border — Android
shadows render harshly without one.

```ts
export const elevation = {
  card:  { elevation: 2, shadowOpacity: 0.06, shadowRadius: 8,  shadowOffset: { width: 0, height: 2 } },
  sheet: { elevation: 8, shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } },
};
```

### Spacing & radius

4 pt base scale: `4, 8, 12, 16, 24, 32, 48`. Radius: `card: 20`, `chip: 12`,
`sheet: 28`, `avatar: 999`. Generous radii read as friendly without cartoonishness.

### Type

System font (Roboto) — zero bundle cost, instant first paint, no font flash.

```
display 32/38 700 · title 24/30 700 · heading 18/24 600
body 16/22 400 · label 14/18 500 · caption 12/16 400
```

Must survive 130% dynamic type without clipping *(P9)*.

---

## 3. Motion primitives

All springs live in one file. Components import a named token, never inline
numbers — this is what makes the app feel like one object rather than a pile of
screens.

```ts
// ui/motion/springs.ts
export const spring = {
  gentle: { damping: 20, stiffness: 180, mass: 1 },     // layout, sheets
  snappy: { damping: 18, stiffness: 320, mass: 0.8 },   // navigation, heroes
  bouncy: { damping: 11, stiffness: 260, mass: 0.9 },   // checkboxes, celebration
  stiff:  { damping: 26, stiffness: 420, mass: 0.7 },   // micro, near-instant
} as const;

export const duration = {
  micro: 120, quick: 200, base: 280, hero: 320, sheet: 380,
} as const;
```

**Non-negotiable:** every animation runs in a Reanimated worklet on the UI
thread. Any animation driven by `setState`, `setInterval`, or the non-native
`Animated` driver is a defect *(P6)*.

---

## 4. The signature animations

### 4.1 Hero — pet card → profile *(ADR-011)*

The app's most visible motion. Hand-built and deterministic.

```
press-in    → card scales to 0.97 (spring.stiff), prefetch fires
release     → measure() source frame
            → render absolute overlay at source frame
            → push route with transparent background
            → overlay springs (spring.snappy) to the target frame:
                 avatar   : position + size
                 name     : position + fontSize interpolation
                 card bg  : morphs to the header, radius 20 → 0
            → at 85% progress, cross-fade the real header in, drop the overlay
back        → the same timeline played in reverse from the live frames
total       ≈ 320 ms, 0 dropped frames
```

Failure mode to avoid: measuring after layout has shifted. Measure on press-in,
cache the frame, and re-measure only if the list scrolled.

### 4.2 Task checkbox — the most-repeated interaction in the app

Fires **on press-in**, before any network call *(R3.11)*:

```
scale      1 → 0.88 → 1.06 → 1          spring.bouncy
checkmark  SVG path strokeDashoffset 100% → 0 over 180 ms, ease-out
fill       accentSoft → accent          200 ms
ring       radial ripple, 0 → 1.4 scale, opacity 0.3 → 0, 320 ms
haptic     impactAsync(Light) at press-in
row        after 400 ms, animates to the "Concluídas" group with a layout
           animation — it does not vanish
```

If the sync later reveals the other person got there first, the row **stays
checked** and the attribution line crossfades to "Duda já fez às 07:12". No
error, no un-checking. Reverting a completed state under the user's eyes is the
single most destructive thing this UI could do *(R3.14)*.

### 4.3 Countdown ring *(R3.20)*

A worklet derives progress from `ends_at` and a `useFrameCallback` clock — no
JS interval, no `setState`.

```
ring        strokeDashoffset driven by (ends_at - now) / total
last 10 s   ring color → warning; scale pulses 1 → 1.04 → 1 per second
complete    ring flashes to success, Lottie burst, notificationAsync(Success)
```

Correct after an app kill, a reboot, or three days offline, because it is derived
from a timestamp *(TM-1)*.

### 4.4 Screen transitions

| Transition | Motion |
|---|---|
| Tab switch | Crossfade 140 ms + 8 pt vertical drift. No horizontal slide between tabs. |
| Push (detail) | Native stack slide, `spring.snappy` |
| Modal / sheet | Spring up from 100% → 0 with backdrop blur fade, `spring.gentle`, drag-to-dismiss with velocity handoff |
| Back gesture | Real interactive gesture — the screen tracks the finger, no canned animation |

### 4.5 Lottie moments

Sparing and earned. Overused celebration becomes noise within a week.

- Empty state — dashboard with nothing scheduled (calm, looping, subtle)
- Empty state — no pets yet
- All tasks done — confetti burst, **once per day** *(R6.5)*
- Walk saved — paw-print trail draw-on
- Sync recovered after a long offline stretch — brief, quiet

All assets CC0 or authored by us. **No GoPuppy assets** *(A-26)*.

### 4.6 List motion

- Entry: staggered fade + 12 pt rise, 40 ms per item, capped at 6 items.
- Reorder/removal: `LinearTransition` from Reanimated layout animations.
- Pull-to-refresh: custom paw-print indicator that scrubs with drag distance.

### 4.7 Live walk screen

```
distance   animated number, digits rolling on change (not a re-render snap)
route      polyline draws progressively; the map follows with an eased camera
pulse      a soft ring pulses under the position dot on every GPS fix — the
           user's proof that tracking is alive
pause      the whole screen desaturates to 60% over 200 ms
```

---

## 5. Reduce Motion *(P9, A-25)*

Read `AccessibilityInfo.isReduceMotionEnabled` once at startup, subscribe to
changes, and expose it through a `useReduceMotion()` hook.

| Normal | Reduced |
|---|---|
| Hero transition | 150 ms crossfade |
| Spring checkbox | Opacity + color only |
| Confetti | Static badge |
| List stagger | All at once |
| Ring pulse | Static ring |

Reduced mode must remain *pleasant*, not stripped. It is a different design, not
a disabled one.

> **Gate MO-1:** a test enabling reduce motion asserts no spring animation is
> scheduled on a hero navigation.

---

## 6. Charts *(A-27)*

Weight history is at most a few hundred points. Hand-rolled with
`react-native-svg`:

- Catmull-Rom smoothed line, gradient fill fading to transparent
- Path draws on with `strokeDashoffset` over 600 ms on first appearance
- Drag-scrub with a haptic tick at each data point
- Fewer than 2 entries → empty state, never a broken axis *(R2.6)*

No charting library. One would cost more bundle and more jank than the feature.

---

## 7. Component inventory (build in this order)

```
Primitives  Pressable (scale+haptic) · Card · Avatar (ring, blurhash) · Chip
            Skeleton · Sheet · Toast · EmptyState
Domain      TaskCard (per-pet checkboxes, timer, photo badge, attribution)
            PetCard (hero source) · WeightChart · HealthTimelineItem
            WalkMetrics · RoutePreview · SyncIndicator · PermissionGate
```

Every primitive gets a component test. Domain components get tests for their
states — including `photo pending upload`, `lost the completion race`, and
`foreground_only permission`, which are the states most likely to be skipped and
most likely to be seen in real use.

---

## 8. Screens

```
(tabs)/index        Hoje — grouped tasks, sync indicator, celebration
(tabs)/pets         Grid of 5 pet cards (hero sources)
(tabs)/walks        Walk history + big "Passear com a Katarina" CTA
(tabs)/settings     Family, users, permissions, Diagnostics
pet/[id]            Hero target — profile, weight chart, health timeline
task/[id]           Detail, timer, photo proof, history
walk/live           Full-screen tracking
walk/[id]           Saved walk summary + route
```
