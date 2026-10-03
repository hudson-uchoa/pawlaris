# 06 — Identity, Motion & Performance

Pawlaris has one visual idea: **the night sky**. The name is Polaris with a paw;
the pets are called Aurora, Asteria and Andrômeda. Every pet is a star, a done
task is a star lit, a finished day is a complete constellation.

The five product pillars *(00 §Pillars)* meet in this file: the app must be
**beautiful and alive with motion**, **light**, and **instant** — at the same
time. Motion that costs frames, megabytes or battery fails the pillar it was
meant to serve. So this file is rules and numbers, not adjectives.

Screen content is in `09-screens.md`. Android only: no iOS idioms.

---

## 1. Budgets

All device measurements run on a **release build** on a real phone. Dev builds
and emulators are not evidence. Method: `scripts/perf.mjs` (§1.2).

### 1.1 The numbers

| Pillar | Metric | Budget |
|---|---|---|
| Instant | Tap → visible feedback | on the press-in frame (a worklet; asserted in a component test) |
| Instant | Tap → the change is on screen | same interaction, no network in between *(R5.1, R3.18)* |
| Instant | Cold start → dashboard interactive | **< 1500 ms**, median of 5 |
| Instant | Warm start → dashboard | < 500 ms, median of 5 |
| Instant | Change on phone A visible on phone B | **≤ 3 s** on Wi-Fi *(R5.8)*; typically under 1 |
| Instant | Server time for a mutation or an incremental `/sync` | p95 **< 100 ms** on the box *(R5.9)* |
| Fluid | Hero transition, 10 round trips | janky frames **≤ 5%**, 99th percentile **≤ 34 ms** |
| Fluid | Dashboard fling, 90 cards, starfield on | janky frames ≤ 5% |
| Light | Release APK, `arm64-v8a` only | **≤ 60 MB** |
| Light | Android JS bundle (Hermes bytecode) | ≤ 6 MB |
| Light | Memory, dashboard idle for 30 s (total PSS) | ≤ 300 MB |
| Light | JS thread while nothing is touched | idle — no per-frame JavaScript, ever |

### 1.2 The measuring script

`scripts/perf.mjs` (Node built-ins + `adb`, written in task P7-4):

- **startup:** `adb shell am force-stop <pkg>`; clear logcat; start the activity;
  read `adb logcat -v epoch`; `t0` = the `ActivityTaskManager: START` line for
  the package, `t1` = the app's marker line `PAWLARIS_PERF dashboard_interactive`.
  Report `t1 − t0`. Five runs; the median must be under budget. The app emits
  the marker once per launch, from the dashboard's first `onLayout` that has
  data (or the empty state), via `console.log`.
- **frames `<flow>`:** `adb shell dumpsys gfxinfo <pkg> reset`; run a Maestro
  flow; `adb shell dumpsys gfxinfo <pkg>`; parse `Janky frames: N (P%)` and the
  percentile lines.
- **memory:** open the dashboard, wait 30 s, `adb shell dumpsys meminfo <pkg>`,
  read `TOTAL PSS`.
- **bundle / apk:** `npx expo export --platform android` → size of the `.hbc`;
  size of the release APK file.

### 1.3 Rules that make the numbers reachable

1. **No screen awaits the network.** Every screen renders from the replica
   store synchronously. An `await` before first paint is a defect.
2. **No spinner on screen entry.** Nothing to show yet → skeletons with the
   final layout's geometry. Button-level progress for an explicit online action
   (login, invite) is fine.
3. **The outbox is kicked the moment a mutation is enqueued** — no debounce, no
   batching window. A poke triggers a pull at once.
4. **Lists:** rows are `React.memo` components with stable keys and no inline
   closures in props. The **dashboard** uses Reanimated's `Animated.FlatList`
   with `itemLayoutAnimation={LinearTransition}` — a day has at most a few
   dozen cards and they must animate when one moves to Concluídas. **History
   lists** (task history, walks, health timeline), which can grow long and do
   not animate their layout, use `FlashList`.
5. **One animated canvas per screen, at most.** Ambient effects (§4) share a
   single Skia canvas, are driven by a handful of shared values, and stop when
   the screen loses focus, the app goes to the background, or Reduce Motion is on.
6. **No animation library beyond the three in §3.** No Lottie, no GIFs, no video.
   Every effect is drawn in code, so it costs kilobytes, follows the theme, and
   has no licence to track.
7. Hermes and the New Architecture are on. Screens use the native stack.

---

## 2. Design tokens

Components use semantic token names only — never a raw hex, number or font size.
A lint check fails on a hex literal outside `ui/tokens/` (P7-2).

### 2.1 Color

Both themes are the same sky at different hours. **Dark is deep space; light is
dawn** — a pale violet sky, never plain white-on-grey. The theme follows the
system setting *(R7.5)*, and both are first-class: every screen, effect and
illustration is designed for both.

```ts
// ui/tokens/color.ts
export const light = {            // "dawn"
  bg:            '#F5F3FF',
  surface:       '#FFFFFF',
  surfaceSunken: '#ECE8FB',
  border:        '#D9D3F2',
  text:          '#17153A',
  textMuted:     '#5A567F',
  accent:        '#5B43D6',       // nebula violet
  accentSoft:    '#E6E0FF',
  onAccent:      '#FFFFFF',
  star:          '#B87B06',       // a lit star — fills and glyphs
  starText:      '#8A5A00',       // the same idea when it is text
  success:       '#157A5A',       // aurora green
  warning:       '#8A5A00',
  danger:        '#B8324A',       // supernova
  scrim:         'rgba(23,21,58,0.45)',
  skyTop:        '#E6E0FF',       // background gradient, top
  skyBottom:     '#F5F3FF',       // background gradient, bottom (= bg)
  starfield:     '#5B43D6',       // ambient stars, drawn at low opacity
  nebulaA:       '#C9B8FF',
  nebulaB:       '#FFC9E8',
} as const;

export const dark = {             // "deep space"
  bg:            '#090B1A',
  surface:       '#13162E',
  surfaceSunken: '#0D1024',
  border:        '#2A2F5C',
  text:          '#EEF0FF',
  textMuted:     '#A4A9D1',
  accent:        '#A99BFF',
  accentSoft:    '#241F55',
  onAccent:      '#0B0A24',
  star:          '#FFD27A',
  starText:      '#FFD27A',
  success:       '#5FE0B4',
  warning:       '#FFC56B',
  danger:        '#FF8D9B',
  scrim:         'rgba(3,4,12,0.7)',
  skyTop:        '#151A45',
  skyBottom:     '#090B1A',
  starfield:     '#FFFFFF',
  nebulaA:       '#4B3BB8',
  nebulaB:       '#8A2F7A',
} as const;

// Identity palette — eight celestial bodies. Index is the identity; the theme picks the shade.
export const identity = [
  { name: 'polaris',   key: '#5B7DB1', light: '#2F5FB3', dark: '#8DB4FF' },
  { name: 'antares',   key: '#B15B6B', light: '#B5364F', dark: '#FF93A6' },
  { name: 'aurora',    key: '#4F8A6B', light: '#126E51', dark: '#5FE0B4' },
  { name: 'solar',     key: '#C88A2E', light: '#8A5A00', dark: '#FFD27A' },
  { name: 'nebula',    key: '#7A65B0', light: '#7A3FC4', dark: '#C8A6FF' },
  { name: 'neptune',   key: '#3F8F97', light: '#0F7285', dark: '#6FD9EE' },
  { name: 'mars',      key: '#B5654A', light: '#A8481F', dark: '#FFA47A' },
  { name: 'andromeda', key: '#B15B9E', light: '#A6338F', dark: '#FF9BE3' },
] as const;
```

- A **member's** color is stored on the server as the `key` hex
  (`app_user.color`). The app finds the palette entry by `key` and renders the
  `light` or `dark` shade; an unknown key falls back to entry 0. It is the color
  of that person's name in every attribution line — the app's core question is
  "who did this?".
- A **pet's** identity is `identity[sum of the id's char codes % 8]`. Used for
  the avatar's orbit ring and for the placeholder when a pet has no photo.
- `star` is the color of a completed task. It is never used to signal anything
  else.

Every text/background pair in use meets WCAG AA (4.5:1 for text, 3:1 for
meaningful graphics). The values above were checked; `ui/tokens/pairs.ts` lists
the pairs and a unit test recomputes them for both themes, so a later tweak
cannot silently break contrast.

### 2.2 Elevation

Android only: `elevation` plus a 1 px `border`. Do not use the `shadow*` props;
they do nothing on Android. In the dark theme, depth comes from the lighter
`surface` and the border, not from shadow.

```ts
export const elevation = { card: 2, sheet: 8 } as const;
```

### 2.3 Spacing, radius, type

Spacing scale: `4, 8, 12, 16, 24, 32, 48`. Radius: `card 20`, `chip 12`,
`sheet 28`, `avatar 999`.

Two typefaces:

- **Space Grotesk** (SIL OFL) — `display`, `title`, `heading`. Weights 500 and
  700 only. Embedded at build time through the `expo-font` config plugin, so
  there is no load step and no font flash.
- **Roboto** (system) — everything else. Zero bundle cost.

```
display 32/38 700 · title 24/30 700 · heading 18/24 500      Space Grotesk
body 16/22 400 · label 14/18 500 · caption 12/16 400         Roboto
```

Every `Text` sets `maxFontSizeMultiplier={1.3}`. Layouts must not clip or
overlap at 130% font scale *(P9)*. Touch targets are at least 44×44 dp; smaller
visuals get `hitSlop`.

### 2.4 Icons

`lucide-react-native` — outline icons, tree-shaken, drawn with `react-native-svg`.
Stroke width 1.75, size 20 or 24, color from a token. The few glyphs that carry
the identity (the star, the 4-point sparkle, the crescent, the paw-star mark)
are authored for this project in `ui/cosmos/glyphs.ts` as path data.

---

## 3. Motion foundations

Three libraries, each with one job:

| Library | Job |
|---|---|
| `react-native-reanimated` | every animated value; springs, timings, layout transitions; worklets on the UI thread |
| `react-native-gesture-handler` | gestures, feeding Reanimated |
| `@shopify/react-native-skia` | drawing that views cannot do cheaply: star fields, gradients, particles, trails. Driven by Reanimated shared values |

`react-native-svg` draws static vector shapes (icons, the chart, the route
thumbnail) and simple stroke animations through Reanimated props.

```ts
// ui/motion/tokens.ts
export const spring = {
  gentle: { damping: 20, stiffness: 180, mass: 1 },     // layout, sheets
  snappy: { damping: 18, stiffness: 320, mass: 0.8 },   // navigation, hero
  bouncy: { damping: 11, stiffness: 260, mass: 0.9 },   // star ignition, celebration
  stiff:  { damping: 26, stiffness: 420, mass: 0.7 },   // press feedback
} as const;

export const duration = { micro: 120, quick: 200, base: 280, hero: 320, sheet: 380, burst: 520 } as const;

export const ambient = { twinkleA: 2800, twinkleB: 4100, twinkleC: 5300, orbit: 24000, syncOrbit: 1200 } as const;
```

All numbers live in this file. Components import a named token, never an inline
number.

**Non-negotiable *(P6)*:** every animation runs on the UI thread. An animation
driven by `setState`, by `setInterval`/`setTimeout`, or by the core `Animated`
API is a defect. Animate `transform` and `opacity`; never animate layout
properties (`width`, `height`, `top`, `fontSize`) frame by frame.

> **MO-2** An ESLint rule in `apps/mobile` forbids importing `Animated` or
> `LayoutAnimation` from `react-native`, and forbids importing
> `lottie-react-native`. Gate: `lint:mobile`.

---

## 4. The cosmos kit

Reusable pieces in `ui/cosmos/`. They are what makes the app look like itself.

### 4.1 `Starfield`

The ambient background: behind the auth screens (full screen), the dashboard
header, the pet profile header and every empty state.

- Stars come from a **pure, seeded** generator —
  `generateStars(seed, count, width, height)` → `{x, y, r, opacity, layer}[]`
  (mulberry32) — so the sky is identical on every launch and testable.
  Radius 0.6–1.8 dp. Three layers, split 50% / 30% / 20%.
- Drawn in **one** Skia canvas: a vertical gradient (`skyTop` → `skyBottom`),
  an optional nebula (two blurred radial gradients, `nebulaA` and `nebulaB`, at
  18% opacity, static), then each layer as a single points draw call in
  `starfield` color.
- **Twinkle:** each layer's opacity oscillates between 55% and 100% of its base
  with its own period (`ambient.twinkleA/B/C`), three shared values in total.
- **Parallax:** on a scrolling screen, the layers translate by
  `scrollY × 0.04 / 0.08 / 0.16`, clamped.
- Density: 60 stars for a header band, 120 for a full screen. In the light
  theme the stars are drawn at 28% of their opacity — a dawn sky keeps only its
  brightest stars.
- Stops animating when the screen is not focused, the app is in the background,
  or Reduce Motion is on (stars stay, still).

### 4.2 `StarCheck` — the checkbox

The most repeated interaction in the app. A task is a star waiting to be lit.

```
resting    28 dp ring in `border`, hollow
press-in   scale 1 → 0.92 (spring.stiff)                         -- feedback only
release    commit (R3.18), then, all at once:
             ring fills with accentSoft (duration.quick)
             a 5-point star scales 0 → 1.15 → 1 in `star` (spring.bouncy)
             6 sparks leave the centre along evenly spaced angles, travel 16 dp,
               shrink and fade (duration.burst)
             haptic: impactAsync(Light)
+400 ms    the card moves to Concluídas with a layout transition (LinearTransition)
cancel     the finger leaves the box, or a scroll starts, before release
             → scale back to 1, nothing committed
undo       the star scales to 0 and the ring empties (duration.quick), no sparks
```

If the sync later reveals someone else got there first, the star **stays lit**
and the attribution line crossfades to the winner *(R3.21)*. Putting out a star
under the user's eyes is the most destructive thing this UI could do.

### 4.3 `PetToggle` and the constellation

In a `per_pet` card each pet is an avatar with a small unlit star badge.
Completing a pet lights its badge with the `StarCheck` ignition, scaled down.
When the **last** pet is completed, a thin line draws on from avatar to avatar
in order (`strokeDashoffset`, `duration.base`), joining them into a
constellation; it stays for as long as the occurrence is complete.

### 4.4 `Orbit`

- **Avatar ring:** a pet avatar sits inside a 1.5 dp ring in the pet's identity
  color. On the profile header the ring carries one small satellite dot that
  travels it once every `ambient.orbit`. In lists the ring is static.
- **`SyncIndicator`:** `sincronizado` — a small steady 4-point star in
  `success`; `sincronizando` — a dot orbiting a 14 dp ring once every
  `ambient.syncOrbit`; `offline` — a crescent in `textMuted`. Offline is a
  phase of the moon, not an alarm *(R5.6)*.
- **`CountdownRing`** *(R3.31)*: the arc is an orbit and a small moon rides its
  leading end. Progress is one `withTiming` from the current fraction to 0 over
  the remaining milliseconds, linear, started when the ring mounts or `ends_at`
  changes — no per-frame JavaScript, no interval. In the last 10 s the arc
  turns `warning`; at zero it turns `success` with one haptic if the app is in
  the foreground. The remaining-time **text** (`04:32`) updates once a second
  from a `useNow(1000)` tick; that is text, not animation.

### 4.5 `ShootingStars` — the day is complete

When every occurrence in the viewer's scope for today is done *(R6.13)*: five
meteors cross the header starfield on staggered diagonal paths (head in `star`,
tail fading over 60 dp), over 1600 ms; the starfield brightens to full and
settles; the header reads **Céu completo**. Once per device per day.

### 4.6 Hero — pet card → profile *(ADR-011)*

Hand-built and deterministic; no shared-element API.

```
press-in   card scales to 0.97 (spring.stiff)
release    measure() the card's avatar and name in window coordinates
           mount an overlay above the navigator with a copy of avatar + name at those frames
           hide the source card's avatar and name (opacity 0)
           push pet/[id] with animation 'none'; the profile's header avatar/name start at opacity 0
           the profile reports its header avatar/name target frames via onLayout + measure()
           overlay animates with spring.snappy: translate + scale from source frame to target frame
           the profile's starfield and body fade in (duration.base) underneath
           when the spring settles: profile header opacity 1, overlay unmounts, source restored,
             and the orbit satellite starts
back       system back: overlay re-mounts at the header frames and animates to the source
           frames (re-measured — the grid may have scrolled); if the source card is no longer
           on screen, crossfade instead
```

- The name is animated with `scale`, not `fontSize`.
- The whole forward transition takes about `duration.hero`.
- Android's back is the system back (button or gesture). There is no
  finger-tracked interactive back; do not build one.
- A failed measure (null or zero size) falls back to a crossfade instead of
  animating from garbage.

### 4.7 Screen transitions

| Transition | Motion |
|---|---|
| Tab switch | content crossfades in `duration.micro`; the active tab icon gets a small star dot beneath it (scale in, `spring.bouncy`) |
| Push | native stack default (`slide_from_right`) |
| Modal route | native `slide_from_bottom` |
| `Sheet` primitive | translateY spring up (`spring.gentle`), scrim fades to `color.scrim`; drag down past 30% or a fast fling dismisses. **No blur.** |
| Back | system back; reverses the push |

### 4.8 Lists and loading

- Entry: fade + 12 dp rise, staggered 40 ms, first 6 items only, first mount only.
- Reorder/removal on the dashboard: `itemLayoutAnimation={LinearTransition}`
  on `Animated.FlatList` (§1.3).
- `Skeleton`: a soft band of light sweeps across the placeholder
  (translateX of a gradient, 1400 ms loop) — stardust, not a spinner.
- Pull-to-refresh: the stock Android `RefreshControl`, tinted `accent`.

### 4.9 Live walk

```
distance   digits roll on change (per-digit translateY), not a snap
route      the polyline extends as points arrive; the camera eases to follow
comet      the position dot is a bright head in `star` with a short fading tail
           along the last 40 m of the route
pulse      a soft ring expands and fades under the head on each accepted fix —
           a pulsar; the user's proof that tracking is alive
pause      the metrics panel fades to 60% opacity over duration.quick
saved      on the walk detail, the route draws on once (strokeDashoffset, 900 ms)
```

### 4.10 Illustrations

Empty states are small scenes **drawn in code** with Skia from primitives
(circles, arcs, the star and crescent paths), using tokens only, each under
150 lines, each with a gentle twinkle from `Starfield`:

| Where | Scene | Copy (`09` §10) |
|---|---|---|
| Dashboard, nothing scheduled | a crescent and a few stars | Céu limpo por hoje. |
| No pets yet | a dotted, unlit constellation in the shape of a paw | Nenhuma estrela por aqui ainda. |
| No walks yet | a small ringed planet with a dashed orbit | Nenhum passeio registrado. |
| No health events | a single star above a horizon line | Nada registrado ainda. |

The app icon and splash use the **paw-star mark** (`ui/cosmos/glyphs.ts`): a
paw whose four toe pads are stars. Splash background `#090B1A` in both themes.
All of it is authored for this project. **No GoPuppy assets**, no stock
illustration packs.

---

## 5. Reduce Motion *(P9)*

`useReduceMotion()` wraps Reanimated's `useReducedMotion()`.

| Normal | Reduced |
|---|---|
| Starfield twinkle and parallax | still stars |
| Star ignition with sparks | the star appears with a 120 ms fade; no scale, no sparks |
| Constellation draw-on | the line appears |
| Orbit satellite, sync orbit | static ring; sync shows a static dot |
| Shooting stars | the header reads **Céu completo** with a still, bright sky |
| Hero transition | 150 ms crossfade |
| List stagger, skeleton sweep | all at once; static placeholder |
| Comet tail, pulsar, rolling digits, route draw-on | static dot; digits snap; route shown |
| Sheet spring | 150 ms fade |

Reduced mode is a different design, not a broken one: the sky is still there.

> **MO-1** With reduce motion on, a hero navigation schedules no spring. Gate:
> a component test with the hook mocked true asserts the crossfade path runs.
>
> **MO-3** With reduce motion on, no `withRepeat` is started anywhere. Gate: a
> test renders `Starfield`, `Orbit`, `SyncIndicator` and `Skeleton` with the hook
> mocked true and asserts `withRepeat` was never called.

---

## 6. Weight chart

Hand-rolled with `react-native-svg`; no charting library.

- X = `measured_at`, Y = `weight_kg`, padded 10% above and below the range.
- Monotone cubic interpolation (no overshoot between points — a Catmull-Rom
  curve can dip below a real measurement, which is wrong for medical data).
- The line is `accent`; each measurement is a small star; the fill under the
  line is a gradient from `accentSoft` to transparent.
- Draw-on: `strokeDashoffset` over 600 ms on first appearance; the stars appear
  in sequence behind the line's head.
- Drag-scrub: a vertical marker snaps to the nearest entry and shows
  `4,25 kg · 03/10`; a light haptic on each snap.
- Fewer than 2 entries → empty state *(R2.6)*.

The path geometry is a pure function (`weightChartPath(entries, width, height)`)
with unit tests; the component only draws it.

---

## 7. Component inventory

```
Primitives  PressableScale · Card · Avatar · Chip · Skeleton · Sheet · Toast
            EmptyState · Button · TextField · Switch · SegmentedControl · Icon
Cosmos      Starfield · StarCheck · Sparks · ConstellationLine · Orbit
            ShootingStars · illustrations/* · glyphs
Domain      TaskCard · PetToggle · PetCard · WeightChart · HealthTimelineItem
            WalkMetrics · RouteThumbnail · SyncIndicator · PermissionGate
            CountdownRing · AssetImage · DayHeader · ScopeFilter
```

Every primitive and every cosmos piece has a component test. Domain components
have a test per state — including `photo pending upload`, `lost the completion
race`, `approximate` location, and `offline`, which are the states most likely to be
skipped and most likely to be seen.

Every interactive element has an `accessibilityLabel` and `accessibilityRole`.
A `StarCheck` is a checkbox to assistive technology and announces its state
("Remédio da Aurora, 8 horas, não feito"). Ambient effects are hidden from the
accessibility tree.
