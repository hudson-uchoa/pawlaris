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
