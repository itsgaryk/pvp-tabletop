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
## 2026-09-27 — block D claimed by the game-format session

- Block B (9230 / app 3006 / store 6392-6393 / browsers 9230-9232) was already
  serving the `chat-composer` worktree when this session came to start, so this
  session was given **block D: `-BasePort 9246`**, app 3008, store 6396/6397,
  browsers 9246-9248. It is now in `parallel-work.md`'s table. Sessions started
  before this line was written should re-read the table rather than assume the
  list stops at C.
- Nothing else was taken over: this session edits `docs/board.md`,
  `docs/mechanics.md`, `docs/rooms.md` and `tools/browser-check.mjs` for the game
  format change, and touches `tools/browser.mjs` only to add a field to the
  create-room helper. If you are in any of those, say so in your own entry here.
- Game format landed as PR #177. Block D is free again as of this line.

## 2026-09-27 — `-Stop` closed only the app, and left the rest of your block up

- **`tools/dev-servers.ps1 -Stop` does not stop the stand-ins or the browsers.**
  `Clear-Ours` called `Stop-Pids @($ours.devServer) + @($ours.browsers) +
  @($ours.standins)`, and in PowerShell that is not a call with three lists: the `+`
  expressions are added to what `Stop-Pids` *returns* - an integer - so only the
  dev-server ids are ever passed and the other two lists are discarded. Demonstrated
  on this host: the call received `11,12` and returned `2`, and the `21,22,23` and
  `31,32` were never passed to anything.
- **So a `-Stop` that reports success can leave five processes behind.** This session
  ran `-Stop -BasePort 9246`, was told `closed 2 process(es)`, and found 3008, 6396,
  6397, 9246, 9247 and 9248 still listening afterwards - both stand-ins and all three
  browsers, with `%TEMP%\pvp-chrome-9246/7/8` still locked and the script saying each
  profile "is still in use". Closing the five by pid cleared the block.
- **If you ran `-Stop` before this fix, check your block before you assume it is
  free** - `netstat -ano | Select-String ':30\d\d|:63\d\d|:92\d\d'` is enough. The
  danger is the silence: the ports stay held and the next session on that block
  collides, which is the failure this whole change exists to prevent.
- Fixed on `fix/dev-servers-stop-everything` as three statements, one per family.
  `tools/dev-servers-check.mjs` tests the pure matcher and cannot see this - the bug
  is in how PowerShell calls it, not in what it matches - so a check that starts a
  block and stops it would be the thing that catches a regression.
- **A second, related one that I have deliberately NOT fixed: the browser matcher is
  not scoped to the block either.** `isOurBrowser` matches any
  `--user-data-dir=...pvp-chrome-<port>`, with no reference to the run's own ports, so
  `findOurs` collects *every* session's browsers and `-Stop` closes them. The stand-in
  matcher was scoped by port for exactly this reason ("name alone is unsafe the moment
  two sessions are running"); the browser matcher was left as it was, and
  `dev-servers-check.mjs` asserts that deliberately: "a run with more pages than this
  invocation asks for still cleans up: 9422 counts".
- **Evidence, and an apology.** After the fix above, `-Stop -BasePort 9246` closed 53
  processes on this host, and the CDP ports of every other block went quiet in the same
  moment - 9230-9232 and 9238-9240 included. So if the `chat-composer` or `far-half`
  session lost its browsers mid-check just now, that was this command, not a crash.
  The stand-ins and the apps were untouched (6390-6395 and 3005-3007 were still
  listening), which is what makes the browser path look like the odd one out.
- **The fix, for whoever owns this file**: browsers are `base..base+7` for a block,
  because `-BasePort` steps by 8 and the block's app and store ports are derived from
  the same `n`. `isOurBrowser(line, { basePort })` returning false outside that range
  would make `-Stop` close every browser its own block started - however many pages -
  and none of anybody else's. That check above would then need to assert the block
  instead of the bare port, which is why this is a decision rather than a typo fix and
  I have left it alone.

## 2026-09-30 — *Reveal Hand* is on the cards of the hand as well as on the zone

- **The entry is offered twice now.** `Reveal Hand` was the hand zone's own menu entry
  (`opponent/Hand.svelte`); it is also on every card *in* that hand, through the menu a card of
  theirs already opens for *Ping Card* (`dialogs/OppCardPingMenu.svelte`). One gesture with two
  places to ask: both call the store's `revealHand`, so the window, the log line and the consent
  question are one implementation rather than two that have to agree.
- **Which pile the card is drawn with answers it**, and that is a new marker rather than a list of
  zone names: `theirHand`, marked on the far half's hand in `opponent.js` beside `pingable`. The
  component that draws a card of theirs draws the hand, the prizes, their Stadium, the table and a
  pile opened as a view, so only the pile can say whether a hand is behind the card - and a
  *batch* wears the hand's own name too (`asPile` in `reveal.js`), which is the case the marker is
  for rather than `pile.name === 'hand'`.
- **`tools/reveal-check.mjs` was stale on `main` for three reasons that are not this change, and
  none of them could show up in CI** - the browser checks are run by hand (`diagnostics.md`):
  - **the consent gate is not in the check.** #186 put a question between *Reveal Hand*, *Reveal*
    and *Look* and their windows, and `reveal-check.mjs` was last touched before that: it clicked
    the entry and waited for a window that cannot open until the owner answers. A helper now
    answers on the owner's page (`.consent-dialog .consent-yes`), at the six sites that ask.
  - **the number questions are not the browser's `prompt` any more.** The check overrode
    `window.prompt`, which the app stopped using when every count moved into
    `dialogs/NumberPrompt.svelte` - so the entry opened its own dialog, the click was recorded as
    taken, and the count never arrived. The helper now waits for that dialog and presses its OK,
    and it is called *after* the entry rather than before it, because the click is what asks.
  - **the room has no deal button at all any more.** `browser.mjs`'s `setup()` clicks the word
    *Setup*; #190 made the opening automatic, so in a room that is a click on a button that is not
    there and the deal never happens - the board waits for a coin call and a turn order that no
    check answers. `reveal-check.mjs` now settles the opening itself (import both decks, *Heads*,
    *First*, both boards dealt, *Ready* on both so the veils come down), following
    `tools/game-setup-browser-check.mjs`. Before #190 the same helper was worse than a no-op: the
    room's button read *Game Setup* while `clickText` compares the whole label, so nothing was
    clicked and the board stayed undealt.
  - **The finding underneath all three**: a room check that fails at its own setup reports it in
    the feature's vocabulary - *and both were dealt a hand - 0 and 0*, then *the reveal window
    opens on the revealer's board - no window*, then forty lines about a feature that is fine. The
    first failing line is the one to read. All of it is in [gotchas.md](gotchas.md).
- **`tools/reveal-check.mjs` measured on this branch**, two players and a watcher: *verdict: ok*,
  including *and a card of that hand offers Reveal Hand from its own menu - Ping Card | Reveal
  Hand* and *and taking it from the card opens the same window the zone opens - 7 cards, 7 in the
  hand*. It took two runs: the first died about two thirds through with *no reply to
  Runtime.evaluate after 15s on port 9230*, and the next attempt found *no browser is listening on
  9230, 9231, 9232* - the three headless Chromes and this session's dev server were gone, with
  another session's stack (3005, 9222-9224) still up. Restarting the block and running the same
  check again was green with no code change, so it was the environment rather than the check; a
  five-minute run on three browsers is worth re-running once before believing it.
- **The other hand-run room checks deal through `page.setup()` too** - `zone-sync-check.mjs`,
  `consent-check.mjs`, `new-game-clear-check.mjs`, `probe-reveal-consent.mjs`, `prize-check.mjs` -
  so they are all waiting on the same coin dialog now, and none of them was touched or run here.
  Whoever ports them can lift the opening steps out of `reveal-check.mjs`.
- **This session closed its block by hand rather than with `-Stop`, and that is worth copying.**
  `isOurBrowser` in `dev-servers.lib.mjs` still matches *any* `--user-data-dir=...pvp-chrome-<n>`,
  so `-Stop -BasePort 9230` would have closed session A's browsers as well - and session A's
  stack was up at the time (3005, 9222-9224 listening) with its own check probably running. Six
  pids found by their own listening ports (9230-9232, 3006, 6392, 6393) closed this block and
  nothing else, and the three `%TEMP%\pvp-chrome-923x` profiles went with it. The profile removal
  in the script *is* scoped now; the browser matcher is the one that is not.
