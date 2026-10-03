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
