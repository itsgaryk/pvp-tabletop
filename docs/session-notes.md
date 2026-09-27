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

## 2026-09-27 — fix/far-half-follows-a-move (PR #174)

- **Block B's app port 3006 is occupied by somebody else's dev server.** Starting my
  block with `-BasePort 9230` reported `up: the app on 3006` and then served *their*
  app: the script's own log for my worktree says `Port 3006 is in use, trying another
  one... Local: http://localhost:3007/`. The health probe passes against whatever
  answers on the expected port, so a clash is silent — my first check run "passed" its
  startup and then failed 23 assertions against a board that was not mine. **If you
  started a dev server on 3006 by hand to write the ports work, it is still up and it
  is holding this block's app port.** Until that is sorted I ran my checks against
  3007 (block C's app port, which was free) with my own store/browsers on 6392/6393 and
  9230-9232; I have not left anything running on 3006.
- **A stolen app port also breaks `-Stop` for the block that lost it.** The script starts
  vite as `npm run dev -- --port 3006`, and the matcher identifies the dev server by the
  repository name plus *that* port in its command line. When 3006 is busy Vite binds 3007,
  but the command line still says 3006 — so `-Stop -BasePort 9230` matches my vite (which
  is on 3007) *and* whatever else claims 3006, and it cannot tell the two apart. I have
  deliberately not run it. `-DryRun` only previews a *start*, so there is no way to ask
  "what would a stop close?" — worth having one before the next session loses its port.
- **My worktree and branch**: `.worktrees/far-half` holds `fix/far-half-follows-a-move`
  (PR #174). I created it because this session's workspace is the **root checkout**,
  which is session A's — see below. Do not take that worktree or branch.
- **The root checkout holds uncommitted work that is not mine** (7 files, still there):
  `docs/diagnostics.md`, `docs/mechanics.md`, `docs/rooms.md`,
  `src/lib/stores/connection.js`, `src/routes/Chat.svelte`,
  `src/routes/Connection.svelte`, `tools/browser-check.mjs`. It looks like the
  chat/idle-line tidy-up. It has already been through two branch switches in that
  directory (mine, before `parallel-work.md` existed) — **commit it or expect to lose
  it.** I have not touched it, and I did not rebase in that checkout for that reason.
- **The root checkout was stuck on a stale cherry-pick** left from 26 Sept
  (`sequencer/head` `f605481d`, todo `eca2d30`, `1f09207`, all already in `main`), which
  made `git switch`/`checkout` fail there for everyone with *"cannot switch branch while
  cherry-picking"*. I cleared it with `git cherry-pick --quit` (keeps the index and the
  working tree). The root's HEAD is now on `archive/far-half-pre-rebase` — my old
  commit, superseded; safe to delete once PR #174 is merged.
- **`tools/reveal-check.mjs` fails on clean `main`**: 49 assertions, in an isolated
  worktree detached at `f56b1fa` with its own dev server and a static tree — "a reveal
  of the opponent's deck opens on the revealer - no window", "undefined cards". So it is
  not a regression from the branch I am on; it predates it (suspect PR #173's
  `opponent/Card.svelte` `onCtx` rework, or the harness). Worth somebody owning.
- **`npm run build` in the checkout a dev server is serving rewrites
  `.svelte-kit/generated/*` and page-reloads every open page** (`[vite] page reload
  .svelte-kit/generated/client/matchers.js`). Any browser check running at that moment
  dies with "undefined" DOM reads — that is how I lost two `reveal-check` runs. Build in
  a worktree that is not serving a check.
- **Chrome does start inside a session when the sandbox is escalated to full access**:
  `powershell -File tools\dev-servers.ps1 -BasePort 9230` brought up the stand-ins, the
  app and all three browsers from inside my session. `parallel-work.md` says the stack
  cannot start here; with an approval it can, which is worth knowing before asking
  somebody to run it by hand.
## 2026-09-27 — feat/chat-composer (session B, block 9230)

- **`tools/browser-check.mjs` is contested and I have backed off it.** The `panel`
  section was edited by this session to read the chat composer on the Game tab, on the
  Chat tab and in a spectator's page — but `origin/fix/panel-check-answers-idle`
  (commit 7548902, unmerged) is writing the same section for the same problem, so this
  session's test edits are on `feat/chat-composer` and that branch should land first.
  Whoever merges second resolves the section, do not paper over it.
- **The root checkout is not a safe place to leave work.** It was switched to
  `archive/far-half-pre-rebase` by another session while this session's edits were
  uncommitted in it. The edits survived only because that switch left unrelated modified
  files in place. Everything for this task now lives in `.worktrees/chat-composer` on
  `feat/chat-composer`; the copies that were left in the root checkout have been restored
  there so they cannot be committed under somebody else's branch.
- This session took block **9230** (app 3006, store 6392/6393, browsers 9230-9232) and
  ran `powershell -File tools\dev-servers.ps1 -BasePort 9230` from its own worktree.
  Nothing on block 9222 or 9238 was touched; `docs/parallel-work.md` is right that a
  bare `npm run dev` would have taken 3005, which is why the script was used.
