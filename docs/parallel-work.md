# Running several sessions on this repository

The unit of isolation is the **working directory**, not the branch. Git's HEAD and
index belong to a directory, so two sessions in one checkout silently move each
other's files between branches, and `git add -A` commits the other session's work.

**One worktree per session. One branch per session. One port block per session.**

## Sessions do not talk to each other

There is no channel between two DSH sessions, and there is nothing to switch on. A
session is an agent with a working directory; it has no address another session can
send to, and `send_message` reaches only the agents a session started itself.

What *can* pass between sessions is anything that outlives them, and in this
repository that is git. A session reads another session's decisions out of a commit,
a diff, or a PR description — never out of a message.

The consequence worth internalising: **a change adopted by `main` is not adopted by a
session.** Another session keeps running the code it checked out, with the habits it
already has, until something makes it look again. Merging settles the repository, not
the conversations happening in it.

### Merge and then tell

So the sequence is: change `main`, then *ask* the other session to rebase. Nothing
about the merge reaches it on its own.

This is not hypothetical. While this document was being written, the ports work was
uncommitted in the root checkout and the checkout was moved onto another branch by a
session working in it — `docs/parallel-work.md` and `docs/session-notes.md` were
deleted, and the only reason the rest survived is that the switch left unrelated
edits in place. Uncommitted work has no protection at all. Commit it, or accept that
it is draft material.

## Beginning a session

Worktrees must live *inside* the session workspace: the file sandbox is scoped to the
workspace root, so a worktree outside it needs an approval escalation for every write.

```powershell
cd <repo>
git worktree add .worktrees/<slug> -b <type>/<slug> main
cd .worktrees/<slug> ; npm ci
```

- `.worktrees/` is in `.gitignore`; keep searches scoped to your own session's files,
  because the parent checkout sees the sibling worktrees inside its tree.
- Start the session with that worktree as its workspace.
- **A worktree does not share `node_modules`.** Each one needs its own `npm ci`; the
  two that exist today have neither, so a check run there fails before it starts.
- A worktree is better than a second clone: one object store, refs shared immediately,
  and git refuses to check the same branch out twice, so that collision is impossible.

What to tell each session:

> Your working directory is this worktree; `<branch>` is already checked out.
> Stay on it — never `git checkout`/`switch` another branch, never work in the main
> checkout. Commit only files you changed; never `git add -A`.
> Never run a shared teardown/stop script — it kills other sessions' servers.
> Use only your ports. Branch → PR → merge; small PRs, rebase on `main` before merging.

## Ports

Every session needs its own block, because the app, the two stand-ins and each browser
all bind a port, and **two sessions cannot share one**. `tools/dev-servers.ps1` starts
the whole block and `-BasePort` moves it:

| Session | `-BasePort` | app (`BASE`) | store / deck API | browsers (`CDP_PORTS`) |
|---|---|---|---|---|
| A (the root checkout) | 9222 | 3005 | 6390 / 6391 | 9222, 9223, 9224 |
| B | 9230 | 3006 | 6392 / 6393 | 9230, 9231, 9232 |
| C | 9238 | 3007 | 6394 / 6395 | 9238, 9239, 9240 |
| D | 9246 | 3008 | 6396 / 6397 | 9246, 9247, 9248 |

```powershell
# session B, from its own worktree, in a plain terminal (not inside the sandbox)
powershell -File tools\dev-servers.ps1 -BasePort 9230
```

One argument is enough: the app port and the store ports are derived from `-BasePort`.
`-BasePort` must be **9222 + 8n**, and `-Port` may be given only as the app port that
block implies. Anything else is refused with the arithmetic spelled out, because the
alternative is two sessions sharing a port and neither noticing.

Then point the checks at that block — every check already reads these from the
environment and defaults to session A's:

```powershell
$env:BASE = 'http://localhost:3006'
$env:CDP_PORTS = '9230,9231,9232'
$env:FAKE = 'http://127.0.0.1:6392'
node tools/dev-servers-check.mjs
node tools/solo-check.mjs
```

Closing a run takes the same argument, and closes only that block:

```powershell
powershell -File tools\dev-servers.ps1 -Stop -BasePort 9230
```

`-Stop` identifies processes by their own command lines: the vite process by the
repository name plus *its* app port, each browser by the `--user-data-dir` it was given,
and each stand-in by its script name plus *its* port. The browser profiles it deletes
are only the ones on that block's ports. A `-Stop` without `-BasePort` names session A,
and will close session A.

### What is not per-session

`tools/dev-servers.ps1` is safe to use per session *provided* it is given that session's
`-BasePort`. Two things around it are not:

- **`npm run dev` on its own** binds the port in `package.json` (3005), not yours. Use
  the script, or `npm run dev -- --port 3006`.
- **Dev servers and real browsers do not start inside the confined sandbox.** Vite
  starts an esbuild service over piped stdio and a sandbox that refuses new pipes kills
  it with `spawn EPERM`; Chrome exits before reading its command line. Bring the stack
  up from a plain terminal, outside the session, then run checks from inside.

## Shared files

`main` is the shared resource, and CI fires per PR and per push to it.

- Keep PRs small and merge early, then rebase — a session reading stale `main` is
  reading another session's past.
- Give sessions disjoint *areas*. Ownership ambiguity, not tooling, is what produces
  most `README.md` conflicts.
- `docs/gotchas.md` is the usual hotspot. Append; do not rewrite an entry somebody else
  is still writing.
- `docs/session-notes.md` is the one file two sessions are *expected* to write at the
  same time. It is append-only, and `.gitattributes` gives it `merge=union`, so two
  appends merge without a conflict and without dropping either line.
- That attribute is deliberately not set for `README.md` or `docs/gotchas.md`. Union on
  prose interleaves two rewrites of the same paragraph instead of reporting a conflict,
  and a real conflict there is information.

## Merging done, worktree done

After merging: `git worktree remove .worktrees/<slug>` then `git worktree prune`.

If worktrees are too heavy for a repository, serialize the sessions instead — a
read-only or research-only second session never conflicts.
