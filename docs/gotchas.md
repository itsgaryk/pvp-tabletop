# Things that cost somebody an afternoon

**Styling a scrollbar with the *standard* two properties hands it back to the platform, which
may be hiding it.** A zone that scrolls has to say so — that is the point of the bar — and
`scrollbar-width: thin` with `scrollbar-color` is the modern pair that looks like the way to
say it. In Chrome those two make the browser paint *its own* bar, and a machine set to hide
scrollbars until the pointer is over them then draws an **overlay** bar: the width it takes out
of the box is zero (so nothing in the layout reserves it, and the cards sized against the zone
are sized against a zone that grows by the bar's width when it appears), and it fades out
again the moment the pointer leaves — *"I have to hover the mouse over to see it"*. Styling
`::-webkit-scrollbar` instead is what makes the bar a thing in the layout: it is drawn when the
box can scroll, it takes its own width out of the box, and `overflow-y: auto` still keeps it
away entirely when there is nothing to scroll. The tell is measurable and worth measuring —
`offsetWidth - clientWidth` is the bar's width, and it is **0 for an overlay bar** and the
bar's own thickness for a drawn one (`tools/zone-fit-check.mjs` asserts a drawn bar is at least
6px, and asserts the reservation is 0 when nothing overflows).

**Centring is the one thing a scroll container cannot do, and `safe center` is the half of it
that it can.** The table's stack is a cascade that can be taller than the cell it is drawn in,
so the cell scrolls it — and the stack has always been *centred* in that cell. Those two are
quietly incompatible: a flex item centred on an axis it overflows is placed with its middle on
the container's middle, so the overflow is split between the two ends, and the half of it above
the container's *start* edge is not part of the scrollable area at all. No wheel reaches it, no
bar drags to it, and `scrollTop` cannot go negative — a player with thirteen cards on the table
would simply never see the first one or two, which reads as the stack starting somewhere in its
own middle. `justify-content: safe center` (and `align-items: safe center`) is the keyword for
what was actually wanted: centre it *while it fits*, and line it up with the start edge when it
does not. Writing the check found it: "the last card is reachable when scrolled to" passes
under plain centring, so what has to be asserted is both that the scroll position reaches
`scrollHeight - clientHeight` *and* that the first card is inside the box at position 0.

**A flex box is a box that will resize what is in it, and a card in a flex line is the third
time this trap has bitten.** `max-width: 100%` on every `img` (the reset) plus a narrower box
is a smaller image — written up below for the table's own wrapper, and again for a slot whose
fan reserved more room than its zone had. Putting the table's stack into a flex line to centre
it is the same trap from the other side: the stack is `width: max-content`, a flex item is
shrinkable by default, and the cascade plus the step it reserved to the right did not fit the
cell — so the *line* squeezed the stack, and the cards followed it down through their own
`max-width: 100%`. A table of cards a few per cent narrower than the card its zone gives is
what that looks like, which reads as "the cards look a bit small" rather than as a bug — and it
was found by measuring a card against the size its own zone should have given it, never by
looking at it. `flex: none` on the stack is the fix, and the general rule is the one the
card-sizing rules are built on: whatever a card is *drawn in* may not resize it. Three
appearances of one trap is not a coincidence — it is what a percentage `max-width` does on a
board whose every container is a box that some later change of layout can narrow.

**A synthetic `keydown` with no `code` throws inside the board's own handler, and the key then
does nothing at all.** The board reads the digit keys out of `e.code` — `parseInt(e.code.slice(-1))`
is how `1`..`9` draw that many cards — so `new KeyboardEvent('keydown', { key: '1' })` with no
`code` gives `undefined.slice`, the handler throws, and the key is ignored. What makes it
expensive is that nothing surfaces: the event dispatched, the handler ran, no dialog appeared,
and a check that means to draw a card before moving one instead moves the cards already in hand
— so it looks like it works, until a loop waiting for a count it will never reach spins until
the runner times out with no output at all. Every key a check sends needs its `code`
(`tools/zone-fit-check.mjs` derives one).

**A fan that reserves its own length in a *fixed-width* line is a fan that resizes the cards
in it.** The report was *"when you start to attach a lot of cards to the active Pokémon the
layout starts to fall apart and cards spread apart"*, with three pictures: the same fan fine on
the Bench, wrong in the Active, and a board where the cards had come out tiny and separated by
gaps. Every part of it followed from one inline style in `Slot.svelte`:

```svelte
<div class="slot" style="margin-right: calc({$energy.length} * var(--slot-step-energy) + {$trainer.length} * var(--slot-step-tool))">
```

- **A slot reserves its fan in the flow, which is right for a row and wrong for a box.** The
  reservation is what keeps a *row* of slots — the bench — from drawing the next Pokémon over
  the previous one's cards, and a bench's row is as long as it takes and scrolls. The Active
  spot is not a row: it is one fixed box in the grid, one per player, and nothing about it
  scrolls.
- **So the margin grew in a line that could not.** With one card and a fan of six energies the
  slot's outer width was 254px inside a 184px zone at the window the checks run at, and the
  container centres what it is given: the Pokémon was dragged left a step per card attached —
  `x` went 421px → 329px across twelve cards, which is the "layout falls apart", and the fan
  ended up hanging out over the Stadium.
- **And once the line was full it squeezed the slot.** A flex item is shrinkable, and its
  automatic minimum size is whatever the browser works out from its contents. The slot's box
  is meant to be the card's size; when it came out *narrower* than the card, **`max-width:
  100%`** — WindiCSS's preflight, which is on every `img` — resized every card attached to it.
  The steps were untouched, because a step is a share of the **card** and not of the box:

  | | the card's width | the step it is placed with |
  | --- | --- | --- |
  | asked for | `--slot-card-width`, 73px | 17.4px, 34.8px, … |
  | drawn inside a 12px box | 12px (clamped to the box) | 17.4px, 34.8px, … (unchanged) |

  Cards 12px wide placed 17.4px apart *are* the reported picture: small cards with gaps. Forcing
  the box to 12px on a live board reproduces it exactly — every card came out 12x17 while
  `left` stayed `17.3944px` — which is how it was found.

- **Why the bench looked right and the checks were green.** A bench's row is `max-content` in a
  scroll container, so a long fan makes the *row* longer rather than the box smaller: nothing
  squeezes, so nothing clamps. And `card-sizing-check.mjs` reads the tree — the size was stated
  once and the class was worn, both true. This one is only visible in a rendering, and only
  when the box actually gets squeezed, which is why it looked right here and wrong to the
  person who reported it, at their window.

The fix is three lines and each closes a door: `--slot-fan-reserve: 0px` in both active spots
(the Pokémon keeps the place a lone card has, and the fan is drawn behind it), `flex: none` on a
slot (its box *is* the card's size), and **`max-width: none`** on a slot's card, in both halves.
The general lesson is the same trap as *A `div` wrapped around an absolutely positioned card is
a box that resizes it* below, met from the other side: **a percentage `max-width` ties an
image's size to the box it is drawn in, and nothing that *places* that image is tied to that box
in the same way** — so a card placed by shares of itself must not be resizable by anything else.
`tools/fan-check.mjs` measures the four promises of the Active spot's fan in a browser and fails
on the board as it was; `tools/card-sizing-check.mjs` asserts the three lines are still there.

**A CDP waiter loop drops the requests that arrive in a burst, and the page then hangs on one
with no error at all.** `page.waitFor('Fetch.requestPaused')` in `tools/browser.mjs` is a
*single* waiter. A board that renders several card images in one turn of the event loop pauses
several requests at once, and every request that arrives while no waiter is registered is
dropped — nobody answers it, the image never finishes loading, and what a check sees is a card
with no height rather than a harness that starved it. It cost a probe written twice and rewritten
a third time before anybody suspected the tool rather than the app: a measurement of "the
Pokémon's image is 73x0" that looked like a fact about the board. Queue the events off the page's
own message handling and drain the queue (`tools/fan-check.mjs` does), or the harness will answer
some of the board's requests and silently starve the rest.

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

  It is worth knowing that it can also be the stand-in *as it is running* rather than as it
  is written: this was met again with an **old `tools/fake-deck-api.mjs` process** — one from
  an earlier session, still holding its port — serving cards with no `stage` while the file on
  disk had had it for months. The symptom is the app's, not the fixture's: `Setup` stays
  disabled, the deck piles up 60 cards and no hand is dealt, and `node tools/fixture-check.mjs`
  passes because it reads the *file*. Compare the process's start time with the file's, or just
  restart it (`tools/dev-servers.ps1` starts the stand-ins by name), before believing anything
  a board check says about a deck.
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
close the deck's view (`Inspection.svelte`). Anything inside the body is clipped horizontally
too (`overflow-y: auto` does not leave the other axis visible), so a badge hung
off the corner of a card is simply not drawn — which is why a selection that has
to be *read* is said in words above the grid rather than drawn on the card. Nothing
in that slot is hidden, so a panel can also choose not to have one: the four buttons
are the deck view's alone, and a discard's view is a Close button on a line of its
own (`selection.md`).

**A panel has two placements, and a new one has to take the old one's `transform`
and every length that hung off `m-8` with it.** A panel is centred horizontally by
`left: 50%` plus `translateX(-50%)`; `.centered` (the diagnostics dialog) and
`.anchored` (a menu under a corner button) each override one or both, and both say
`transform: none` where they stop translating, because a translate left on moves a
panel that is already where it belongs. **What a placement costs is the arithmetic
of the base rule.** Its `max-height` is `calc(100vh - 6rem)` because `m-8` is 2rem
above and below on top of its `top: 2rem`; a placement with no margins that
inherited that number leaves the panel 4rem short of the bottom of the window. A
placement sets what it changes *completely*, rather than leaving the reader to work
out which half of a length still applies.

That is not hypothetical: the pile inspection had a third placement, `.flush`,
which laid it against the left edge of the window because it is a grid as wide as
the window and centring it spends the window's edges on a frame. It read as *the
gap on the left is smaller than the gap on the right* — a panel touching one edge
with 1rem on the other is two different gaps, which is the thing a centred panel is
for. It is gone, and the pile view is the base placement's again. **What made the
placement question go away was fixing the panel's size instead**: a panel with
`width: max-content` on its grid is one width for every pile, so the base rule's
centring has nothing to recompute and the gap from each edge is the same by
construction. When a fixed thing will not sit still, the first thing to ask is
whether it is fixed — the answer here was that it was not, and no placement could
have hidden that.

**A panel is only as wide as its content, so a grid of cards sizes the whole
panel.** The pile inspection's grid is its widest part, and before `width:
max-content` the grid was as wide as the panel while the panel was as wide as the
grid — which settles on however many cards the longest row happened to hold. A pile
of three opened a narrow window, a pile of sixty a wide one, and the panel changed
size as cards were moved in and out of it. `width: max-content` pins the grid to one
full row of the cards it is built for, so a short pile is short *inside* a window of
the same size. Nothing throws without it, every card is still drawn, and the only
symptom is a window that will not hold still — so this is a declaration to keep, not
a tidy-up to make: `tools/render-check.mjs` asserts it, next to the padding rule it
also cannot see.

**The store a component is handed as a prop is not its value, and the fallback is
what hides it.** The pile view's heading counts the cards in the pile it is showing:

```svelte
<span class="count">{$pile?.length ?? 0} {s('card', $pile?.length ?? 0)}</span>
```

Written as `pile?.length ?? 0` — without the `$` — it compiles, renders, and says
**0 cards** for every pile in the game. `pile` is the *store*; a store has no
`length`, `undefined ?? 0` is `0`, and the `?? 0` that was meant to protect an empty
pile is exactly what makes the wrong read look like a right one. It is the same
family as `$topUpright` on a plain value (above), one character away and in the
other direction: that one throws, and this one quietly prints a number. Nothing on
screen says anything is wrong until somebody counts the cards, which is why
`tools/render-check.mjs` now counts them — *and it says how many cards are in the
pile* is that assertion, and it is the only thing in the repository that can see
this class of fault at all.

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

**A callback threaded through three components is verified by three assertions that
each check a third of it, and that is worth saying out loud.** Taking an entry of a
card's menu from inside a pile's view has to finish the view — the deck's view
closes and shuffles what is left of the deck — and it reaches that ending through
three hand-offs: a card in the view carries its pile (`board/Card.svelte`), the
board asks that pile's view whether it is open and lends the menu a way to finish it
(`Board.svelte`), and the menu calls it for an entry that acted and not for *Show
Details* (`dialogs/CardMenu.svelte`). Each line reads perfectly on its own and does
nothing at all on its own: a menu that is never handed the ending leaves the view
open, silently, and a menu that is handed one and does not call it does the same.

The *rule* is a store's and is checked for real — `shuffleAfterLeavingDeck` in
`stores/player.js` shuffles the deck when the deck is one of the piles the cards
left, and `tools/render-check.mjs` counts the *Shuffled Deck* lines it writes: one
for a move out of the deck and none for a discard's, and for an attach, one when the
card lands under a Pokémon and none when it was in hand all along. Each was verified
by removing the gate and watching the assertion go red. The hand-offs are asserted as
source, and that is weaker than the rest of this file's checks: a regex can see that
the callback is passed and used, and cannot see that the click happens. What answers
it is a browser check in the shape of `tools/view-log-check.mjs` — open a deck's view,
right-click a card, click *To Hand*, and ask whether the panel is gone and the log
says *Shuffled Deck* — and that is the one thing missing here.

**An entry that arms the board has not acted, and a side effect asked for at the
wrong moment is the whole of the bug.** *Attach* and *Evolve* are the two entries of
that menu that do not do what they say when they are clicked: they set
`attaching`/`evolving` and wait for the player to click the Pokémon the card goes
under. Firing the deck's shuffle where the entry is taken therefore shuffles a deck
that a change of mind leaves untouched — the card never moved, and the deck is now in
an order nobody chose. The shuffle belongs to the moment the card lands, which is a
*different module*: `attachSelection` in `stores/player.js`, where the card actually
leaves its pile. The shape to watch for is a side effect a menu entry asks for on
behalf of something it has not done yet; move it to the function that does the thing,
and the tell that it is right is that the cancelled case leaves no trace at all.

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

**A `$:` statement cannot see a store that a function call reads, and the value it keeps is the
one from before the store had anything in it.** The Reveal window's heading says which deck it is
showing, and the answer is a field worked out when the batch is applied:

```js
$: owner = revealOwnerHere() === 'mine' ? 'Your deck' : "Your opponent's deck"
```

It read `Your opponent's deck` for a reveal of the player's own deck, and it read that for ever.
`revealOwnerHere()` reads `reveal` with `get()` inside itself, and **Svelte decides what a
reactive statement depends on by reading the statement** - a plain function call is a black box,
so the statement was taken to depend on nothing. It ran once, during the component's
initialisation, while the batch was still `null`, and then never again: the window opened with
the right cards and the wrong heading, and closing and reopening it did not help, because a `$:`
that has no dependencies does not re-run for anything.

The fix is one character of thought and two characters of code: name the store in the statement
(`$reveal?.ownerHere === ...`), or - better - have the store *push* the answer, so the component
reads a field rather than recomputing a mapping. It is the same family as the two notes above it
(`$topUpright` on a plain value throws; `pile?.length ?? 0` prints a wrong number), and it is the
third way this one-character class of mistake shows up:

| written | what happens |
| --- | --- |
| `$plainValue` | throws on mount, and the whole component is dead |
| `store.length ?? 0` | renders, and calmly prints 0 |
| `$plainFunction()` inside `$:` | runs once and keeps that answer for ever |

None of them is visible to the build. What finds the third one is looking at the screen, which is
why the whole feature was driven through two real browsers before it was called done.

**A view that is not *pushed* is a snapshot, and the case that proves it is a board whose own
move writes no event.** A Reveal's window shows the top of a deck, and a card that leaves that
deck has to leave the window. The obvious implementation - a `get()` that filters the batch's ids
against the deck - is right about *what* to show and wrong about *when to show it*: on the
**owner's** board the card is moved by the board's own code, and a player's own events are never
handed back to them (`emit` in relay/client.js skips the sender), so nothing the component
subscribes to ever changes. The window went on drawing a card that was already in the discard,
while the acting player's board - which *did* get an event - drew two.

So the batch owns a **view store** (`revealView` / `lookView`) and subscribes to the deck it is a
view of, refreshing that store on every change. The component reads `$revealView`, and the deck's
own store is what moves it. The general rule: **if something is a live view of a store, something
has to subscribe to that store** - a `get()` in a template is a read, not a subscription, and the
two boards of this app do not receive the same events, so "it updates for me" is not evidence.

**The two halves of a board are two tables of stores, and a name on the wire means a different
store depending on which end reads it.** `oppAction.js` needs a pile by the name an event carries
(`hand`, `deck`, `discard`, …), and it needs it on one of two boards: the acting player looks the
card up in its **mirror** of the other half, and the card's **owner** looks it up in its **own**
zones. Those are different stores with the same names, and one function for both ends was a bug
that took an afternoon to find:

```js
function oppPile (name) { ... defaultOpponent.deck ... }   // used on BOTH ends
```

The owner's client found a card with the same id in its mirror of the *other* player's deck,
removed **that** one, and then tried to move a card that was in none of its own piles -
`moveSelection` silently does nothing with a card it cannot place. So the log said the card had
moved (that line is written before the move), the acting player's window correctly shrank, and on
both boards the card was still in the deck. Nothing threw, and the trace of it is two functions
written out side by side (`oppPile` and `ownPile`) with the note saying why they are not one.

The same trap one layer up is the `mine`/`theirs` flip in reveal.js, and it is worth treating
every name in an event payload as **relative to its sender** until proven otherwise.

**A mirror holds copies of the cards, not the cards.** This one is written down because it decides
the shape of an entire feature and it is invisible from the outside: `opponent.js`'s
`applyBoardState` reloads the card list and `reset()` builds **fresh objects** from it
(`copy` in custom/board.js), so the object a Reveal window is showing on the acting board is not
the object the mirror's deck holds. It has the same `_id` and it is not `===` it.

Anything that matched a batch card by identity therefore found nothing, and the failure reads as
an event that never arrived. What the wire carries is therefore **ids** and never card objects:
the batch keeps ids, the view resolves them against the deck, and every lookup that has to cross
between a board and its mirror is by `_id`. The tell is a feature that works perfectly on the
board that started it and silently does nothing on the board that was told about it.

**A `{#if}` around a component's whole subtree is a component that is not rendered, and `showMenu`
gated the opponent's piles that way.** The far half's `Pile.svelte` wrapped *everything* -
including the count badge and the cards - in `{#if showMenu}`, because the menu was the only
reason it had ever needed to render anything else. The moment `showMenu` became a real condition
(a room has a menu, a spectator does not) that turned into: a pile whose menu is not reachable is
not drawn at all, so the far half's deck, discard and lost zone were **empty cells** with a
working count badge floating where their contents should be.

It survived a while because the DOM it left behind looks plausible and because the check that
noticed it was about something else - "the opponent's deck menu is empty" - and the cause was two
levels away. The fix is the near half's shape, which had always rendered its menu
unconditionally and gated the *call* instead (`board/Pile.svelte`): a menu is an overlay on a
zone, not the zone.

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

**A selection that can come from several piles breaks every place that assumed it could not,
and the assumption is written as a variable rather than as a check.** While a selection could
only ever hold cards from one pile, "the pile the selection came from" was one value —
`selectionPile` in `player.js` — and six moves, both card menus and the far half's four drop
handlers read it (or the drag's `$source`, which is the same pile) as *where these cards are*.
That is only true while the selection is one pile's. Ctrl-click now adds a card from another
zone of the player's own half, and each of those readers had to be re-derived:

- **A move is one move per pile.** `cardsMoved`, `cardsBenched`, `cardsAttached` and
  `cardsEvolved` each name **one** `from`, and the opponent's mirror takes the cards out of
  the pile the event names — so a selection from the hand and the table crosses the wire as
  two events, and one event carrying both would leave half the cards on the other board's
  floor. It is also why the log now reads one line per zone.
- **A pile's `remove` is not a no-op.** It is `v.splice(v.indexOf(card), 1)`, so a card that
  is not in the pile removes **the last card that is** — the note over `slots().remove` in
  `custom/cards.js` is the other half of this. Taking a selection out of the one pile it
  "came from" is therefore not a wrong move but a corrupting one, silently, on both boards.
- **A drop handler that carries the whole selection out of `$source` moves only part of it.**
  The far half's Bench, Active and pile drops all read `$source` — the pile the *dragged*
  card came from — for every card of the selection, and a selection from three zones would
  have had the cards in `$source` moved and the rest left where they were (the `takeFrom`
  guards in `solo.js` skip a card that is not in the pile, which is right, and is exactly what
  makes it silent). None of that was a bug before the selection could span zones; it was a
  precondition nobody had written down.
- **The pile a card is in is now asked of the board**, not remembered: `piles()` in
  `custom/board.js` is every list the board holds — the zones' piles plus the three inside
  each Pokémon in play — and `cardPile`/`selectionByPile` in `player.js` answer from it. A
  remembered map would have been a second source of truth for something every move already
  changes.

What finds this class of fault is not the build and not a browser: it is reading every handler
that consumes the selection and asking what it believes a selection is. `tools/render-check.mjs`
holds the store half of it down — it picks cards up across the hand, the table and the Stadium,
moves them, and asks that each one left the pile it was in — and a browser check that had
encoded the old rule had to change with it: `tools/solo-select-check.mjs` asserted that
pressing `H` emptied the far half's whole table, which was true only while a click on one card
of the stack picked up all of them. A check is written against the rule as it stood, and it
will hold the old rule in place until somebody reads it.

**A `div` wrapped around an absolutely positioned card is a box that resizes it, and
`max-width: 100%` is how it reaches the card.** The table's stack needed its cards to be picked
up one at a time, and the obvious way to hang a click handler and a `selected` class on a card
is to wrap it:

```svelte
<div class="table-card" style="left: {i % 2 !== 0 ? 20 : 0}px" on:click={...}>
   <img class="card" src={cardImage(card, 'xs')}>
</div>
```

Every card in the stack drew at a **different width**, and the stack stopped looking like
itself. Nothing threw, every card was there, the selection worked perfectly — the bug was
purely the geometry, and it was reported as *"the appearance of the cards in the table view has
changed"*.

Why, in the order it happens:

- **An absolutely positioned box with `left` set and `width: auto` is shrink-to-fit**, and its
  available width is the containing block's width *less that offset*. The stack's container is
  `w-max` — as wide as a card, `--card-width`, 105px — so a wrapper for the odd cards came out
  `105 − 20 = 85px`. The old markup had the `img` itself absolutely positioned, and an `img`
  with `width: 105px` does not care what is available: it is 105px wide.
- **The card image wears `max-width: 100%`** (WindiCSS's preflight sets it on every `img`), so
  the image inside the 85px wrapper became 85px wide, and `height: auto` took the height down
  with it. Cards 0 and 2 of the same stack stayed 105px, card 1 was 85px: a cascade of two
  different card sizes.
- **The offsets then lie.** `bottom: -35px` positions the *wrapper's* box, which is now 30px
  shorter than the card it holds, so a card in the middle of the stack sits at a height nothing
  in the markup asked for. Every offset is right and the drawing is wrong.

The fix is to put the handlers and the classes on the card's own `img` — which is how
`Slot.svelte` writes a card attached under a Pokémon, and why it is written that way — so the
element that is placed is the element that was always placed, and the stack's geometry is the
offsets again. The general rule is worth more than the instance: **a wrapper is not free on an
element whose box is placed by the markup.** `width: max-content` on the wrapper would have
held the width (and left the height, the baseline and the flex centring to disagree instead) —
restoring the box structure is what makes the picture identical rather than merely close.

Nothing in this repository can see this one: the build is green, the card-sizing check measures
`global.css` rather than a rendering, and the render check renders to a string and says nothing
about layout. What *did* see it was a person looking at the board — and, once it was reported,
a crop of that screenshot decoded to raw pixels and measured. The two cards of that stack came
out **137 and 109 device pixels wide**: 109/137 is 0.795, and `(105 − 20) / 105` is 0.810, while
the narrow one's left edge sat exactly the 20px step right of the other's (`left: 20px`, at the
capture's scale). That is the arithmetic of the wrapper above, read off the screen — and it is
worth doing rather than squinting at a screenshot: the numbers say *which* rule did it, and the
same numbers in the old markup would all have been one width.

**A permission written onto a card is a permission that leaks to the board the card came
from.** The "allowed to take action on this opponent card" property that a Reveal and a Look
need reads like a flag on the card — that is how it is worded, and the card is the thing the
rule is about. It is the wrong shape, and not for a subtle reason: **a card object is shared
between a board and its mirror within one client.** `opponent.js`'s `applyBoardState` moves the
*same objects* out of the deck into the mirror's zones, and `cardsMoved` moves them by id, so
the card the opponent's deck holds and the card this player's mirror holds are one object with
two references. A `canAct` field written onto it would therefore be a field on the *owner's*
own card as well, and the owner's own board would offer the "somebody else's card" menu for
their own card — a menu whose every entry asks the other player to move it. It cannot be found
by looking at one board, because each board does exactly what its own copy of the flag says.

What replaced it is a property of the **batch** — the set of cards a Reveal or a Look is
showing, held in `stores/reveal.js` — and a card is actionable exactly when it is one of them.
Three things fall out of that, and each is why the shape is right rather than merely different:
it cannot outlive the board it was about (the batch is reset with the board, and replaced
wholesale by the next reveal); it cannot drift, because it *is* the record every move is
already written against; and it is one object per client, so the two boards cannot disagree
about what it says. The general rule is worth stating: **a per-card flag is a claim about a
card, and a card here does not belong to one board.** See [reveal.md](reveal.md).

**A batch that is a copy of a list keeps offering cards that have already left.** The window a
Reveal opens is a view of the top of a deck, so the obvious implementation is to take the cards
at reveal time and render that list. The symptom is nothing like a bug: the player right-clicks
a revealed card, sends it to their discard, and the card **stays in the window**, still
clickable — and the second click does nothing at all, silently, because the card is no longer
in the deck the action looks it up in. Two independent-looking faults ("it did not disappear"
and "the menu stopped working") out of one design decision.

The batch is therefore a **live view of the deck it was taken from** — `get()` returns the
batch's cards that are *still in that deck* — while the ids it was built from are kept as the
record of the gesture, which is what the permission is checked against. So a card that has been
acted on leaves the window and stops answering in the same moment, and a card moved back into
the deck rejoins it. The tell to look for in a feature like this is a window whose contents are
a snapshot: **ask what happens to a card in it after it moves.**

**The two boards name a half the same way, which means the word has to be flipped exactly once
and nobody notices when it is not.** A reveal is written by the player who made it, so its
event says `mine` for *their* deck and `theirs` for the other one. Everything on the receiving
side — the window's heading, the deck the Close & Shuffle button shuffles, the pile a card's
menu acts on — wants the *reader's* word, where `mine` is this board's own deck. So an incoming
batch has to be turned around (`localOwner` in `reveal.js`), and the failure when it is not is
the worst kind here: the batch is gathered off the wrong deck, none of the ids are found in it,
and **the window never opens on the other player's screen**. On the revealer's own board
everything is perfect — their window is drawn from cards they already had, so the flip is never
exercised there — which means the half of the feature that works is the half being looked at.
`mine`/`theirs` is a second naming vocabulary for the same two halves that
[terminology.md](terminology.md) already has four of, and it is worth knowing that before
adding a fifth thing that names a half.

**A menu that opens a card from another board has to be told *which* pile the card is in, and
the pile may not be a pile.** A Reveal's window hands its cards the *batch* as their `pile`,
because that is what every card component needs one for (`cardPile`, `selectPile` for Ctrl+A).
The batch deliberately has the deck's own name (`deck`), so it reads exactly like one — and
that is the trap: `board/Card.svelte` tells the two situations apart by asking whether the pile
it was handed is one of *this* board's own lists (`piles()`), not by the name, because the name
is the same on purpose. Two things then have to follow: the menu that acts on somebody else's
card has to translate the batch back to the real deck before it can take the card out of
anything, and the *near* half's card component must never reach that menu at all — a card of
the player's own is never somebody else's. Both are asserted in `tools/render-check.mjs`,
because neither has a symptom until the wrong menu opens on the wrong card.
