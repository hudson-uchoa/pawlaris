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
