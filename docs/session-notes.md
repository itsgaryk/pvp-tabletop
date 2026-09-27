# Session notes

**Append only.** Add a new entry at the end. Never edit or reorder somebody else's —
the whole point of this file is that two sessions can add to it at the same time
without a conflict, which only works while entries are never rewritten.
`.gitattributes` gives this file `merge=union` for that reason (see
[parallel-work.md](parallel-work.md)).

This is not a log of work done — the commits are that. Write something here when it is
**for another session**: a port someone else now has to avoid, a decision that changes
what they should do next, a shared file you have taken over, or a dead end worth not
repeating. If it is for yourself, it belongs in a comment next to the code.

One entry per session per day, newest at the bottom. Date first, then what changed for
anyone else.

## Format

```
## YYYY-MM-DD — <branch or area>

- What another session now has to do differently, and why.
- A port claimed, a file taken over, a convention this session settled.
```

## Entries

## 2026-01-01 — ports made per-session (example entry, safe to delete)

- `tools/dev-servers.ps1` now takes `-BasePort`, and a session's app and store ports
  follow from it: `-BasePort 9230` means app 3006, store 6392/6393, browsers
  9230-9232. `-Stop -BasePort 9230` closes that block and nothing else. A `-Stop`
  without `-BasePort` still means session A, so do not run it bare.
- A stand-in started by hand is now matched by its `--port` argument. One started
  without it cannot be stopped on its own — pass `--port`.
- This file and why sessions cannot message each other: see
  [parallel-work.md](parallel-work.md).
