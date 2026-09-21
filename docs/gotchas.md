# Things that cost somebody an afternoon

**A rule that means to win on source order has to *tie* on specificity first, and `:where()`
is where the tie hides.** The change that consolidated nine copies of "a card on the board is
the size of the zone it is in" into one rule in `global.css` wrote that rule as
`:where(.zone-card).card`, and said so in its own comment: *`:where()` is the class at no
specificity, so this ties with `img.card` above on source order*. It does not tie.
`:where()` contributes nothing, so the selector was a class alone — `(0,1,0)` — against
`img.card`'s `(0,1,1)`, and `img.card` won every time. Every pile front on the board — the
deck, the discard and the lost zone, both halves — therefore went on taking the board's
fixed `--card-width` (105px) instead of its zone's size, while every other card on the board
scaled. The fix is four characters: `img:where(.zone-card).card`, a type and a class,
`(0,1,1)` exactly like `img.card`, so the tie is real and the later rule takes it. See
[card-sizing.md](card-sizing.md) for the rule, and `tools/card-sizing-check.mjs`, which now
*measures* both selectors instead of recognising the shape of one.

**Why nothing caught it, and why it looked like two different bugs.** The check that existed
asserted the class was worn and the formula was stated once — both true. The build, the docs
check, the render check and the zone-vocabulary check were all green, because none of them
looks at a cascade. And the symptom changes direction with the window:

| capture | that zone | a card the zone never sized (the fixed `--card-width`) |
| --- | --- | --- |
| 1375x826 | ~90 x 89 CSS px | *larger than the zone*: it hangs out over the rows above and below |
| 2583x1623 | ~190 x 190 CSS px | about half the zone's width: too small, and the zone it sits in looks empty |

So "the cards in the deck, discard and lost zone are wrong" reads as an overflow at one
window size and as nothing much at another, which is how one bug survived being reported
twice as two. Anything that is a *fixed* length on a board whose zones are all proportional
does this, and the giveaway is not on screen at either size — it is that the card is the
same size in both.

**Measuring that with no browser, from a screenshot.** A confined session has no renderer
(see the notes below on Chrome and on piped stdio), but a screenshot *is* a render, and its
pixels can be read. What worked here, in this repository, on this host:

1. **Get the pixels into node.** `System.Drawing` refuses WebP (`Out of memory` — it is not
   one; the codec is missing), but WIC decodes it: `PresentationCore`'s
   `BitmapDecoder::Create` plus a `FormatConvertedBitmap` to `Bgra32`, then `CopyPixels`
   into a `byte[]` and write it out raw. Node then reads it as `w * h * 4` bytes, BGRA.
2. **Do the analysis in node, not in the shell.** PowerShell 5.1 is per-pixel slow enough
   that a connected-components pass over a 2580x1625 image was killed at two minutes; the
   same pass in node finished in under a second.
3. **Find the grid before the cards.** Zone borders are on in these captures, so scanning
   for near-grey rows and columns finds them: the pair of lines that straddles a column gap
   is `--scaled-rem` apart (the gap, near enough — each outline is drawn 1px inside its own
   zone), one `1fr` is the row pitch, and the grid's own areas give every zone's rectangle
   from those two. A scanline through a zone's middle then gives the card's edges against
   the background — that is the measurement.
4. **Use a card whose size is known as the ruler, and mind the traps.** A cardback's dark
   field is a few units from the board's background (measured: `(25,35,70)` against
   `(31,38,49)`), so a brightness threshold can sit inside its edge and measure the Pokéball
   rather than the card: measure a face-up card (a discard's or a lost zone's top) instead.
   And **never read a CSS length out of one capture's pixel count** — the three pile fronts
   measured ~137x189 device px in a 1375x826 capture and ~139x189 in a 2583x1623 one, which
   is one length seen through two capture scales, not a card that grew. A card whose formula
   *is* known is what pins the scale — the hand's: the zone's height, less two paddings and
   the scrollbar — and it is also what proves the point, because in those same two captures
   the hand's cards went from ~56 to ~150 device px, matching the formula at both, while the
   three pile fronts did not move at all.

The rule the ratio between them gives you is worth stating plainly: **a card that does not
change size when the zone around it doubles is not being sized by its zone**, whatever the
CSS looks like.

**A deck's top is the *end* of its array, and a list placed there goes in backwards.**
Nothing in the code says either half of that anywhere. The first is implied by two things at
once — `draw` takes a card with `pop`, and a pile is read from that same end (`Inspection`
reverses the array so its first card on screen is the card that leaves first). The second
follows from the first and is the one that catches people: `ordered[0]` is the card the
player wants drawn *first*, and the card drawn first is at the **end** of the array, so a
top placement is `ordered` **reversed** at the end — the bottom placement is the one that
goes in as it is, at the front. The two ends are mirror images:

```js
next = bottom ? [ ...ordered, ...kept ]                // deepest card first
              : [ ...kept, ...ordered.slice().reverse() ]   // ordered[0] drawn first
```

This was got wrong twice here, and the interesting part is *how* it hid. A dialog that shows
the order the player chose reads perfectly with the cards landing upside down; a deck is
face down, so nothing on the board looks wrong either; and a check that reads the deck
**through that same dialog** passes, because the view and the placement agree with each
other and disagree only with the draw. What catches it is a check that **draws** the card
and asks whether it is the one the player put first. `tools/deck-order-check.mjs` does that
before it checks anything about counts, and `placeOrdered` in `custom/cards.js` carries the
note.

**`npm run check` does not run in this repository.** `svelte-check` is in neither
`dependencies` nor `devDependencies`, so the script fails with *"'svelte-check' is
not recognized"* and `npx svelte-check` will not help offline. What CI gates on is
`npm run build` (the same command Vercel runs) plus `tools/relay-check.mjs`, and
everything else is a browser check run by hand — so a component can be wrong in a
way only a browser shows, and the build will not say a word about it.

**A zone has three names, and the log's name for one of them is not a zone at all.**
**[terminology.md](terminology.md) is the table of all of them**, including the fourth
vocabulary this note missed — the *wire* name an event carries, which is the store
name, and which is what makes a rename that looks like tidying a field into a
protocol change. What follows is the account of how the homonym behaves; the table
is the reference.

A zone is keyed in three vocabularies and nothing declares the mapping between them:

| Vocabulary | Lives in | Names |
| --- | --- | --- |
| the store's field | `custom/board.js` | `deck`, `hand`, `prizes`, `discard`, `lz`, `bench`, `active`, `stadium`, `table`, `pickup` |
| the grid area | `Board.svelte`'s `grid-template-areas` | those, plus `hand2`/`deck2`/… and the shared cells, where `play2` and `stadium2` resolve to the *same* area as `play` and `stadium` |
| the log | `logger.js` | those, plus **`play`** — and `play` has no store behind it |

`logger.js`'s `isPublicMove` reads `zones.play`, which is `!pokemonHidden.val`: it is the
log's name for **the Pokémon in play**, i.e. the `bench` and the `active` spot, whose
contents are hidden together by the Hide Pokémon flag. The store fields are `bench` and
`active`; `play` exists nowhere else. It is not a bug — it has meant exactly that since
the map was written (Nov 2023, `5271984`) — but it is a homonym, because **`play` is also
the grid area of the table's cell**, whose store is `table`. And `logSlotMove` passes the
literal `'play'` (`logger.js:73`), while `logBenched` and `logPromoted` pass `'play'` as
their `to` (`:115`, `:123`).

So renaming the key is never a tidy-up. `zones.play` → `zones.bench`/`zones.active` fails
the lookup in `isPublicMove`, both sides fall through to `slotRegex`, and the log silently
starts naming cards it is supposed to count: *"Moved 2 cards from Deck to Bench"* becomes
*"Moved [Pikachu] from Deck to Bench"* — while Hide Pokémon is on, in front of the player
whose board it is. The same trap sits on the other two maps: `logger.js`'s `piles` and
`solo.js`'s `ZONE_LABEL` both carry a `play` label too, and `diagnostics.js`'s `PILE_ZONE`
carries `table` and `pickup`, neither of which is a board cell.

There are two names in this family that are *not* zones and one that is easy to confuse:

- `play` — the Pokémon in play (bench + active), in log vocabulary only.
- `table` — a real store and a real zone, but its grid area is called `play`.
- `pickup` — a real store with no cell, no label, no component and no outline: cards wait
  there while a multi-card selection is resolved, so it is a phase rather than a zone.

`logs` are not the only place the second vocabulary leaks: `boardZones` in
`diagnostics.js` counts the table under its store name `table`, while the browser check
that asserts the table carries no count badge (`browser-check.mjs:1418-1427`) looks for
the *class* `play`. Both are right, which is the point.

**A zone's contents are hidden at two levels, and they are not the same flag.**
The zone-level flags — `handRevealed`, `prizesFlipped`, `pokemonHidden` — are read by
`logger.js` to decide whether a move prints card names or a count, *and* fed to the
card-level `revealed` prop that actually draws `cardback` instead of the image:

```
opponent/Hand.svelte:18     revealed = handRevealed || spectating || solo
opponent/Prizes.svelte:71   revealed = prizesFlipped || spectating
opponent/Slot.svelte:184    src = pokemonHidden ? cardback : cardImage(top)
```

`revealed` also reaches the drag ghost (`DndCard.svelte:25-44`, "a prize that is face down
is carried face down") and the card menu, which prints *"Hidden card"* instead of a name
and still logs `Viewed prize card`. So when a log line counts cards rather than naming
them, the flag is the *zone's own* privacy and the count is correct — do not "fix" it into
a name. The one thing the two levels do not share is who they apply to: a spectator is
handed `revealed` for both halves outright (`spectating` in those expressions), which is
the deliberate difference from a player.

**Solo hides the Hide Pokémon button, and neither half's flag is reset by entering or
leaving solo.** `GameActions.svelte:226` renders that button only `{#if !$solo}` — solo has
no other player to hide from — while `opponent/Slot.svelte:184` reads the board's own
`pokemonHidden` in every mode, and `:93`, `:115`, `:122` refuse the click, the double click
and the context menu while it is set. Three things follow, and only the third is a problem:

- **The button is more load-bearing in solo than it looks.** `startSolo` resets both
  boards (`solo.js:32-39`), so the flag is false when a solo game begins, and nothing in
  solo sets it — the button is the only writer and it is not rendered. Which is the reason
  the flag cannot be reached *during* solo play.
- **The flag is cleared by a board reset, not by a mode change** (`custom/board.js:101`),
  and `startSolo`/`exitSolo` (`solo.js:32-47`) reset the clock, the flip and both boards.
  They do reach the flag through `reset()` — including the `defaultOpponent` copy — so the
  hole is conceptual rather than observed: a second writer of that flag would not be
  covered, and the next person to add one has no signal that solo depends on there being
  none.
- **A flipped solo board can hide a half nobody can show.** `soloSwapped` puts the far
  board's components in the near row (`Board.svelte:473-495, 598-662`), where the flag they
  obey is `defaultOpponent.pokemonHidden` — so with the board flipped and that half's flag
  set, the Pokémon in front of the player are card backs and the door out of it is at
  `GameActions.svelte:226`, which solo does not render. The same applies to the *near*
  half's flag if it is ever set without solo's own board being reset, which is what the
  paragraph above says nothing does today.

The fix is the line `player.js:761-768` already has for entering a room:
`pokemonHidden.set(false)` in both solo transitions, so the flag's lifetime is the mode's.
Cheap, and it is the kind of asymmetry — button in one mode, flag honoured in all of them,
component swapped between rows by a flip — that is invisible until somebody is looking at a
face-down board they cannot turn over.

**A browser check that imports a deck needs `tools/fake-deck-api.mjs`.** "Import
Deck" and "Import Random Deck" post to `VITE_LIMITLESS_WEB`
(`https://limitlesstcg.com`), which is somebody else's API: it can be slow,
rate-limited, or unreachable, which in a browser shows up as an *empty* board with
nothing in the console — the request is a cross-origin `fetch`, and a stand-in has
to answer the `OPTIONS` preflight and send `access-control-allow-origin` or the
status arrives as 200 and the body is refused. Both failure modes look identical
from the app's side, and both were met here while writing the deck-order check.

**That stand-in also cannot set a board up**, which is worth knowing before a check
that needs a dealt board is written: its 60 cards carry no `stage`, so
`hasBasic($cards)` is false, `deckValid` is false, and the Setup button is *disabled*
(the three `panel` checks above are that fault, and it is the stand-in's rather than
the app's). A browser check that needs cards on the board does not have to go through
Setup, though — dealing them is a board action like any other, and
`tools/prize-check.mjs` builds its six prizes out of the deck menu's *Prize Top Card*
entry, which never asks an API anything.

**Do not trust `Get-NetTCPConnection` inside the sandbox to tell you whether something is
running.** It reports nothing as listening — `NOT REPORTED` even for a port that is answering
HTTP — because enumerating the TCP table is denied. Two afternoons' worth of wrong conclusions
came out of that one line, including "the store cannot start here" when it had started and was
serving. What works is an actual connection attempt:

```powershell
$c = [System.Net.Sockets.TcpClient]::new()
$c.ConnectAsync('127.0.0.1', $port).Wait(400)   # true / false, and trustworthy
```

Checked against knowns: it reports `true` for this session's own web host on 3080 and for a
stand-in store on 6390, and `false` for ports with nothing on them. `tools/dev-servers.ps1`
uses exactly this, which is why its "already up" reporting can be believed where a `Get-NetTCPConnection`
check cannot.

**A sandbox that refuses piped stdio breaks `npm run build`, `npm run dev` and `git push`,
all in the same way.** In a confined agent session — the DSH file sandbox, a container, a
locked-down CI runner — `child_process` may be denied creating a *new* pipe for a child. The
refusal is `EPERM` on `spawn`, and it is not about the executable: it is about the stdio
requested. Measured on this project's Windows host, with `node -e` as the child:

| request | result |
| --- | --- |
| `stdio: 'inherit'` | runs (exit 0) |
| `stdio: 'ignore'` | runs (exit 0) |
| `stdio: [ 'ignore', 'inherit', 'inherit' ]` | runs |
| `stdio: 'pipe'` | `EPERM` |
| *no `stdio` key at all* | `EPERM` — the default is a pipe |

What that leaves working is worth stating positively, because the answer is *not* "nothing
can be started": a plain node server is fine. `tools/fake-redis.mjs` launched from a hidden
detached shell inside this very sandbox bound 6390 and answered `/__stats` with `200` — its
own log line, `fake redis (command counter) on http://127.0.0.1:6390`, is the proof. Node can
also `listen()` on a fresh port directly. So the *store* half of a browser check can be run in
the sandbox; what cannot is the dev server (next paragraph) and the browser (later). The one
caveat is lifetime: a process started that way did not outlive the harness turn that started
it, so treat it as usable within a turn rather than as a service to leave up.

Two of this project's tools depend on the pipe case and therefore fail with a message that
points at the wrong thing:

- **`npm run build` / `npm run dev`** — Vite 4 starts an esbuild *service*: a long-lived
  child with JSON-RPC over **piped** stdio (`node_modules/esbuild/lib/main.js`,
  `ensureServiceIsRunning`). The failure surfaces as `failed to load config from
  vite.config.js` / `Error: spawn EPERM`, which reads like a broken config. It is not: the
  same tree builds clean the moment the sandbox is widened. `svelte-check` is absent from
  this repo anyway (see above), so on a confined host **there is no way to compile or serve
  the app at all**, and a browser check cannot be run — the diagnosis matters, because
  "the build is broken" and "the build cannot start here" call for opposite responses.
- **`git push` over HTTPS** — `credential.helper` here is `!'C:\Program Files\GitHub CLI\gh.exe'
  auth git-credential`, and git runs a `!`-prefixed helper through a shell with piped
  stdio. That produces `couldn't create signal pipe, Win32 error 5` followed by `could not
  read Username for 'https://github.com'`, which reads like missing credentials. It is not:
  `gh auth status` is fine. The way through, when the token itself can still be read, is to
  skip the helper —

  ```powershell
  $t = (gh auth token).Trim()
  git -c credential.helper= push "https://x-access-token:$t@github.com/<owner>/<repo>.git" "<branch>"
  ```

  `gh auth token` writes the token to a pipe *we* own, which is allowed; only the helper's
  own shell is refused. Fetching and `gh` subcommands that do not shell out are unaffected.

Where the sandbox is configurable, the fix is the sandbox, not the tree. Where it is not,
the two working forms above are the whole of the workaround — and neither the build nor the
browser checks can be replaced by reading the code.

**Chrome is often the third casualty, and it fails with no diagnostic at all.** The browser
checks need real browsers started outside the tool
(`tools/browser-check.mjs` says so in its own header). On a confined host, launching Chrome
yourself can fail for a reason unrelated to any flag you pass: on this project's Windows
host, under the same sandbox, **every** invocation exited `4294930433` — `0xFFFF7001`,
`-36863` — including `chrome.exe --version`, which reads no profile, opens no port and needs
no window. A failure that survives `--version` is not a command-line problem.

What that looks like from the outside, and why it wastes an afternoon:

- **Chrome gets far enough to look healthy.** It creates its `--user-data-dir` and writes
  `component_crx_cache`, `GPUPersistentCache`, `Local State` and `Variations` into it, then
  dies — even for a run that never opens a debug port. An empty profile would say "it never
  started"; a populated one says "it started and then something else went wrong", which is
  the wrong lead. The *same* `--version` probe was also seen to exit `0xFFFF7001` on one
  launch form and `21` (`ERROR_NOT_READY`) on another, so even that single datum is not
  stable enough to reason from.
- **No CDP is the only symptom.** `127.0.0.1` and `[::1]` both refuse on the debugging port,
  `/json/version`, `/json/list` and `/json` all fail, and `DevToolsActivePort` is never
  written. So the check reports *"chrome did not answer on the debug port"*, which reads
  like a port clash or a firewall.
- **Every flag variant fails identically** — `--headless=new`, `--headless`, headful,
  `--no-sandbox`, `--disable-gpu`, `--dump-dom`, `--version`. Ruling these out one at a time
  is the afternoon.

The one thing that is *not* blocked is spawning Chrome: `stdio: 'ignore'` is permitted (see
the table above), so the process starts and the exit code above is the real answer. Two
consequences worth keeping straight:

- **Launch the browser outside the agent's sandbox, and only the browser.** The dev server
  can run outside it too, or inside with a wider sandbox — but the browser checks additionally
  need a session that can create a window or a headless renderer, which a confined agent
  session on Windows generally cannot.
- **An exit code is the diagnostic to look for.** When the browser will not come up, record
  `child.exitCode` and `child.on('error')` before blaming flags, ports or the page. On
  Windows a killed process settles as exit `1` *without* a signal marker; `0xFFFF7001` above
  is Chrome's own refusal, not a kill.

**No desktop engine renders inside the sandbox — and the three fail differently, with the
`--version` answer being the signal that misleads.** Chrome 153, Edge and Firefox 156 are all
installed on this machine. All three were driven with `stdio: 'ignore'`, which is permitted,
so every result below is the browser refusing rather than the sandbox refusing the spawn:

| engine | `--version` | render (any flag set tried) | what the code means |
| --- | --- | --- | --- |
| Chrome 153 | **exit 21** (`0x15`) | exit `0xFFFF7001` | `ERROR_NOT_READY` — dies before the command line |
| Edge | **exit 0** | exit `0x80000003` | `STATUS_BREAKPOINT` — reaches the browser, then asserts |
| Firefox 156 | **exit 0** | hangs until killed | no child process ever comes up |

The `--version` column is the trap. Edge and Firefox answer it *successfully*, so the
executable looks healthy and the natural next step is to try another flag; Chrome cannot even
answer it, which is the honest signal. Do not read Chrome's `0xFFFF7001` as a Chrome fault and
Edge's `exit 0` as Edge working — the assert Edge hits is the one `tools/browser.mjs` already
records from an earlier attempt ("a helper that spawned its own Edge instances made Edge
assert — *a breakpoint has been reached*"), which is why that file refuses to launch browsers.

Flag sets tried, all failing identically, so none is worth an afternoon: `--headless`,
`--headless=new`, headful, `--no-sandbox`, `--single-process`, `--in-process-gpu`,
`--disable-gpu`, `--disable-gpu-sandbox`, `--virtual-time-budget`, `--dump-dom`,
`--screenshot` (Chromium's form and Firefox's `-screenshot`), and `--version`.

None of this is about the tree: `npm run build` succeeds under a widened sandbox, and the
relay check needs no browser. What a confined session loses is precisely the *rendering* half
of verification —

- no screenshots and no CDP, therefore **no browser check**: `browser-check.mjs`,
  `solo-check.mjs`, `solo-select-check.mjs`, `mirror-check.mjs` and `deck-order-check.mjs` are
  all out of reach;
- no *rendered* verification of CSS, which is the half the build never covers (see the note
  about `npm run check` above) — `docs/card-sizing.md` is full of claims only a renderer can
  settle;
- **but the tree itself can still be rendered** — `tools/render-check.mjs`, which is a
  renderer without a browser (see the entry on it below). The list above is about what needs a
  *browser*; "does any of this render at all" does not;
- still available: the build, `tools/docs-check.mjs`, `tools/relay-check.mjs` given a dev
  server, and any change assertable by importing the module in plain node — the
  `placeOrdered` half of `tools/deck-order-check.mjs` is the model for that.

**A component can be dead on arrival while the build, the docs check and every other tool are
green — and `$name` on a plain value is how.** The change that prompted this note was one line:
two states were named in `Board.svelte`'s script,

```js
$: topUpright = $spectating || $solo
$: topFlipped = !topUpright
```

…and then written into nine template attributes as `class:upright={$topUpright}`. The `$` makes
Svelte read the expression as a **store**, and `topUpright` is a plain boolean, so the component
threw on mount:

```
TypeError: store.subscribe is not a function
    at subscribe (svelte/src/runtime/internal/utils.js:139:22)
    at $$subscribe_topUpright
```

`npm run build` passed — it compiles the template, and this is a *runtime* type error, not a
compile error. `docs-check` passed. The app was dead: the board never rendered, so clicking
**Play Solo** left the main menu on screen with no error anywhere a person would look. It is the
same shape as the spectator bugs (healthy transport, empty board) and it survived exactly as long
as it did because this repository had **no renderer at all** in a confined session.

Two things follow, and the second is the one that generalises:

- **`$` is for stores only.** A `$:` reactive assignment produces a plain value; referring to it
  with a `$` prefix elsewhere in the component is the bug above. It is a one-character mistake
  with no compile-time signal, so it is worth knowing what it looks like when it lands.
- **`tools/render-check.mjs` is the answer to "does the tree render".** It compiles the real
  components to their server `render()` and executes the menu, the board in solo and the
  sidebar. A `render()` call runs every `$:` statement and every template expression, so the
  throw above happens there in a second, and the check was verified by putting the bug back and
  watching it go red. It is **not** a browser check — it renders to a string and says nothing
  about CSS or layout — and it needs `esbuild`, so it hits the same `spawn EPERM` sandbox wall as
  `npm run build`.

**And do not try to find out by launching a browser by hand.** It does not merely fail: Edge
puts a modal *`msedge.exe - Application Error`* — "The exception Breakpoint / A breakpoint has
been reached / (0x80000003)" — on the desktop of whoever is sitting at the machine, which is a
window nobody asked for and only they can dismiss. The exit code already says the same thing
in one number, and `tools/browser.mjs` says why it refuses to launch browsers at all. Read the
code, measure with node, or ask the person at the keyboard to run
`tools/dev-servers.ps1` — do not spawn a browser to see what happens.

**`tools/dev-servers.ps1` is the way in, and its output is a sequence to read in order.**
Run outside the sandbox, it brings up the store, the deck-API stand-in, the app and one
browser per page, and the app is what takes the time: Vite reported `ready in 15393 ms` here,
after which the script is still in its health loop before it touches Chrome. So a run that
appears to stop after `starting the dev server on 3005` is not hung — and the authority on
whether the app came up is the app, not a port probe:

```powershell
(Invoke-WebRequest 'http://localhost:3005/api/relay/health' -UseBasicParsing).StatusCode   # 200
```

On this host `TcpClient` could **not** connect to `127.0.0.1:3005`, `::1:3005`, `0.0.0.0:3005`,
the LAN address or the hostname, while `http://localhost:3005/` served the app and
`/api/relay/health` answered `200` — so the readiness probe inside the script can print
`never answered on 3005` for an app that is running perfectly. The store and the deck stand-in
on 6390/6391 answer on IPv4 as expected. When the two disagree, believe the HTTP request. Two
further notes for whoever maintains it: the script writes its dev-server output to
`.dev-server.log`, which `.gitignore` does **not** cover (the `_*.log` rule needs the
underscore), and the launcher shell stays blocked for as long as the dev server runs, because
it waits on `npm run dev` rather than detaching it.

**The `panel` section fails three checks on a clean tree, and two of them are the harness.**
`node tools/browser-check.mjs --only panel` gives **70 PASS, 3 FAIL** on `main` with nothing
modified — worth knowing before treating a red run as your own doing. The three are not one
bug:

- **`Setup lights the Hide Pokemon button` and `and it stays lit rather than fading`** are
  `tools/fake-deck-api.mjs` **not making a legal deck**. Its 60 cards are
  `{ name, set, number, card_type }` and carry **no `stage`**, while the app's own guard is
  `$: deckValid = hasBasic($cards)`, which requires `card.stage === 'basic'`
  (`GameActions.svelte:32-39`). `setup()` therefore returns at its first line —
  `if (!deckValid && $autoMulligan) return` — and never reaches `hideGlow = true` five lines
  below it. The app is right and the stand-in is incomplete: a deck of 60 cards with no Basic
  Pokémon is not a deck, which is why the same check passes against the real
  `limitlesstcg.com`. One field on the stand-in's card objects is the whole fix, and it is
  also why `importDeck()` in the checks cannot set a board up.
- **`and a card in the middle of a zone covers its name rather than the other way round`** is
  the one left *open*, and the measurement is the useful part. The check requires the first
  element with class `card` in the hit-test stack to be at index 0 (`cardAt === 0`), and for
  the Deck zone the stack at the label's centre came back as
  `img.card`, `.pile-body`, `.pile`, `.deck`, `.zone-label` — `cardAt = 0` with the label at
  `4`. Every other zone measured `cardAt = -1`. So either the deck's cardback is genuinely
  drawn over the word *Deck* — which would be the markup bug the check is for, and would need
  the label moved or the card shrunk — or `cardAt === 0` is simply wrong as a definition of
  "covers", since the deck's card is the one card on the board that fills its whole zone and
  therefore lands on the zone's centre by construction. Settling it needs the label's text
  rect against the card's rect and which of the two wins the hit test at a point *inside the
  text*; `elementsFromPoint` at the text's centre is not enough on its own, and this note
  deliberately does not pick a side. Whichever way it goes, it is the Deck alone at 1277x821,
  and it is not a regression — nothing in this session touched the board.

**A `Popup`'s body scrolls; its actions do not.** `Popup.svelte` gives the panel
the window's height at most and hands what is left to `.popup-body`, which
overflows — so anything that has to stay visible while the cards are scrolled
belongs in the `buttons` slot. The actions are one per line by default, which on
a 636px-tall window is 20% of the deck per button — and the row `flex-wrap`s, so a
panel with a second *kind* of action lays them out in groups beside each other
instead: the pile inspection's four buttons sit two by two next to the two that
close it (`Inspection.svelte`). Anything inside the body is clipped horizontally
too (`overflow-y: auto` does not leave the other axis visible), so a badge hung
off the corner of a card is simply not drawn — which is why a selection that has
to be *read* is said in words above the grid rather than drawn on the card.

**The panel has three placements, and a new one has to take the old one's
`transform` and every length that hung off `m-8` with it.** A panel is centred
horizontally by `left: 50%` plus `translateX(-50%)`; `.centered` (the diagnostics
dialog) and `.anchored` (a menu under a corner button) each override one or both,
and both say `transform: none` where they stop translating, because a translate
left on moves a panel that is already where it belongs. The third, `.flush`, is
the pile inspection: it is a grid as wide as the window, so centring it only spends
the window's edges on a frame around it, and it is laid against the left edge
instead — `left: 0`, `transform: none`, no margins, and `--popup-edge` kept on the
right. **What that costs is the arithmetic of the base rule.** Its `max-height` is
`calc(100vh - 6rem)` because `m-8` is 2rem above and below on top of its `top: 2rem`;
a placement with no margins that inherited that number would leave the panel 4rem
short of the bottom of the window. A placement sets what it changes *completely*,
rather than leaving the reader to work out which half of a length still applies.

**A panel that is opened by a call renders as nothing at all, and `bind:this` is
not the way into one.** Every `Popup` draws nothing until a call opens it, and
`tools/render-check.mjs` renders components rather than clicking them — so a fault
in a panel's own markup, or in a `$:` statement only the panel runs, is the one
class of failure the file exists to catch and cannot reach. The obvious way in
does not work: **`bind:this` does not bind to a child's methods in a server
render.** A wrapper component written as

```svelte
<script>
   let inspection
   $: if (inspection) inspection.open(hand)
</script>

<Inspection bind:this={inspection} />
```

sees `inspection === undefined` for the whole render, and the check reports the
dialog as 0 characters rather than as a fault — a `create_ssr_component` exposes
`render()` and nothing else. What does work is a prop: `Popup.svelte` takes
`openOnMount`, so a panel renders in its open state with no call at all, and
`Inspection.svelte` takes its pile as a prop for the same reason.
`tools/pile-dialog.svelte` is the two of them together — a dialog that opens
itself over a pile — and the render check reads the whole grid, the line above it
and the row of buttons below it through that wrapper, and then makes the moves
those buttons make, which need no browser at all (`moveSelection` and `toBench`).
Both props are off everywhere in the app, and the wrapper is deliberately not in
`src/`: nothing on a board wants a dialog that opens itself.

**`tools/relay-check.mjs` used to ask the clock for an exact millisecond, which the
relay cannot promise.** The check *and the time really left on it* compared the
`remaining` a late spectator is handed against `RUNNING_MS - elapsedRelay(...)` with
`===`, and both numbers are the relay's own reading of its clock, taken a moment
apart — so the assertion failed whenever the two landed either side of a
millisecond:

```
FAIL  and the time really left on it - 298772 left, 1227ms into the clock
```

300000 - 1227 is 298773, and the check four lines above it measures the same quantity
with the tolerance it needs (`Math.abs(drift) <= 1`), so the file already contained
the slack the failing one lacked. It was a flake rather than a fault: **it turned a
push's CI red with nothing changed**, and re-running the job is what cleared it —
which was the advice worth having before going looking for a cause in a diff that had
nothing to do with the clock.

**That is now fixed rather than documented**: both readings are the same clock and 1ms
is the worst the two stamps can disagree by, so the assertion carries the same `<= 1`
as its neighbour. It is worth keeping the story because it is the one piece of red CI
in this repository's history that was *not* about the change being tested — the merge
that tripped it touched one document, a workflow file and two lines of `logger.js`.
The next flake to appear will look just as much like somebody's fault.

**A selection rule written at `img.card.selected` matches nothing, and fixing it is only
half the job — the cascade can still hide the ring.** A selected card is picked out by the
2px `--selection-color` ring on the wrapper `div` `Card.svelte` renders, and the class that
carries it is `class:selected` **on that `div`** — the `img` inside never has it. The prizes'
stylesheet carried an outline rule at `img.card.selected`, twice, and so it matched nothing
on the board: a left click on a prize did select it (the state was right, the menu it opened
was right, the keyboard acted on it), and nothing on screen said so, which reads exactly like
"the click did not register" and gets reported that way. What the rule should have named is
the wrapper:

```css
:global(.prizes .prize > div.selected) { outline: 2px solid var(--selection-color) }
```

Three things about that line, each of which was a separate mistake here:

- **It is the wrapper, not the image**, and the wrapper belongs to another component — so
  the selector has to be `:global()`. A scoped selector compiles to a class the wrapper does
  not carry and matches nothing, silently, which is the same failure one layer along. Only
  the card should be global, though: with the *whole* selector written global, both halves'
  rules match both halves' grids (they are both named `prizes`), so one half's stylesheet
  hides the other's faults — see [selection.md](selection.md).
- **It is an `outline` and not the `border` the hand's cards use**, because in the prizes the
  wrapper *is* the box the cascade worked out (`width`/`height: 100%`), so a live 2px border
  would come out of the image and move it 2px; a card that shifts when it is selected is a
  card that steps out of its row. Measuring the card's rect and its image's rect before and
  after the click is what settles this, and it is what `tools/prize-check.mjs` does.
- **The prize's box has to be lifted over its neighbours.** Past six prizes the rows overlap
  by `card-h - step`, and the rows after it in the markup paint over it, so the ring is
  drawn and then covered — "I can see the glow appear but it is hiding behind the cards",
  which is a *second* bug wearing the first one's clothes. `z-index: 1` on the selected
  `.prize` is the fix, and the thing to test is a hit test just inside the selected card's
  bottom edge rather than the presence of the rule.

The general shape: **a CSS rule about a selection is a claim about a class that some other
component puts on an element, and nothing in the build checks either half of it.** Read the
rule, then read what renders the element, then click it. The rules themselves — what each
kind of selection is drawn with, and why — are in [selection.md](selection.md).

**A shortcut that re-implements a menu entry is a second copy of that entry's rule, and the
copy is the one that goes stale.** `V` is View All of the deck, and so is the deck menu's own
*View All* entry — but they were not the same code. The menu entry called the deck's
`viewDeck()`, which writes *Viewed deck* to the game log (a look through the deck is the one
private look that pile gets, so it is recorded even though the line names nothing), and the
key called `openPile(deck)` directly. It opened the same panel, showed the same cards, and
wrote nothing at all, so the commonest way anybody reads their deck was the one way to do it
in silence — and the three dialog entries that *did* write the line each had their own copy of
the string, which is why nobody noticed a fourth place that should have.

Both halves are now one function (`logDeckView` in `logger.js`, called by all four), and
`node tools/view-log-check.mjs` presses the key and counts the lines. The tell to look for is
a key handler that calls the *primitive* an entry is built on rather than the entry itself:
`openPile(deck)` is what `viewDeck()` starts with, and everything `viewDeck()` adds lives only
in the menu.
