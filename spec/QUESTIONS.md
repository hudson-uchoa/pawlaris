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
