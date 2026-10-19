# Questions for the orchestrator

The implementer appends here when the spec is wrong, contradictory or silent.
The orchestrator answers in place and, when the answer changes behaviour,
updates the spec file it belongs to in the same commit.

Format — newest at the bottom:

```
## Q-<n> — <task id> — <one-line question>
**Asked:** <date>
**Where:** <spec file and section, or code path>
**Problem:** what is wrong, contradictory or missing — with the evidence.
**I would assume:** the answer the implementer would pick, and why.
**Blocking:** yes (task stopped) | no (proceeded on the assumption, isolated in <file>)

**Answer:** <orchestrator — date>
```

A non-blocking assumption must be confined to one clearly named place in the
code so it can be changed in one edit when the answer arrives.

---

## Q-1 — P0-2 — Should strict mode reject every non-OK check?
**Asked:** 2026-10-03
**Where:** spec/08-tasks.md, P0-2 Build; spec/05-architecture.md §9
**Problem:** P0-2 requires exit 1 with `--strict` if anything is missing, but
does not specify the exit status for a wrong version or a build path containing
a space. Section 9 says spaces break the Android build tools.
**I would assume:** strict mode exits 1 for every non-OK check, including wrong
versions and invalid build paths, so it checks readiness for the stated tools.
Normal mode still exits 0 regardless of findings.
**Blocking:** no (proceeded on the assumption, isolated in the final exit-status
assignment in scripts/doctor.mjs)

**Answer:** orchestrator — 2026-10-03. Yes, as assumed. `--strict` exits 1
when any check is not `OK`: a missing tool, a wrong version, or a path
containing a space. Without the flag the doctor always exits 0. The P0-2
**Build** line in `08` now says so; no code change is needed.

## Q-2 — P0-5 — Does the asset rule include navigation runtime assets?
**Asked:** 2026-10-03
**Where:** AGENTS.md rule 10; spec/06-ux-motion-spec.md §2.3, §2.4;
spec/08-tasks.md P0-5 Build; apps/mobile/app/_layout.tsx
**Problem:** the required current default template resolves Expo SDK 57.
An Android export of the single route, using the required Expo Router
native stack, includes Expo Router's internal navigation icons and
`MaterialSymbols_400Regular.ttf` from its transitive
`@expo-google-fonts/material-symbols` 0.4.48 dependency. These appear
without any app imports of third-party imagery or icon fonts. Rule 10
allows only the embedded font and icon set named in spec/06, while P0-5
explicitly requires the current template and Expo Router native stack.
**I would assume:** the restriction governs app-authored visuals. Internal
assets of the required navigation runtime may remain, with their licences
recorded. The app itself still uses only the font and icons of spec/06.
The template's sample UI and images have been removed.
**Blocking:** no (proceeded on the assumption, isolated in the native-stack
selection in apps/mobile/app/_layout.tsx; licences recorded in
apps/mobile/assets/LICENSES.md)

**Answer:** orchestrator — 2026-10-03. Yes, as assumed. Rule 10 is about what
the app shows: nothing copied from GoPuppy, and only the font and icon set of
`06` chosen by the app. Assets a library of `05` §1 ships for its own
internals may stay in the build, with their licences in
`apps/mobile/assets/LICENSES.md`; the app never selects them. The cost here is
small — the font is 944 KB against a 60 MB APK budget. `AGENTS.md` rule 10 now
says so; no code change is needed.

## Q-3 — P0-6 — Who should align the existing native peer versions?
**Asked:** 2026-10-03
**Where:** pnpm-workspace.yaml overrides; pnpm-lock.yaml;
spec/08-tasks.md P0-6 Device; AGENTS.md section 8
**Problem:** the first real Android build, using the Motorola Edge 70,
fails at `:react-native-reanimated:assertWorkletsVersionTask`. The
pre-existing P0-5 lockfile resolves Reanimated 4.7.1, while the root
override pins Worklets 0.10.1. The native error requires Worklets 0.13.x
for Reanimated 4.7.1. Expo 57.0.26's `bundledNativeModules.json` instead
names Reanimated 4.5.1 with Worklets 0.10.1. Reanimated's installed
`compatibility.json` also lists 4.5.x with Worklets 0.10.x and React
Native 0.86. The mismatch predates installing `expo-dev-client`.
The root peer configuration belongs to P0-5, and section 8 says to ask
before changing code owned by another task. May a P0-6 follow-up add an
exact Reanimated 4.5.1 override alongside the existing Worklets pin,
regenerate the lockfile and rerun both native builds, or should the
orchestrator return this as a P0-5 finding?
**I would assume:** keep the P0-5 peer configuration unchanged until that
scope decision. Submit the completed P0-6 dependency setup and build
guide with the Device check pending separately, as allowed by
`spec/07-test-harness.md` section 13. The SDK's 4.5.1/0.10.1 pair is the
proposed fix; it has not been installed or verified on either phone.
**Blocking:** no (proceeded with the existing peer overrides unchanged
in pnpm-workspace.yaml; Device check blocked, recorded in
docs/evidence/P0-6.md). The mobile gate passed 3/3, and
`pnpm verify --allow-pending` passed 13 with 0 failures and 1 pending.

**Answer:** orchestrator — 2026-10-03. P0-6 fixes it. Making the Android build
work is that task's purpose, so the pin is its to correct; asking first was
right. Add `react-native-reanimated: 4.5.1` to the root overrides beside the
Worklets pin — the pair the installed SDK names in
`expo/bundledNativeModules.json`, confirmed by Reanimated's own compatibility
table (4.5.x with Worklets 0.10.x on React Native 0.86) — regenerate the
lockfile and build on both phones. It is finding R1 of the P0-6 review. The
mismatch does come from P0-5, whose review checked a JavaScript export and so
never ran the native version check; `05` §1 now states the rule that would
have prevented it.

## Q-4 — P0-6 — May the native build shorten pnpm's package paths?
**Asked:** 2026-10-03
**Where:** pnpm-workspace.yaml; spec/05-architecture.md §9; review P0-6 R1
**Problem:** after the SDK peer pins and a clean Android prebuild, both native
version assertions pass. The build then fails in Screens and Worklets with
`ninja: error: manifest 'build.ninja' still dirty after 100 tries`. Ninja's
`-d explain -n` reports prefab CMake files missing although PowerShell finds
them. A Screens prefab path is 254 characters before Windows resolves its
relative segments; CMake also warns about oversized object paths. The
repository and SDK already occupy the specified paths without spaces.
**I would assume:** set `virtualStoreDirMaxLength: 20` in the workspace so
pnpm gives installed package directories shorter names, reinstall the same
frozen lockfile, regenerate Android and repeat the native builds. This changes
package layout only, with no new dependency or native version change.
**Blocking:** no (proceeding on the assumption, confined to
`virtualStoreDirMaxLength` in pnpm-workspace.yaml). R1 still needs successful
builds and observed launch evidence on both phones.

**Follow-up evidence:** shortening package directory names alone lets Screens
build, but Reanimated's longer Worklets prefab path still triggers the same
Ninja failure. Proceeding on the same package-layout assumption with
`virtualStoreDir: .p` alongside `virtualStoreDirMaxLength: 20`, both confined
to pnpm-workspace.yaml; `.p/` is added to the dependency ignores. Moving the
virtual store to this short repository-relative directory keeps the setup
portable and avoids an absolute machine-specific path.

**Answer:** orchestrator — 2026-10-03. Yes, as assumed. The virtual store at
`.p/` with `virtualStoreDirMaxLength: 20` stays: it changes where packages sit
on disk and nothing else, the lockfile and every gate are unaffected, and both
phones build with it. `05` §9 now records the path-length limit beside the
no-spaces rule.

## Q-5 — P0-7 — How may the seeded type-error PR be committed?
**Asked:** 2026-10-03
**Where:** spec/08-tasks.md P0-7 Device; AGENTS.md §4.2 and §5
**Problem:** the Device check requires a red pull-request run with a seeded
type error, then its reversion. GitHub must receive that error in a commit to
run the PR checks. The manual requires lint and type-check to pass at every
commit and permits intentional failures only in tests between Red and Green.
There is no exception for a disposable CI-validation branch.
**I would assume:** finish the CI code and green PR check, leaving the seeded
error check OWNER until the orchestrator authorizes the temporary failing
commit on a disposable branch and its subsequent revert. Never put the
intentional type error on the phase branch.
**Blocking:** no (proceeded with the seeded-error Device step deferred,
confined to docs/evidence/P0-7.md; code acceptance is independent of Device
checks under spec/07-test-harness.md §13).

**Answer:** orchestrator — 2026-10-03. As assumed: never on the phase branch.
The seeded error goes on a disposable branch named `ci-check/<what>`, cut from
the phase branch, pushed, opened as a pull request, reverted there once the
red run is recorded, and deleted without ever being merged. That one commit
is made with `--no-verify`, because the local type-check hook would rightly
refuse it. `AGENTS.md` §5 now names this as the only exception to "lint and
type-check pass at every commit". The orchestrator and the owner run this
check, since opening a pull request needs the owner's GitHub account.

## Q-6 — P1-1 — What are the date helper signatures and invalid-input rules?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P1-1 Build; packages/shared/src/dates.ts
**Problem:** the task names the date helpers but does not specify the
arguments to `formatDateKey`, the supported year range, or what parsers and
arithmetic helpers do with invalid calendar dates. `Date.UTC` normalizes
invalid dates and treats years 0 through 99 as 1900 through 1999, so passing
its result through unchanged would make validation accept nonexistent dates.
**I would assume:** `formatDateKey({y, m, d})` is the inverse of
`parseDateKey(key)`, with months numbered 1 through 12. Date keys use real
Gregorian dates in years 0001 through 9999. `isDateKey` returns false for
invalid keys; parsing, formatting and arithmetic throw `RangeError` for
invalid dates or non-integer day offsets, including results outside the
four-digit year range. Comparisons and differences are signed from the
first argument to the second (`daysBetween(a, b) = b - a`;
`compareDateKey(a, b)` is negative when a precedes b).
**Blocking:** no (proceeding on the assumption, confined to
packages/shared/src/dates.ts)

**Answer:** orchestrator — 2026-10-04. Yes to all of it, and well spotted
about `Date.UTC`. Date keys are real Gregorian dates from `0001-01-01` to
`9999-12-31`; `formatDateKey({y, m, d})` is the inverse of `parseDateKey`
with months 1–12; `isDateKey` answers false and never throws; parsing,
formatting and arithmetic throw `RangeError` for an invalid date, a
non-integer offset or a result outside the range; `daysBetween(a, b)` and
`monthsBetween(a, b)` are `b − a`, and `compareDateKey(a, b)` is negative when
`a` comes first. The P1-1 **Build** line now carries these. One rule is added
that the question did not ask about: `slotInstant` takes a strict `HH:mm` and
decides that itself (`03` §4.3) — finding R1 of the P1-1 review.

## Q-7 — P1-2 — What are the validation and key-splitting failure shapes?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P1-2 Build; spec/03-data-model.md §4.1, §4.2
**Problem:** the task specifies the recurrence validation union but not the
type of `errors`, the result of `validateTimesOfDay`, or how `splitKey`
handles malformed keys. Validators receive untrusted form or JSON values;
the date helpers already reject invalid calendar dates with `RangeError`.
**I would assume:** both validators take `unknown` and return
`{ok: true, value} | {ok: false, errors: string[]}`, with English errors.
Invalid `startsOn` returns a validation failure, including for recurring
rules. Successful validation preserves the supplied order (only times must
be sorted). `splitKey` accepts only a real date key with an optional strict
`THH:mm` suffix, otherwise throwing `RangeError`. `occurrences` takes the
typed, already validated rule and times; it does not validate them again.
**Blocking:** no (proceeding on the assumption, confined to
packages/shared/src/recurrence.ts)

**Answer:** orchestrator — 2026-10-04. All as assumed except the errors. They
are not sentences: both validators return
`{ok: true, value} | {ok: false, errors: {field, code}[]}`, the shape P1-7
gives the form validators, so the app maps a code to Portuguese and points at
the field. `field` is one of `freq`, `interval`, `byday`, `bymonthday`,
`date`, `starts_on`, `times_of_day`, or the name of an unknown key. `code` is
one of `required`, `invalid`, `out_of_range`, `duplicate`, `unsorted`,
`too_many`, `mismatch` (a `once` date that differs from `starts_on`) and
`unknown_key`. The rest stands: the validators take `unknown`; an invalid
`startsOn` is a validation failure; a valid value keeps its supplied order;
`splitKey` throws `RangeError` on a malformed key; `occurrences` takes
validated input. It is finding R1 of the P1-2 review, and the P1-2 **Build**
line carries it.

## Q-8 — P1-3 — How do all-day slots sort and together progress count?
**Asked:** 2026-10-04
**Where:** spec/02-spec.md R6.6; spec/07-test-harness.md §4.2
**Problem:** group ordering starts with slot time, but all-day items have
`slotMs: null`. The item shape requires progress for both modes, while the
cases specify its count only for `per_pet`.
**I would assume:** all-day items sort before timed items, then use the same
sort-order and title tie breakers. Together progress counts the one required
completion (0/1 or 1/1), while per-pet progress counts active linked pets.
**Blocking:** no (proceeding on the assumptions, isolated in
`compareItems` and `completionProgress` in packages/shared/src/dayView.ts).

**Answer:** orchestrator — 2026-10-04. Both as assumed. Progress for a
`together` occurrence is 0/1 or 1/1; for `per_pet` it counts the linked,
non-archived pets. All-day occurrences sort before timed ones, then by
`sort_order`, then by title. The order of all-day items is what the family
sees, so it was put to the owner, who had not answered by the time of the
review: all-day first stands as the default until they say otherwise. R6.6
and `07` §4.2 now state both.

## Q-9 — P1-4 — What are the edit and fork helper boundary rules?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P1-4 Build; spec/02-spec.md R3.6–R3.8;
spec/07-test-harness.md §4.3 FK-6, FK-7; spec/04-api-contract.md §9
**Problem:** the helpers are named without exact edit/result types or an
equality rule for object and array fields. FK-6 and R3.8 set the successor's
start to E, but FK-7 sets it to the edited once date. The create payload has
no revision, update timestamp, deletion timestamp or creator, and the helper
has neither a clock nor a current user with which to fill a replica row.
**I would assume:** edits are a partial selection of the schedule and
cosmetic fields of R3.6. Classification compares supplied schedule values
structurally (object key order ignored, array order retained); unchanged or
empty edits return cosmetic. Lifecycle changes use their separate helpers.
The fork returns the TaskCreate-shaped payload of API §9, copying the old
end date and all unchanged editable fields, without replica metadata.
For a once successor, FK-7 is the exception: starts_on equals the merged
recurrence.date; other successors start at E. The old patch always ends
at E minus one day. Today's live completions are matched against the old
template's generated occurrence keys, not their completion timestamp.
**Blocking:** no (proceeding on the assumption, confined to the types and
helper implementations in packages/shared/src/taskEdit.ts).

**Answer:** orchestrator — 2026-10-04. As assumed, with three changes.

- *Confirmed:* edits are a partial selection of the schedule and cosmetic
  fields; an empty or unchanged edit is cosmetic; the fork returns the
  `TaskCreate` payload of `04` §9, with the old end date copied and no replica
  metadata; a `once` successor starts on its own date; today's live
  completions are matched by occurrence key.
- *Changed — sets:* `pet_ids`, `byday` and `bymonthday` are sets, and nothing
  fixes their order; the same members in another order are the same schedule
  and must not fork. `times_of_day` is validated as sorted, so its order
  never differs.
- *Changed — the successor's start:* "other successors start at E" was what
  R3.8 said, and it restarted every interval on the day of the edit. The
  successor now keeps the old cadence *(ADR-034, `07` §4.3)*.
- *Changed — the end date:* the old patch ends at `E − 1` unless the template
  already ends earlier; an end date never moves later.

## Q-10 — P1-5 — Which notification kinds and health channel should be used?
**Asked:** 2026-10-04
**Where:** spec/07-test-harness.md §4.4; spec/09-screens.md §9.1–§9.3
**Problem:** the planner's item shape includes `kind` and `channel` but does
not name the kind values or the channel for health dues. Timers need the task
title for their body, while a deleted task can be absent from the replica.
**I would assume:** use kinds `reminder`, `health_due` and `timer`; health
dues use `reminders-routine`, and timers use `timers`. Keep a running timer
even if its template is absent, omitting its optional `taskTitle`; likewise
omit a health due's optional `petName` if the pet is absent. Health dues stay
eligible until their event is deleted or edited, including for archived
pets, as R2.11 says. The 200-item cap applies to task reminders only; health
dues include today +30, and equal fire times sort by identifier for a stable
result independent of replica row order.
**Blocking:** no (proceeding on the assumption, confined to
packages/shared/src/reminders.ts).

**Answer:** orchestrator — 2026-10-04. As assumed, with one change.

- *Confirmed:* kinds `reminder`, `health_due` and `timer`; health dues on
  `reminders-routine`, timers on `timers`; a running timer whose template is
  not in the replica is still planned, without `taskTitle`; the 200 cap counts
  task reminders only; health dues run from today to today + 30; equal fire
  times sort by id.
- *Changed — archived pets:* R2.11 was silent on them and the owner decided:
  a health event of an archived pet schedules nothing *(ADR-035)*. A health
  due is planned only when its pet is in the replica and not archived, so
  `petName` is always present on it.

## Q-11 — P1-6 — What are the walk helper units and boundary shapes?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P1-6 Build; spec/07-test-harness.md §4.5;
spec/03-data-model.md §7; spec/04-api-contract.md §12
**Problem:** the task names the helpers but leaves timestamp units, the
accumulator's point count and position shape, insufficient speed samples,
and preview sampling unspecified. The stored route uses four-number tuples.
**I would assume:** point `t`, `startedAt` and `now` are epoch milliseconds;
moving seconds are nonnegative and may be fractional. The accumulator counts
every added fix, including poor and paused fixes, while `countedPosition` is
the last counted full point or null. A pause clears the distance anchor;
the first good resumed fix establishes it without adding distance. Snapshots
are copies. Haversine and projection use a 6,371,000 m spherical radius.
Current speed is path distance divided by sample elapsed time, using good,
unpaused fixes in the inclusive last ten seconds relative to the latest
input fix, without bridging the latest pause; it is zero with fewer than
two fixes or nonpositive elapsed time. Pace is null without positive moving
time. Simplification keeps full points; upload returns `[lat, lon, t, acc]`
tuples, and preview takes those filtered, simplified tuples and evenly
samples at most 32 pairs, retaining both endpoints. Inputs are valid,
chronologically ordered fixes; no input is mutated.
**Blocking:** no (proceeding on the assumption, confined to
packages/shared/src/walk.ts)

**Answer:** orchestrator — 2026-10-04. As assumed, with one change.

- *Confirmed:* epoch milliseconds and fractional seconds; the accumulator
  counts every fix and a paused fix clears the counted position; the 6 371 000
  m sphere; null pace without moving time; `[lat, lon, t, acc]` upload
  tuples; a preview sampled evenly from the simplified route with both ends
  kept; inputs valid and in order, never mutated.
- *Changed — current speed:* path length over the window counts GPS jitter
  as movement: standing still read 2 to 4 km/h in a simulation. It is the
  displacement between the oldest and the newest good fix of the window, and
  zero under the 5 m floor that distance already has *(R4.12, `07` §4.5)*.

## Q-12 — P1-7 — What are the helper and form-validation boundary shapes?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P1-7; spec/07-test-harness.md §4.6;
spec/03-data-model.md §2–§4; spec/09-screens.md §5.1
**Problem:** The task leaves age decomposition at short months, invalid or
future birthdates, the upcoming-care item shape, and validator arguments and
error codes unspecified. The password limit is in `09`, not in `03`.
**I would assume:** `petAge` takes two valid date keys (callers handle absent
birthdates), throws `RangeError` for invalid or future dates, and counts full
calendar months using the birth day clamped to the destination month's end;
the remainder is days, with years and months split from full months.
`needsWeightConfirmation` takes valid kilogram numbers and a nullable previous
value. Care items are event copies with `daysUntil`; no input is mutated.
Form validators take `unknown` objects with snake-case row field names,
excluding generated ids and replica metadata; `validatePassword` takes an
unknown scalar and reports the `password` field with the 8–128 limit of `09`.
Required form fields are name/species, pet_id/weight_kg/measured_at,
pet_id/type/title/occurred_at, and title/recurrence/starts_on/pet_ids; optional
fields use the schema defaults. Codes use Q-7's vocabulary, with
`out_of_range` for length, numeric and decimal limits. Length counts Unicode
code points like PostgreSQL, without trimming. UUID references use canonical
hyphenated UUID strings; instants use real UTC ISO timestamps ending in Z or
+00:00. Nullable schema fields accept null; other optional fields may only
be omitted. Unknown form keys are ignored (only recurrence rejects them, as
`03` expressly requires). Validation checks syntax and limits, not family
membership or permissions, which require replica/server context.
**Blocking:** no (proceeding on the assumption, confined to
packages/shared/src/pets.ts and packages/shared/src/validators.ts).

**Answer:** orchestrator — 2026-10-04. As assumed, all of it: the age in
whole months from the birth day with the rest in days, and `RangeError` for
a future birthdate; care items as copies of the event with `daysUntil`; the
required fields of each form; the codes of Q-7, with `out_of_range` for a
length or a number outside its limit; lengths in code points; canonical
UUIDs; UTC instants only; unknown form keys ignored. The password limit was
asked of `03` and lives in `04` §3: the task's Read line now says so. `07`
§4.6 states these shapes.

## Q-13 — P2-6 — How should local entity refinements compare to wire types?
**Asked:** 2026-10-04
**Where:** spec/08-tasks.md P2-6 Build; packages/shared/src/entities.ts;
services/api/app/schemas/rows.py; packages/shared/src/api-types.ts
**Problem:** P2-6 requires every hand-written entity and its generated
counterpart to be mutually assignable. A direct bidirectional conditional
type assertion fails for all ten entities: local rows allow
`revision: number | null`, while wire rows require `number`. Two additional
differences prevent raw mutual assignment: local TaskTemplate.recurrence
is the validated Recurrence union, while the generated schema is a record
of JsonValue (generated as unknown); local Walk.preview is a list of
two-number tuples, while the generated schema is number[][]. These are
existing local representation choices, not changes made by P2-6. Making
the raw types mutually assignable would require changing earlier-task
types or row schemas, or weakening the local domain types. Normalizing
the comparison instead would depart from the literal Build requirement.
**I would assume:** compare serialized shapes in entities.contract.ts,
narrowing the local revision to number and explicitly accounting for the
validated recurrence and tuple preview refinements. Require identical
keys, bidirectional compatibility of all other fields, and compatibility
of the refined fields in the domain-to-wire direction. Add compile-time
negative cases to prove that field additions, omissions and type drift
still fail. Leave existing domain types and row schemas unchanged.
**Blocking:** yes (task stopped pending the orchestrator's decision).
The contract and red API tests are committed; P2-6 remains `[ ]`.

**Answer:** orchestrator — 2026-10-04. As assumed. "Mutually assignable" was
too strong: the hand-written types are refinements of the wire types in three
places, on purpose, and none of the three is drift. The domain types and the
row schemas stay as they are. `entities.contract.ts` checks, for each of the
ten entities, with `L` the hand-written type and `W` the generated one:

1. `L` and `W` have exactly the same keys.
2. For every key not listed in 3, the two field types are mutually
   assignable.
3. Three refinements, each named in the file with its reason, are checked in
   the direction that can be checked:
   - `revision` on every entity — `L` is `number | null`, because a row
     written on the phone has none until the server answers (`10` §3); `W`
     is `number`. Compare `W` with `L` without `null`.
   - `TaskTemplate.recurrence` — `L` is the validated `Recurrence` union;
     `W` is an open JSON object. `L` must be assignable to `W`.
   - `Walk.preview` — `L` is a list of `[lat, lon]` pairs; `W` is a list
     of number lists. `L` must be assignable to `W`.
4. The file proves that it can fail: compile-time negative cases, each with
   `@ts-expect-error` and a reason, for a key added to one side, a key
   missing from one side, a scalar field of another type, and a field made
   nullable on one side only.

A new refinement is a decision for a question here, not something to add to
the list in passing. `08` P2-6 now states the rule.

## Q-14 — P2-7 — How can the invite claim reference a user not yet created?
**Asked:** 2026-10-09
**Where:** spec/04-api-contract.md §3 (`/auth/redeem`);
spec/03-data-model.md §2 (`invite_code.used_by`);
spec/08-tasks.md P2-7 Build;
services/api/migrations/versions/0002_domain_schema.py;
services/api/app/models/identity.py
**Problem:** The required atomic claim sets `used_by = :new_user` before
creating that user under the family lock. However, `used_by` references
`app_user(id)` through an immediate, non-deferrable foreign key in both the
spec and the existing schema. On a freshly migrated private PostgreSQL
database, `pg_constraint` confirms `condeferrable = false` and
`condeferred = false`; executing the specified claim for an unused,
unexpired invite and a new user id raises SQLSTATE `23503` before user
creation can run. The probe had a 30-second timeout, rolled back its writes,
and dropped its private database. Changing the order or the constraint
would depart from the spec or alter a previous task's schema.
**I would assume:** Claim atomically by setting only `used_at`, keeping the
specified unused/unexpired predicate and `RETURNING` the invite. Then take
the family lock, create the user, and set `used_by` to that user in the same
transaction before issuing the session. Roll back the whole transaction on
failure, so a failed user creation never consumes the invite. The atomic
claim still allows exactly one concurrent redeem to succeed, and the
foreign key remains immediate. Please confirm that sequence, or authorize
a migration making the foreign key deferred so the specified claim can
remain unchanged.
**Blocking:** yes (P2-7 stopped before contract or implementation changes;
its checkbox remains `[ ]`, pending the orchestrator's decision).
**Answer:** orchestrator — 2026-10-09. As assumed; no migration. The defect
was the spec's: `04` §3 wrote `used_by` in the claim, before the row it
references exists. `04` §3 now reads:

1. Begin one transaction. Claim with
   `UPDATE invite_code SET used_at = :now WHERE code = :code AND used_at IS
   NULL AND expires_at > :now RETURNING family_id, role`. No row → `410
   invite_invalid`.
2. Hash the password (off the event loop, behind the semaphore). It comes
   after the claim so an invalid code costs no hash, and before the lock so
   the family is never locked while a hash runs.
3. Take the family lock, create the user with the invite's role and the next
   identity key, set the invite's `used_by` to that user.
4. Commit, then issue the session. Any failure after step 1 — `409
   email_taken` included — rolls the whole transaction back, so the invite is
   unused again.

The claim before the lock is deliberate and safe: the family is not known
until the invite is read, and no other route updates an `invite_code` row
while holding a family lock, so the two locks cannot be taken in opposite
orders. Two redeems of one code still serialise on the invite row: the
second waits, re-checks `used_at IS NULL` and gets no row.

Two cases join the tests (`07` §5.2 R1.3, `08` P2-7): a redeemed invite
records `used_by`, and a redeem that fails with `409 email_taken` leaves the
invite usable.

## Q-15 — P2-8 — Which repeated soft-delete status takes precedence?
**Asked:** 2026-10-09
**Where:** spec/04-api-contract.md §1.2 and §8;
spec/08-tasks.md P2-8 Tests
**Problem:** §8 ends with PATCH or DELETE on a soft-deleted row returning
404. §1.2 instead requires DELETE to return the unchanged tombstone with
200, as does P2-8's test list. The owner's task instruction explicitly
requires a second delete to return 200 unchanged.
**I would assume:** Follow the owner's explicit instruction and §1.2:
PATCH on a tombstone returns 404, while DELETE returns 200 with the
unchanged tombstone and no new revision. Confine this behavior to
services/common.py's soft_delete helper. Please correct §8's conflicting
sentence when reviewing the task.
**Blocking:** no; the owner's instruction settles the implementation.

**Reference clarification:** PowerShell replaced the section symbols in
this entry with question marks. The cited sections of `04` are 1.2 and 8;
the requested correction concerns the last sentence of section 8.
**Answer:** orchestrator — 2026-10-09. As assumed. §1.2 is the rule and the
last sentence of §8 contradicted it; the mistake was the spec's. §8 now reads:
`PATCH` on a soft-deleted row → `404`; `DELETE` on one → `200` with the
tombstone, unchanged. The section symbols that the shell replaced with
question marks in this entry are restored.

## Q-16 — P2-9 — What status rejects a disabled task assignee?
**Asked:** 2026-10-09
**Where:** spec/04-api-contract.md §1.2 and §9
**Problem:** §9 requires an enabled family member as `assigned_to`, but
does not specify the status for a disabled member who still has a row in
the caller's family. §1.2 specifies 404 for absent or foreign-family scalar
references; that wording does not cover an existing disabled member.
**I would assume:** Return 422 `validation_error` with an `assigned_to`
body error for an existing disabled family member. Return 404 for an
unknown or foreign-family member. Apply this to create and PATCH in one
`services/tasks.py` assignee-validation helper.
**Blocking:** no; the distinction is confined to that helper and its test.
**Answer:** the owner — 2026-10-09 (ADR-037). Neither `422` nor `404`: an
`assigned_to` naming a removed member is read as null and stored as null, on
`POST` and on `PATCH`, before the assignment rules of `04` §5 are applied.
The task is kept, for anyone. An `assigned_to` that names no member of the
family stays `404`. The owner gave this to the running session the same
day, and `04` §9 now states it.

## Q-17 — P2-12 — How does R1 cover routers without numeric fields?
**Asked:** 2026-10-10
**Where:** docs/reviews/P2-12.md R1; spec/04-api-contract.md §1 Bodies
**Problem:** The session asks for a non-finite number in a numeric field
of one route of every other router. Auth and family bodies have no
numeric fields; health and sync routers accept no request bodies.
**I would assume:** Test numeric literals in existing string fields of
auth and family routes, and in numeric or timestamp fields elsewhere.
Assert the shared body error itself, so removing that check fails every
case even when field validation would independently return 422. Cover
all routers that accept JSON bodies, plus me, weights and health events;
exclude the read-only health and sync routers.
**Blocking:** no; the case selection is confined to the parametrization
of test_r1_every_body_router_uses_shared_non_finite_number_check in
services/api/tests/api/test_walks.py.
**Answer:** orchestrator — 2026-10-10. As assumed. The finding asked for a
numeric field on every router, and some bodies have none; that was the
review's slip. What matters is that every body passes through the one
shared check, and a non-finite literal in any field shows it, as long as the
test asserts that check's own error — which yours does.

## Q-18 — P2-13 — How many bytes does the 8 MB upload limit mean?
**Asked:** 2026-10-10
**Where:** spec/04-api-contract.md §13; spec/07-test-harness.md §5.2
**Problem:** Both sections say 8 MB without giving an exact byte count.
The tests need a precise boundary for headers and streamed bytes.
**I would assume:** 8 × 1024 × 1024 bytes, inclusive. Reject the next byte.
**Blocking:** no; the assumption is confined to UPLOAD_MAX_BYTES in
services/api/app/services/assets.py. Tests exercise both sides of it.
**Answer:** orchestrator — 2026-10-10. As assumed: 8 × 1024 × 1024 =
8 388 608 bytes, inclusive, for the declared `Content-Length` and for the
bytes counted while streaming. `04` §1.1 and §13 now say so.

## Q-19 — P2-13 — How are expired refresh-token parents pruned?
**Asked:** 2026-10-10
**Where:** spec/05-architecture.md §4.6; spec/03-data-model.md §2
**Problem:** Maintenance must delete tokens expired for more than 30 days.
A retained token may have parent_id referencing such a token. The foreign
key is immediate and has no ON DELETE action, so deleting only the expired
parent fails while its child remains.
**I would assume:** Set parent_id to null on retained children whose
parents are being pruned, then delete the expired rows in the same
transaction. Preserve the retained child's chain, hash and expiry.
**Blocking:** no; the assumption is confined to _prune_refresh_tokens in
services/api/app/services/maintenance.py and tested with a retained child.
**Answer:** orchestrator — 2026-10-10. As assumed. A kept token can indeed
name a pruned one: a token rotated on its 29th day leaves a child that
outlives it by almost a month. Clearing `parent_id` loses nothing: the
parent is deleted, so it can no longer be presented, and the child is
itself expired by then. `05` §4.6 now states it.

## Q-20 — P2-15 — What validation applies to a push token?
**Asked:** 2026-10-10
**Where:** spec/04-api-contract.md §3; spec/03-data-model.md §2
**Problem:** PUT and DELETE /me/push-token take {token}, but neither
section defines token validation. The push_device column is text with an
ExponentPushToken[...] example, without a format or length constraint.
**I would assume:** Require a string and apply the common request-body
checks of `04` §1. Do not add a prefix, length, non-empty or whitespace
rule, and preserve the token unchanged on both routes.
**Blocking:** no (proceeded on the assumption, isolated in PushToken in
services/api/app/schemas/auth.py)

**Answer (2026-10-10):** Almost as assumed: the token is opaque, with a
length. It is a string of 1 to 255 characters, stored and handed to Expo
exactly as received; the server gives it no prefix or pattern rule, because
the format is Expo's to change, and a token Expo does not know is reported
as `DeviceNotRegistered` and deleted like any stale one. The two bounds are
there because the value is a primary key that comes from outside: an empty
string is no device, and an unbounded one is a row of any size. `04` §3 now
says it, and also what `DELETE` does with a token that is not the
caller's: nothing, and still `204`.

## Q-21 — P2-15 — Does finishing a missing walk send a start push?
**Asked:** 2026-10-10
**Where:** spec/02-spec.md §3.6 R3.42; spec/04-api-contract.md §12, §15
**Problem:** Starting a walk queues walk_started. Finishing is an upsert
that can create the walk when its start never arrived, but the spec does
not explicitly say whether that creation also queues walk_started.
**I would assume:** Only POST /walks queues walk_started. A finish upsert
sends nothing because the walk is already over when the family learns
about it; announcing that someone just left would be misleading.
**Blocking:** no (the assumption is isolated in
test_q21_finish_without_start_sends_nothing in tests/api/test_push.py).

**Answer (2026-10-10):** As assumed. R3.42 is about a walk that *starts*:
only `POST /walks` sends `walk_started`. A finish that creates the walk
means the phone was offline for the whole walk, and "saiu para passear"
would arrive when the walk is over. `04` §15 now says it.

## Q-22 — P2-15 — What data identifies duplicate and walk pushes?
**Asked:** 2026-10-10
**Where:** spec/04-api-contract.md §15
**Problem:** The completion example defines every data field. The table
names completion_duplicate and walk_started but does not define their
data fields, while both visible messages need event data.
**I would assume:** completion_duplicate uses the completion data shape
with type completion_duplicate and the winner's completion_id. A
walk_started message carries exactly type, walk_id and pet_id. Neither
visible message carries silent. Confine these shapes to the test helpers
duplicate_data and walk_data; keep the common visible envelope unchanged.
**Blocking:** no (the assumptions are isolated in those two helpers in
tests/api/test_push.py).

**Answer (2026-10-10):** As assumed. `completion_duplicate` carries the
fields of `completion` with its own `type` and the **winner's**
`completion_id` — the tap opens the day of that occurrence (`09` §9), which
needs `task_id` and `occurrence_key`. `walk_started` carries `type`,
`walk_id` and `pet_id`. Neither has `silent`. `04` §15 now shows both.

## Q-23 — P2-16 — How does the shared Completion bridge Stage A?
**Asked:** 2026-10-10
**Where:** spec/04-api-contract.md §2, §16; Stage A session instructions
**Problem:** Stage A requires duplicate_of to default to null until the
database migration exists, forbids test changes, and requires shared tsc
to pass. The shared entity contract checks exact keys and field types.
Adding the generated wire field alone breaks that check; making the local
field required also breaks existing completion builders in the tests.
**I would assume:** Add duplicate_of as an optional string-or-null field
to the shared Completion type, matching the generated defaulted field.
Keep the exact contract check and all existing tests unchanged. A later
stage can make the field required when its schema and builders change.
**Blocking:** no; the transitional declaration is confined to Completion
in packages/shared/src/entities.ts.

**Answer (2026-10-10):** As assumed, for the contract and Red commits only.
The row always carries `duplicate_of`: `04` §2 now lists it and `03` §5 has
the column — both were missing, and that was the spec's gap. At the task's
last code commit the Pydantic field has no default, the generated type is
required, the shared `Completion` declares `duplicate_of: string | null`,
and the builders in the shared tests set it. The shared type changes in the
same commit as the schema, because the exact-agreement check makes the two
one change. An optional field left after P2-16 would be a finding.

## Q-24 — P2-17 — How many values does a reseeded route point carry?
**Asked:** 2026-10-10
**Where:** spec/11-reserve-server.md §3; spec/04-api-contract.md §12;
spec/fixtures/reseed-vectors.json, walk-route vectors
**Problem:** Reseed must reuse the bounds and models of the entity's
routes. WalkFinish and WalkRoute use points with four values: latitude,
longitude, timestamp and accuracy. Both walk-route vectors instead send
points with only latitude and longitude. The fixture's partial-row rule
does not define how the factory fills missing values inside a point.
**I would assume:** Reseed uses the existing four-value RoutePoint and
WalkFinish's route length bound. The fixture should carry four-value
points, or the harness should explicitly expand their missing values.
**Blocking:** no for the contract; the assumption is confined to the
points declaration of ReseedWalkRoute in app/schemas/reseed.py. The vector
tests will need the answer before they can send these incoming routes.

**Answer (2026-10-10):** As assumed: four values, as in `04` §12, with the
route's own bound of 5 000 points. The fixture was wrong, not the model —
its route points carried two values, the shape of a preview. They carry
`[lat, lon, t, acc]` now, `11` §3 says so, and the fixture validator
refuses a route point that is not four numbers.

## Q-25 — P2-17 — What order do single-row vector calls use?
**Asked:** 2026-10-10
**Where:** spec/07-test-harness.md §3; spec/11-reserve-server.md §3;
spec/fixtures/reseed-vectors.json
**Problem:** The reference-arrival vector lists the completion before its
template, pet and member. Sending one row per call in that order refuses
the dependent rows. The duplicate-before-winner vector similarly loses
its duplicate_of reference, which §3 says is stored as null when absent.
Neither sequence can reach the vector's expected state.
**I would assume:** The single-row way uses entity and dependency order,
including winners before rows naming them in duplicate_of. The other
three ways preserve the specified ordering of each batch.
**Blocking:** no for Red; this assumption is confined to vector_batches
in tests/sync/test_reseed.py and needs review before the merge lands.

## Q-26 — P2-17 — How are explicit null walk metrics sent?
**Asked:** 2026-10-10
**Where:** spec/fixtures/reseed-vectors.json, walk-status vectors;
app/schemas/reseed.py, ReseedWalk
**Problem:** Two vectors explicitly send null distance_m and duration_s.
The committed contract and database require non-null numbers. Filling
missing fields from factories does not cover explicit null values. These
vectors would fail validation before reaching the merge stub.
**I would assume:** In vector input only, those null metrics stand for
the valid factory defaults, since active and discarded walks have no
finished metrics. Preserve the fixture and the committed contract.
**Blocking:** no for Red; the normalization is confined to
complete_vector_row in tests/sync/test_reseed.py. This interpretation
needs review before the merge lands; assertions of expected state stay
exactly as the fixture gives them.

## Q-27 — P2-17 — Does RS-4 exclude intentional undo tombstones?
**Asked:** 2026-10-10
**Where:** spec/11-reserve-server.md §3, RS-4;
spec/fixtures/reseed-vectors.json, an-undone-completion-makes-no-duplicate
**Problem:** RS-4 says every other completion names the live winner, whose
completed_at is earliest. The vector instead retains an earlier undone
completion with duplicate_of null alongside a later live completion.
**I would assume:** Intentional undo tombstones are excluded from the
contenders. Only live rows and merge duplicates must satisfy the winner
ordering and duplicate_of assertions.
**Blocking:** no for Red; the assumption is confined to assert_rs4
in tests/sync/test_reseed.py and needs review before the merge lands.

## Q-28 — P2-17 — How does RS-1 observe incoming walk routes?
**Asked:** 2026-10-10
**Where:** spec/08-tasks.md, P2-17 Tests; spec/04-api-contract.md §2, §6;
spec/11-reserve-server.md §3
**Problem:** RS-1's server test asks /sync from zero to list every accepted
incoming row. walk_routes is accepted by reseed but deliberately excluded
from sync, whose Walk row never carries the route.
**I would assume:** Assert all ordinary rows in /sync; for a walk_routes
row assert its owning walk appears there, and read the stored route via
GET /walks/{id}/route. A replacement attempt may leave the existing route.
**Blocking:** no for Red; confined to assert_rs1 in
tests/sync/test_reseed.py and needs review before the merge lands.

**Answers (2026-10-10), Q-25 to Q-28:**

- **Q-25 — as assumed.** Inside one call the order of the rows never
  matters: the server applies the entities in its own order. From one call
  to the next a row must follow what it names, which is how a phone sends
  its batches (`11` §4.3). "One row per call" means those calls in the
  entity order of `11` §3, winners before the rows that name them. RS-2 and
  `07` §3 say so now; they promised more than the design gives.
- **Q-26 — the fixture was wrong.** A walk that is not finished has zero
  metrics, never null: the columns are `NOT NULL DEFAULT 0` (`03` §7). The
  two vectors send `0` now. Remove the stand-in from `complete_vector_row`
  and send the rows as the fixture gives them.
- **Q-27 — as assumed.** A completion that a person undid is not a
  duplicate and competes with nobody. RS-4 is reworded to say which rows it
  speaks of: those that were live when a merge met them.
- **Q-28 — as assumed.** A route never travels in `/sync`; its walk does,
  and the route is read through `GET /walks/{id}/route`. The task's Tests
  line says so.

One thing the questions did not ask and the review of the tests found:
`test_rs4_duplicate_push_targets_both_people_after_commit_once_per_loser`
sends every device the same message, under the loser's name. R5.13 says each
person is told that **the other** also marked it. `04` §15 and `11` §3.1
now spell it out: the author of the completion that stays hears the other
author's name, the author of the duplicate hears the first one's, and
nobody hears anything when one person made both. The test follows that.

## Q-29 — P2-17 — Should the lock poll refresh its activity snapshot?
**Asked:** 2026-10-10
**Where:** tests/sync/test_reseed.py,
test_rb3_rs5_actor_removed_while_waiting_for_family_lock_is_401;
spec/04-api-contract.md §5, RB-3
**Problem:** The candidate merge passes 182 of 183 reseed tests. The
remaining test times out in wait_until_blocked, before removing the
actor. Running that test alone also times out. Its blocker transaction
polls pg_stat_activity, whose first snapshot can predate the request's
new database connection and is reused by the later polls.

An independent probe in an isolated database reproduced the problem:
after the first activity read, a new connection waited for the blocker's
transaction lock. Direct pg_blocking_pids on that connection observed
the wait. The test's activity predicate on the blocker still returned
false; after SELECT pg_stat_clear_snapshot(), it returned true. Existing
lock tests in tests/security/test_role_matrix.py use the request's known
backend pid with pg_blocking_pids directly, avoiding this cached view.
The reseed test's recorded 500 occurs when it cancels the pending
request after the observation timeout; it is not a merge exception.
**I would assume:** Clear the blocker's statistics snapshot before each
pg_stat_activity poll. Keep the five-second timeout, the real family
lock, the removal, and every response and database assertion unchanged.
This repairs observation without relaxing RB-3 or replacing the service.
**Blocking:** yes (task stopped). No test was changed. The candidate
implementation and diagnostic probe are saved outside the repository;
the code in the tree remains the committed stub until this is answered.

**Answer (2026-10-10):** As assumed, and well found. The poll reads
`pg_stat_activity` inside the transaction that holds the lock, and
PostgreSQL keeps one snapshot of that view for the whole transaction, so a
request that connects after the first read is never seen. Call
`pg_stat_clear_snapshot()` before each read. That repairs what the test
observes and relaxes nothing: the real lock, the five-second limit, the
removal, the `401` and the table comparison stay as written. It is a
commit of its own, `test(api)`, before the merge lands.

## Q-30 — P2-17 — Should the RB-3 observer include the reseed service?
**Asked:** 2026-10-10
**Where:** tests/security/test_role_matrix.py,
test_rb3_waiting_mutation_uses_locked_actor_and_writes_nothing;
spec/04-api-contract.md §5, RB-3
**Problem:** The candidate merge passes all 183 reseed tests, including
the repaired real-lock removal test. The security gate reports one
failure and 179 passes: the reseed case times out awaiting arrived,
before its PostgreSQL wait poll or actor removal.

The security test patches lock_family in idempotency, family, auth and
assets, but not the new reseed service. Reseed imports the real lock from
app.locks, like those services, so its request waits for the family lock
without setting the observer's event. The recorded 500 follows request
cancellation in the test's cleanup, not a merge exception.

Routing the call through idempotency.lock_family would let that observer
see it, but strict mypy rejects this implicit re-export. That experiment
was removed; the candidate retains its direct app.locks import.
**I would assume:** Add the reseed service to this test's observed_lock
patches. Keep the real lock, both five-second limits, actor removal,
401 response and whole-database comparison exactly as written. No test
has been changed and no assertion needs relaxing.
**Blocking:** yes (task stopped before changing a test). The candidate
is saved outside the repository, and app/ is the committed stub. The
security gate failed; contract-check and full verify were not run.

**Answer (2026-10-10):** As assumed. That test watches the lock by
patching `lock_family` in each module that takes it, so a new service that
takes the family lock is one more line there — as `assets` was. The patch
needs the name to exist in `app.services.reseed`, so it lands in the same
commit as the merge; say so in its message. The real lock, both limits,
the removal, the `401` and the whole-database comparison stay as written.
Keep the direct import from `app.locks`.

## Q-31 — P4-1 — What copy should the validator messages use?
**Asked:** 2026-10-15
**Where:** spec/08-tasks.md P4-1 Build; spec/09-screens.md §4.2, §5.1,
§10; packages/shared/src/validators.ts; spec/QUESTIONS.md Q-7, Q-12
**Problem:** P4-1 requires validator messages, and the session's Stage B
requires tests for them before implementation. The shared validators
return field names and eight codes: required, invalid, out_of_range,
duplicate, unsorted, too_many, mismatch and unknown_key. Q-7 and Q-12
define those data shapes and limits, but not their user-facing wording.
The screens spec gives one pet-name validation sentence in §4.2; §5.1
requires inline validation with server limits, and §10 has no validator
message table. The existing strings.ts contains only appName. There is
no approved text to assert for the other validator results, and the
session requires copy verbatim from the spec rather than invented text.
**I would assume:** Preserve the supplied pet-name sentence. Author one
central Portuguese message mapping in i18n/strings.ts for all eight
codes, with field-specific required and range messages for name, title,
weight and password. Keep the shared validators unchanged and format
their field/code data in i18n/format.ts. The orchestrator must either
authorize authoring that copy or supply its exact text, including the
fallback for a field without a specific message, before tests freeze it.
**Blocking:** yes (Stage B stopped before adding stubs or tests). The
session explicitly requires stopping for unspecified product copy.

**Answer:** orchestrator — 2026-10-15. The copy is written: `09` §10 now
has the validation message table, keyed by field and code, first match
wins, with "Confira este campo." as the fallback for any other field or
code — the user never sees a raw code. "Informe o nome." stays as `09`
§4.2 gives it. The shared validators stay unchanged; `format.ts` exposes
`formatValidationError`, and `format.test.ts` covers every row of the
table as it covers every other row of `09` §10.

## Q-32 — P4-1 — Which values govern press scale and sheet fling?
**Asked:** 2026-10-15
**Where:** spec/06-ux-motion-spec.md §3, §4.6, §4.7, §5, §7;
apps/mobile/src/ui/__tests__/primitives.test.tsx
**Problem:** PressableScale is listed without a default pressed scale.
The 0.97 scale in §4.6 belongs to the pet-card hero interaction; the
0.92 scale in §4.2 belongs to StarCheck. Neither section assigns a
default to the generic primitive. The Sheet rule in §4.7 defines the
30 percent drag threshold but calls its other dismissal condition a
fast fling without specifying a downward velocity threshold. The red
gesture tests use velocities 0 and 10000; those fixtures do not define
the product threshold between them. Implementing the primitives would
therefore require choosing product values, which the session forbids
without an orchestrator answer.
**I would assume:** Use 0.97 as PressableScale's default pressed scale,
with spring.stiff on press-in and release/cancellation. With Reduce
Motion enabled, leave its scale at 1 without scheduling a spring.
Dismiss a Sheet when translationY exceeds 30 percent of its measured
height or downward velocityY exceeds 1000 dp/s. Keep the boundary
exclusive, matching the wording past 30 percent. Store the press scale,
sheet dismissal fraction and fling velocity as named motion tokens.
**Blocking:** yes (this Stage C commit stopped before changing code or
tests). The session requires stopping for unspecified product values.

**Answer:** orchestrator — 2026-10-15. As assumed, and now in `06`:
`PressableScale` presses to 0.97 with `spring.stiff` and returns to 1 on
release or cancel (§4.7); under Reduce Motion it stays at 1 and schedules
no spring (§5). A `Sheet` dismisses when dragged down past 30% of its
height, or flung down faster than 1000 dp/s (§4.7); both bounds are
exclusive. Keep the three values as named motion tokens.

## Q-33 — P4-1 — How should the native TextField role be tested?
**Asked:** 2026-10-15
**Where:** spec/06-ux-motion-spec.md §7;
apps/mobile/src/ui/__tests__/primitives.test.tsx, TextField case;
React Native 0.86.3 ViewAccessibility types and ReactAccessibilityDelegate;
React Native Testing Library 14.0.1 helpers/accessibility.js
**Problem:** The Stage B TextField case queries getByRole('textbox').
The installed React Native Role union excludes textbox: assigning it
to TextInput.role fails strict type-checking. Android's AccessibilityRole
also has no textbox entry, and its fromValue implementation rejects an
unknown accessibilityRole. The installed test library does not infer a
textbox role for TextInput; without an explicit role its getRole helper
returns none. Thus a correct native TextInput does not satisfy this
assertion, and adding an unsupported role merely to satisfy the test
would misrepresent the native accessibility contract. Section 7's blanket
explicit-role rule does not address controls that supply their own
native accessibility semantics.
**I would assume:** Keep TextInput's native EditText semantics without a
role override and give it the required accessibilityLabel. Change the
TextField case to select its input by that label, retaining every value,
touch-target, change callback, disabled-state and disabled-edit assertion
in both themes. Clarify §7 that a native control's built-in role meets
the role requirement. The orchestrator must approve this assertion
repair before implementation resumes.
**Blocking:** yes (Stage C stopped under the session's rule against
changing Stage B assertions). No test was changed. The unfinished
primitive implementation was restored to the committed stubs; only this
question remains in the working tree besides COMMIT_MSG.txt.

**Answer:** orchestrator — 2026-10-15. As assumed. The `TextField` keeps
the native input's own semantics, with no role override, and has its
`accessibilityLabel`; its case finds the input by that label and keeps
every other assertion, in both themes. This is a repair of a Stage B
assertion that no correct input could meet, approved here; the commit
that makes it says so. `06` §7 now names the exception.

## Q-34 — P4-1 — How should other valid schedules be summarized?
**Asked:** 2026-10-15
**Where:** spec/08-tasks.md P4-1 Build; spec/09-screens.md §5.1, §5.2;
spec/02-spec.md R3.13–R3.14; apps/mobile/src/i18n/format.ts
**Problem:** The four §5.2 examples cover interval-one daily, weekly and
monthly rules, and an all-day once rule. The shared Recurrence type and
validators also accept intervals from 2 to 365, any nonempty weekday or
month-day selection, and timed once rules. Section 5.1 supplies the form
stepper label but does not define those summary strings. Ignoring an
interval would misstate when care is due; rejecting valid rules would
leave the formatter incomplete. The session requires copy verbatim from
the spec and a stop for unspecified product copy, so the final formatter
commit cannot safely choose these outputs.
**I would assume:** Keep the four approved examples. For daily intervals
above one, use "A cada N dias" before the time suffix. For weekly and
monthly intervals above one, prefix the existing day list with
"A cada N semanas · " or "A cada N meses · ". Order weekdays Monday first,
capitalize only the first weekday abbreviation, and separate them with
commas. Sort month days numerically, use "Dia N" for one or "Dias A, B e
C" for several, with " e " before the last day. Append " · o dia todo"
when recurring rules have no times, or " · HH:mm, HH:mm" otherwise. For
once rules, preserve "Uma vez · dd/MM" without an all-day suffix and
append the time suffix when times exist. Keep this assembly in
formatScheduleSummary and add cases without changing frozen assertions.
The orchestrator must confirm or replace this copy and ordering first.
**Blocking:** yes (the last Stage C commit is stopped before changing
formatters, copy or tests). Only this question and COMMIT_MSG.txt are in
the working tree; the implementation remains at da2e8d6.

**Answer:** orchestrator — 2026-10-15. As assumed, now written as the
rule under the examples of `09` §5.2: cadence, days and times joined by
` · `, each part starting with a capital; `A cada N dias|semanas|meses`
when the interval is above 1; weekdays Monday first and comma-separated;
month days ascending, `Dia N` or `Dias A, B e C`; `o dia todo` when a
recurring rule has no times, and nothing in its place for a once rule.
The four examples stay; the four new ones are cases for `format.test.ts`.

## Q-35 — P4-2 — What are the star-layer values and missing glyph shapes?
**Asked:** 2026-10-15
**Where:** spec/06-ux-motion-spec.md §4.1 and §4.11;
spec/08-tasks.md P4-2 Build; apps/mobile/src/ui/cosmos/stars.ts and
glyphs.ts
**Problem:** Section 4.1 specifies radii of 0.6–1.8 dp, layer counts,
twinkle factors and theme scaling, but no base opacities or allocation
of radii to layers. It requires one points draw call per layer. Skia
2.6.2's PointsProps accepts SkPoint[] and a single paint, whose
strokeWidth and opacity apply to the whole draw call; independent
per-star radii or opacities cannot be expressed by that call alone.
The spec does not say whether these values vary within a layer.
Section 4.11 gives exact sparkle and paw-star geometry, but no
five-point star vertices or inner radius and no crescent path. The
masters in spec/brand contain the sparkle and paw-star, not these two
glyphs. Implementing the first green stage would therefore choose
product values and geometry the session requires the spec to settle.
**I would assume:** Generate layers in order 0, 1, 2 with counts
floor(count × 0.5), floor(count × 0.3), and the remaining stars.
Use uniform radii [0.6, 1.2, 1.8] dp and base opacities
[0.35, 0.55, 0.8] for those layers. Use mulberry32 to draw x and then y
for each star; layer values themselves do not consume random draws.
Draw each layer with round points, strokeWidth = 2 × radius, and its
base opacity multiplied by the specified twinkle and theme factors.
This preserves every generated value with exactly three points calls.
Keep the layer values together in a named star-layer token.
For starPath(x, y, R), use a closed polygon with ten vertices, starting
at angle −90 degrees and advancing 36 degrees per vertex, alternating
outer radius R and inner radius 0.5R. For crescentPath(x, y, R), scale
and translate this normalized path, which leaves a crescent opening
to the right:

    M0 -1 A1 1 0 1 0 0 1 A0.6 1 0 0 1 0 -1 Z

Keep the polygon ratio and crescent path in glyphs.ts. The sparkle and
paw-star geometry remain exactly as section 4.11 gives them. The
orchestrator must confirm or replace these values and shapes first.
**Blocking:** yes (the first Stage C implementation is stopped before
any code or test changes). Only this question and COMMIT_MSG.txt are
in the working tree; the red implementation remains at 3d4d506.

**Answer:** orchestrator — 2026-10-15. As assumed, now written into `06`:
the layer table (radius 0.6 / 1.2 / 1.8 dp, base opacity 0.35 / 0.55 / 0.8,
shares floor 50% and 30% and the rest, `x` then `y` per star, layer 0
first) in §4.1 as `starLayers` in `stars.ts`; the ten-vertex star with
inner radius 0.5 R and the crescent path, horns to the right, in §4.10,
both in `glyphs.ts`. The red tests stand as written.

## Q-36 — P4-2 — What are Starfield's clamp and nebula geometry?
**Asked:** 2026-10-15
**Where:** spec/06-ux-motion-spec.md §4.1;
apps/mobile/src/ui/cosmos/Starfield.tsx
**Problem:** Section 4.1 gives parallax factors but says only "clamped",
without lower or upper bounds or whether the clamp applies to scrollY
or to each layer's translation. The optional nebula has two blurred
radial gradients with named colours and 18% opacity, but no centres,
radii or blur amount. Skia 2.6.2 requires a centre and radius for a
RadialGradient and a numeric blur for a BlurMask. These are product
values and geometry, which the session requires the spec to settle
before implementation. The Starfield API also makes density and nebula
optional, so their default choices need to be explicit.
**I would assume:** Clamp scrollY to [0, height] first, then multiply by
each layer's specified parallax factor for its positive Y translation.
Without scrollY, or under Reduce Motion, translation is zero. Use the
header density when omitted, and show no nebula unless requested.
For the nebula, with w = width, h = height and L = max(w, h):

- nebulaA: centre (0.25w, 0.25h), radius 0.6L;
- nebulaB: centre (0.75w, 0.65h), radius 0.5L;
- both fade from their token colour at the centre to the same colour
  with zero alpha at the radius, with overall opacity 0.18;
- both use a normal Gaussian blur with sigma 0.08 × min(w, h), and
  remain static.

Keep these design values together in a named starfield token in
apps/mobile/src/ui/tokens/cosmos.ts. The orchestrator must confirm or
replace the clamp, geometry and defaults first.
**Blocking:** yes (the Starfield green stage is stopped before any code
or test changes). Only this question and COMMIT_MSG.txt are in the
working tree; the implementation remains at 928d80a.

**Answer:** orchestrator — 2026-10-15. As assumed, with one change: the
sign of the parallax. The canvas stays put behind the scrolling content,
so for depth each layer moves **up** by `clamp(scrollY, 0, height) ×
factor` (a negative Y translation), the near layer most. The nebula
geometry, its blur and the defaults (header density, no nebula) are as
assumed, now in `06` §4.1, with the numbers in `ui/tokens/cosmos.ts`.

## Q-37 — P4-2 — How should the checked star meet light-theme contrast?
**Asked:** 2026-10-16
**Where:** spec/06-ux-motion-spec.md §2.1 and §4.2;
apps/mobile/src/ui/cosmos/StarCheck.tsx;
apps/mobile/src/ui/tokens/pairs.ts
**Problem:** The checked control has an accentSoft-filled ring and a
star-coloured five-point star. In the light theme, star #B87B06 against
accentSoft #E6E0FF has contrast 2.804084:1, using the same luminance
formula as ui/__tests__/contrast.test.ts. That misses §2.1's 3:1
minimum for meaningful graphics: the lit star communicates completion.
The existing contrast registry covers star/bg and star/surface, but
not star/accentSoft, so its current passing tests do not cover this
new use. The session delegates visual layout numbers but explicitly
reserves accessibility and contradictions for the orchestrator.
**I would assume:** Keep the specified star fill and accentSoft ring
fill. In the light theme only, outline the star in starText using the
existing 1.75 dp icon stroke width, held in ui/tokens/cosmos.ts.
starText #8A5A00 against accentSoft has contrast 4.648688:1, so the
outline makes the completion shape readable without changing the
palette or the gold fill. Leave the dark star without an outline.
Register starText/accentSoft as a meaningful graphic pair, and add a
case for the light outline while preserving every Stage B assertion.
The orchestrator must approve this treatment or specify another one.
**Blocking:** yes (the StarCheck/Sparks green stage is not complete).
Its partial implementation and eight added tests remain uncommitted
for continuation; no test was weakened, skipped or deleted. Lint and
types pass. The cosmos gate has 48 passes and 20 remaining stub
failures; the mobile suite has 920 passes and the same 20 stub failures.
The contrast measurement above blocks reporting this stage as green.
Only this question belongs to the accompanying question commit;
the implementation and added tests stay pending its answer.

**Answer:** orchestrator — 2026-10-16. As assumed: the gold fill and the
`accentSoft` ring stay; in the light theme only, the lit star takes a
1.75 dp `starText` outline (the stroke width in `ui/tokens/cosmos.ts`),
and `starText`/`accentSoft` joins `pairs.ts` as a meaningful-graphic pair.
The dark star has no outline. Now in `06` §4.2.

## Q-38 — P4-2 — How does a shooting-star celebration play and settle?
**Asked:** 2026-10-16
**Where:** spec/06-ux-motion-spec.md §4.1, §4.5 and §5;
spec/08-tasks.md P4-2 and P5-9;
apps/mobile/src/ui/cosmos/ShootingStars.tsx and Starfield.tsx
**Problem:** Section 4.5 specifies five staggered meteors over 1600 ms
and says the starfield "brightens to full and settles". Section 4.1
normally multiplies each layer's base opacity by twinkle and, in the
light theme, by 0.28. Neither section defines which factors "full"
overrides, when the brightness rises and settles, or whether the
settled sky returns to normal or stays bright. Section 5 requires a
still, bright sky under Reduce Motion, without defining its duration.
The red component signature has a boolean play request, but the spec
does not say whether an interrupted request replays when focus or
foreground activity returns. Replaying affects the once-per-day
celebration. The session delegates meteor geometry, but explicitly
reserves behaviour and timing that changes meaning for an answer.
**I would assume:** P4-2 supplies the controlled visual effect only.
P5-9 owns allDone, today's scope, kv.celebrated_on and the header copy.
Treat an initial play=true or a false-to-true edge as one request per
mounted instance. A request made while inactive waits for activity.
Once it starts, it is consumed: rerenders, focus/foreground return,
size changes and Reduce Motion changes do not replay its meteors.
Setting play=false cancels and resets it; a later true requests a new
play. Unmounting cancels all work; persistence remains P5-9's concern.

Use one shared, linear timeline lasting 1600 ms for the whole group.
Meteor starts are 0, 160, 320, 480 and 640 ms; each crossing lasts
960 ms, so the fifth ends at 1600 ms. Geometry, head size and path
choices remain delegated visual values in ui/tokens/cosmos.ts.

During normal play, interpolate each layer's combined opacity from
its ordinary base × twinkle × theme opacity to 1 during the first
duration.quick (200 ms), hold full until 1400 ms, then interpolate
back to its ordinary opacity during the last 200 ms. Full means all
three star layers at opacity 1 in both themes; radii, starfield colour,
sky gradient and nebula are unchanged. The sky returns to its normal
twinkle after the 1600 ms effect, even if play stays true.

Under Reduce Motion, schedule no animation and draw no meteors.
While play=true, show the three layers still at combined opacity 1;
play=false restores the ordinary still sky. Turning Reduce Motion on
during a celebration cancels its animation and selects that still
bright state; turning it off does not replay a consumed celebration.
Losing focus or foreground activity cancels an in-flight celebration,
hides its meteors and restores the normal still sky. On return it
stays consumed; Reduce Motion still selects the bright state if play
is true. All brightness and meteor work shares Starfield's one canvas
and uses UI-thread shared values, with no clock reads or JS timers.
The orchestrator must confirm or replace this behaviour before code.
**Blocking:** yes (the ShootingStars green stage). The tree contains
only this question and COMMIT_MSG.txt; no code or tests have changed.
The accepted visual choices of the preceding stage stay untouched.

**Answer:** orchestrator — 2026-10-16. As assumed, with one change: under
Reduce Motion the still, bright sky lasts the same 1600 ms (cuts, no fades,
no meteors) and then returns to the ordinary still sky, rather than staying
bright while `play` is true, so both paths end the same way whatever P5-9
does with `play`. Now in `06` §4.5.

## Q-39 — P4-3 — Which copy sources and toast dismiss label should the shell use?
**Asked:** 2026-10-16
**Where:** spec/08-tasks.md P4-3; spec/09-screens.md §1, §3.1 and §10;
spec/10-client-sync.md §8; spec/11-reserve-server.md §4.6;
spec/06-ux-motion-spec.md §4.7 and §7;
apps/mobile/src/i18n/strings.ts;
apps/mobile/src/ui/primitives/Toast.tsx
**Problem:** The session permits copying only from `09` §3.1 and §10
into strings.ts and requires a question for missing copy or accessibility
decisions. Section 3.1 names the indicator and its reserve suffix but does
not give its three labels. Those labels are defined in `10` §8 and `11`
§4.6. The four tab names appear in the other screen headings of `09`,
outside those two permitted sections. Section 4.7 of `06` requires a
toast dismiss button, and §7 requires its accessibility label, but `09`
does not specify that button's text. The existing Toast and ToastProvider
require dismissLabel from their caller; strings.ts has no such label.
The red indicator cases must assert the specified text, and the shell
must supply the toast host's dismiss label without inventing app copy.
**I would assume:** Permit the shell to copy the exact connection labels
from `10` §8 and `11` §4.6: `sincronizado`, `sincronizando` with ` (n)`
only when n is positive, `offline`, and the online suffix ` · reserva`.
Use the four screen names already present in `09`: `Hoje`, `Pets`,
`Passeios`, `Ajustes`. Specify `Fechar` for the toast dismiss button and
its accessibility label. Keep all of these in strings.ts, with tests
reading their expected copy from the i18n directory, and keep the login
screen a placeholder with the existing Pawlaris name. The orchestrator
must confirm or replace the dismiss label and permit these copy sources.
**Blocking:** yes (P4-3 Stage A stopped before code or test changes).
The required spec sections and supporting modules have been read. The
working tree contains only this question and COMMIT_MSG.txt. No task
checkbox, dependency, existing assertion or review file has changed.

**Answer:** orchestrator — 2026-10-16. As assumed. The brief's "only `09` §3.1
and §10" was too narrow: copy may come verbatim from any section of the
spec that gives it, here `10` §8 and `11` §4.6 for the indicator and the
screen names of `09` for the tabs. The dismiss button of a toast and of a
sheet reads `Fechar`, also its accessibility label, now in `09` §10.

## Q-40 — P4-3 — What are the mobile log rotation and export rules?
**Asked:** 2026-10-18
**Where:** spec/08-tasks.md P4-3; spec/05-architecture.md §5 and §7;
spec/09-screens.md §7; spec/11-reserve-server.md §4.3;
spec/02-spec.md R7.3; apps/mobile/src/platform/logger.ts
**Problem:** The spec requires a 256 KB rotating mobile log and a text
export, without defining whether the limit applies to the active file
or all retained files, how many archives survive, or the line format.
Section 11 §4.3 requires a rejected reseed row's entity and id to be
logged without its content. R7.3 forbids credentials in the export.
The logger tests need a definite rotation boundary and export policy.
The earlier technical question about this policy remains unanswered.
**I would assume:** Use UTF-8 JSON lines with an injected-clock UTC
timestamp and an event field. Interpret the limit as 256 KiB
(262144 bytes) per file. Before an append would exceed that limit,
replace one previous archive with the active file and start a new
active file. Export the archive followed by the active file, oldest
first. Bootstrap logs a fixed rejected-row event with its entity and
UUID only; it never passes row contents, credentials or error bodies.
The performance marker retains its specified console output.
**Blocking:** yes (the logger slice only). No implementation, tests,
dependencies, task checkbox or accepted slice has changed. The working
tree contains this question and COMMIT_MSG.txt. The orchestrator must
confirm or replace the retention and format policy before this slice.

**Answer:** orchestrator — 2026-10-18. As assumed, now in `05` §7. One JSON
object per line, UTF-8: `ts` (UTC ISO 8601 from the injected `Clock`),
`level` (`info` · `warn` · `error`), `event` (a fixed English name) and
flat fields. The limit is 256 KiB per file: an append that would take the
active file past it first replaces the single archive with the active file.
At most two files survive, 512 KiB in all. The export is the archive and
then the active file, oldest first. Callers pass ids and codes, never row
contents, tokens, passwords or response bodies. The performance marker
keeps its own console line.

## Q-41 — P4-4 — What copy should confirm a different-user login?
**Asked:** 2026-10-18
**Where:** spec/08-tasks.md P4-4 Tests; spec/10-client-sync.md §8.1;
spec/02-spec.md R1.11; spec/09-screens.md §2, §7 and §10;
spec/06-ux-motion-spec.md §7;
apps/mobile/src/auth/lifecycle.ts
**Problem:** The lifecycle requires confirmation before a different user
discards the previous user's non-empty outbox. P4-4 requires a screen
test for that confirmation, but no section specifies its dialog copy.
The only supplied discard confirmation is for logout in `09` §7:
"N alterações ainda não foram enviadas e serão perdidas. Sair mesmo assim?"
Its final question describes logout, not entering another account.
The accepted Sheet also requires an accessibility label, and the
confirmation needs an affirmative action. The session requires verbatim
spec copy and a question for missing copy or accessibility decisions.
**I would assume:** Use a Sheet titled "Entrar com outra conta?", also
its accessibility label. Its body is "N alterações ainda não foram
enviadas e serão perdidas." with the actual outbox count substituted.
The affirmative button reads "Entrar" and the refusal button reads
"Cancelar", with matching accessibility labels. The Sheet retains
`09` §10's standard "Fechar" dismissal; cancellation, close, back,
scrim and drag all refuse adoption and preserve the previous state.
Only an affirmative action resolves `confirmDiscard(count)` to true
for the accepted lifecycle's wipe, adopt and login kick sequence.
Store the approved text in `src/i18n/strings.ts`; no alternative
authentication or wipe implementation is needed.
**Blocking:** yes (P4-4 Stage A stopped before code or test changes).
The confirmation assertions need the orchestrator's copy decision.
The working tree contains only this question and COMMIT_MSG.txt.
No dependency, task checkbox, existing assertion or review has changed.

**Answer:** orchestrator — 2026-10-18. A `Sheet` titled "Entrar com outra
conta?" (also its accessibility label), body "N alterações ainda não foram
enviadas e serão perdidas." with the outbox count, and one action,
**Entrar mesmo assim** `login-discard-confirm`, echoing the logout
confirmation of `09` §7. The refusal is the Sheet's own `Fechar` and every
other way of dismissing it; there is no separate Cancelar. Only the action
resolves `confirmDiscard` to true. Now in `09` §2.1.

## Q-42 — P4-6 — What should the weight chart empty state say?
**Asked:** 2026-10-19
**Where:** spec/02-spec.md R2.6; spec/06-ux-motion-spec.md §6 and §4.10;
spec/09-screens.md §4.3 and §10; spec/08-tasks.md P4-6 Tests.
**Problem:** The chart must show an empty state with fewer than two
entries, but the spec gives no weight empty-state copy. The four scenes
in §4.10 cover other screens. The required empty-state test needs an
expected message.
**I would assume:** Show "Registre pelo menos dois pesos para ver a
evolução." for zero or one entry, with no chart axes or measurement
line. Keep this copy in `apps/mobile/src/i18n/strings.ts`, under
`weights.empty`, so the answer can replace it in one place.
**Blocking:** no. The Red tests use that isolated copy assumption.
**Answer (2026-10-19, the orchestrator):** as assumed. With zero or one
entry, the Peso section shows "Registre pelo menos dois pesos para ver a
evolução." in place of the chart: no axes, no line, no stars. The latest
value and the list of entries above and below it stay. The copy is
plain, because the chart is not one of the four sky scenes of `06`
§4.10. Now in `09` §4.3.

## Q-43 — P4-7 — Does the health detail route open the editable form?
**Asked:** 2026-10-19
**Where:** spec/08-tasks.md P4-7 Tests; spec/09-screens.md §4.3.
**Problem:** Tapping a timeline item opens `health/[id]`, and the health
form says that editing adds Excluir. The spec does not explicitly say
whether this route opens that form directly or first shows a read-only
detail with an extra Editar action. The edit and delete tests need a
concrete interaction path.
**I would assume:** `health/[id]` opens the existing event in the editable
health form, with Salvar and Excluir. Saving calls `patchHealthEvent`;
Excluir calls `deleteHealthEvent`; both close after the local mutation.
There is no additional edit action. Confine this route choice to
`apps/mobile/src/features/health/HealthDetailScreen.tsx`.
**Blocking:** no. The Red tests follow this assumption; the detail screen
is a typed throwing stub in this turn.
**Answer (2026-10-19, the orchestrator):** yes. `health/[id]` is the health
form filled with the event, with **Salvar** `health-save` and **Excluir**
`health-delete`; there is no read-only detail. **Salvar** calls
`patchHealthEvent` and closes. **Excluir** first opens a sheet, as the
pet's archive does, because it takes a medical record out of the
history: "Excluir este registro de saúde?" with one action, **Excluir**
`health-delete-confirm`, which calls `deleteHealthEvent` and closes;
dismissing the sheet keeps the record. Now in `09` §4.3.

## Q-44 — P4-7 — How should the embedded health timeline scroll before P5-3?
**Asked:** 2026-10-19
**Where:** spec/06-ux-motion-spec.md §1.3; spec/08-tasks.md P4-7 and P5-3;
spec/09-screens.md §4.3; apps/mobile/package.json.
**Problem:** The profile owns a ScrollView with its five sections. The
motion spec requires FlashList for health history, but the dependency is
not installed and its installation belongs to P5-3. This session forbids
installations. The embedded section needs to show its grouped events now.
**I would assume:** Render the month groups as Views within the existing
profile scroll container in `HealthTimelineSection.tsx` for this stage.
Do not add a nested scrolling list or install a dependency. The
orchestrator can settle the final list arrangement before accepting P4-7.
**Blocking:** no for stage 1; the grouping and timeline tests can proceed.
**Answer (2026-10-19, the orchestrator):** as assumed, and for good, not
only until P5-3. The profile is one scroll container, and a `FlashList`
nested in a `ScrollView` loses its virtualization anyway. The health
section renders its month groups inline, as memoized rows with stable
keys, like the profile's other sections. One pet's health history stays
in the tens of events. `FlashList` remains the rule for history screens
that own their scroll: task history (P5-4) and the walks tab (P6). Now in
`06` §1.3 rule 4.

## Q-45 — P4-8 — How long should a failed-measure crossfade last?
**Asked:** 2026-10-19
**Where:** spec/06-ux-motion-spec.md §4.6 and §5; spec/08-tasks.md P4-8.
**Problem:** Reduce Motion specifies a 150 ms hero crossfade. Failed
measurement and an off-screen source also require a crossfade, but its
duration is not stated. The null-measure test needs an expected duration.
**I would assume:** All hero fallback crossfades use `duration.reducedFade`
(150 ms), with no spring. Confine this duration choice to the fallback
branch in `apps/mobile/src/ui/motion/hero/` when it is implemented.
**Blocking:** no. The Red tests use this duration assumption.
**Answer (2026-10-19, the orchestrator):** as assumed. Every hero
fallback is the same crossfade as Reduce Motion: `duration.reducedFade`
(150 ms), timing, no spring. That covers a failed measure, a source no
longer on screen, and Reduce Motion itself. One duration for one look.
Now in `06` §4.6.

## Q-46 — P4-9 — Where should the user's name and colour controls live?
**Asked:** 2026-10-19
**Where:** spec/09-screens.md §7; spec/11-reserve-server.md §5;
spec/04-api-contract.md §3.
**Problem:** Settings disables editing one's own name and colour on the
reserve, but its screen descriptions do not place these controls. The
six reserve-restricted routes include redeem, which belongs to the auth
screen, and PATCH /me, whose documented body only lists display_name.
The Red tests need a location for both profile controls without adding
a redeem control to Settings or inventing a colour write contract.
**I would assume:** Put the user's name and colour controls on Family.
Test that these and the invite, role, remove and password controls are
disabled on the reserve, and separately test availability for all six
account actions, including redeem. Do not add a redeem row to Settings.
The colour write contract must be settled before implementing that write;
this Red step only defines the typed screen boundary and disabled state.
**Blocking:** no for Red. The placement assumption is confined to
apps/mobile/src/features/family/FamilyScreen.tsx.
**Answer (2026-10-19, the orchestrator):** the name goes on Família, and
the colour is not editable. The person's own row in the members list
carries **Editar nome** `member-name-edit`, which writes `PATCH /me
{display_name}` (any member, online only, disabled on the reserve). A
colour is assigned once by the server at creation (`03`), and `04` has
no way to change it, so `09` §7's "name and colour" was wrong: it now
says "one's own name". On the reserve the app disables five controls:
role, **Remover**, **Convidar**, **Trocar senha** and **Editar nome**.
`POST /auth/redeem`, the sixth route of `11` §5, has no control in
Ajustes; the redeem screen meets the reserve's `409` like any other
refusal. Now in `09` §7.

## Q-47 — P4-9 — Can the family row assertion allow descendant text?
**Asked:** 2026-10-19
**Where:** apps/mobile/src/features/family/__tests__/family.test.tsx,
first test; spec/09-screens.md §7; Q-46.
**Problem:** the existing test calls
`expect(memberRow).toHaveTextContent(member.display_name)`, and then
requires an `Editar nome` button inside that same member row, with its
own visible text. React Native Testing Library 14's `toHaveTextContent`
defaults to exact equality and recursively concatenates all descendant
text. A row containing its required name, role badge and button cannot
also have text exactly equal to only the name. The observed failure is
expected `Hudson`, received `HudsonMembroEditar nome`.
**I would assume:** use `{ exact: false }` for the row-text assertion, or
assert the name's Text node within the row. Keep the own-row button
placement and all other assertions unchanged. No implementation-only
layout change can satisfy both exact text assertions.
**Blocking:** yes for the unchanged family test. The owner instructed
that existing assertions must not be edited or weakened. Independent
stage-3 implementation and checks can proceed; no commit is made in this
session, as explicitly requested.
**Answer (2026-10-19, orchestrator):** the assertion is a defect of the
red commit `d1426d7`, not of the spec. Replace it with
`expect(within(memberRow).getByText(member.display_name)).toBeOnTheScreen()`:
the name must be its own text node inside the row, which is as strict as
the spec asks and lets the role badge and **Editar nome** share the row.
No other assertion changes. Nothing in the spec changes.

## Q-48 — P5-1 — What should the fork note say for a future task?
**Asked:** 2026-10-19
**Where:** spec/02-spec.md R3.8; spec/09-screens.md §5.1;
packages/shared/src/taskEdit.ts forkEffectiveDate.
**Problem:** The effective date is clamped to the old template's starts_on.
For a task starting later than tomorrow, neither of the two specified
today/tomorrow notes describes the effective date correctly.
**I would assume:** Keep the specified notes for today and tomorrow. For a
later effective date, say "As mudanças de agenda valem a partir de
<dd/MM/yyyy>." Confine this copy choice to formatTaskEffectiveDate in
apps/mobile/src/i18n/format.ts and keep using forkEffectiveDate unchanged.
**Blocking:** no. The form can proceed with the explicit-date fallback.
**Answer (2026-10-19, orchestrator):** as assumed. When `E` is later
than tomorrow, the note reads "As mudanças de agenda valem a partir de
dd/MM/aaaa." with the date in the family timezone. Now in `09` §5.1.

## Q-49 — P5-2 — Should the empty scene twinkle beside the header sky?
**Asked:** 2026-10-19
**Where:** spec/06-ux-motion-spec.md §1.3, §4.1, §4.10;
spec/09-screens.md §3.1, §3.2.
**Problem:** The dashboard always has a header Starfield. The existing
ClearSky illustration owns another Starfield canvas. Animating both would
conflict with the limit of one animated canvas, while the illustration
description asks for gentle twinkling in each scene.
**I would assume:** Keep the header animated, with parallax, and render
the existing ClearSky with active=false. Both keep their theme tokens;
only the header twinkles. Confine this choice to the empty-row branch in
apps/mobile/src/features/dashboard/DashboardScreen.tsx.
**Blocking:** no. The scene is visible and the screen has only one
animated canvas. The orchestrator can settle the scene's motion on review.
**Answer (2026-10-19, orchestrator):** as assumed. Principle 5 of `06`
§1.3 (one animated canvas per screen) wins over the illustration's
twinkle: on a screen that already has an animated sky, the empty scene is
drawn still. On the dashboard, the header twinkles and Céu limpo is
still. Now in `06` §4.10.

## Q-50 — P5-3 — May the undo red test use partial text matching?
**Asked:** 2026-10-19
**Where:** spec/09-screens.md §3.3; spec/02-spec.md R3.22;
apps/mobile/src/features/dashboard/__tests__/TaskCard.test.tsx:293–294;
apps/mobile/node_modules/@testing-library/react-native/dist/matches.js:8.
**Problem:** The committed undo test calls
`expect(screen.getByRole('dialog')).toHaveTextContent(c.other.display_name)`
and then `expect(screen.getByRole('dialog')).toHaveTextContent('07:12')`.
In installed React Native Testing Library 14.0.1, toHaveTextContent defaults
to exact matching. These assertions require the same dialog's entire text
to equal both the member name and the time, and neither permits the full
confirmation copy and actions required by §3.3. The green run renders the
specified confirmation, including Duda and 07:12, but fails the first
assertion. The owner explicitly forbids changing any red assertion and
requires stopping when a red case conflicts with the spec.

The same run also exposes an independent fixture issue in the network
failure case: dashboardContext calls taskContext, which calls syncContext
without random values. The real outbox retry consumes one jitter value,
so that case fails with `Fake random has no queued value` before it can
check the star. The other eight TaskCard cases and all 32 existing
dashboard tests pass (40 passed, 2 failed, 42 total).
**I would assume:** With explicit authorization, add `{ exact: false }`
to both undo text assertions, preserving their checks for who and when
and the full specified copy. Supply deterministic retry randomness in
the dashboard test context by forwarding a fixed value through the task
context to syncContext; keep the production backoff and the fake random
source's strict exhaustion behavior unchanged. No red assertion or
random fixture has been changed in this green session.
**Blocking:** yes. Stop here with the partial implementation uncommitted;
the owner or orchestrator must authorize the red-test correction before
the requested all-green checks can be completed.
**Answer (2026-10-19, orchestrator):** both are test defects, not spec
gaps, and both may be fixed in the green commit. For the undo case,
assert more, not less: inside the dialog, `getByText` the whole
confirmation, `Desfazer? Feito por <name> às 07:12.`, built from the
`undoBody` string with the other member's name, instead of the two
exact `toHaveTextContent` calls. For the network-failure case, give the
dashboard test context a fixed retry random value through `taskContext`
to `syncContext`; production backoff and the fake source's strict
exhaustion stay as they are. The spec is unchanged.
