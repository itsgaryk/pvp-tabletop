# Troubleshooting and diagnostics

A tool apiece, for the questions that are expensive to answer by hand. Each of
them exists because the hand-written version of it produced a wrong answer at
least once.

| Question | Where the answer is |
| --- | --- |
| "What actually happened in that room?" | `node tools/room-log.mjs <ROOM>` |
| "Is it the state or the client?" | Settings -> Diagnostics (also at `/diagnostics`) |
| "Has my change actually shipped?" | `node tools/deployed.mjs --url <app> <marker>` |
| "Does the relay still enforce its own rules?" | `node tools/relay-check.mjs` |
| "Does the app really do that, in a browser?" | `node tools/browser-check.mjs` |
| "Is the clock still smooth and still shared?" | `node tools/clock-check.mjs` |
| "Did those cards land in the order that was chosen?" | `node tools/deck-order-check.mjs` (see [below](#is-the-deck-in-the-order-that-was-chosen)) |
| "Does a selected prize glow, and is looking at one logged?" | `node tools/prize-check.mjs` (see [below](#does-a-selected-prize-glow)) |
| "Does the Active spot hold a fan of any length?" | `node tools/fan-check.mjs` (see [below](#does-the-active-spot-hold-a-fan-of-any-length)) |
| "Does the table's stack stay in its cell, and does a marker scale with its card?" | `node tools/zone-fit-check.mjs` (see [below](#does-the-tables-stack-stay-in-its-cell)) |
| "Is reading the whole deck still written in the log?" | `node tools/view-log-check.mjs` (see [below](#is-reading-the-deck-written-in-the-log)) |
| "Is a card still the size of its zone, from one place?" | `node tools/card-sizing-check.mjs` (see [below](#is-a-card-still-the-size-of-its-zone)) |
| "Does the board still render at all?" | `node tools/render-check.mjs` (see [below](#does-the-board-still-render)) |
| "Can a relay that says nothing trap a player?" | `node tools/relay-timeout-check.mjs` (see [relay.md](relay.md#a-request-that-never-answers)) |
| "Do all the places that name a zone agree?" | `node tools/zone-vocabulary-check.mjs` (see [terminology.md](terminology.md)) |
| "Does the deck stand-in still let a board be set up?" | `node tools/fixture-check.mjs` |

## Is a card still the size of its zone?

```sh
node tools/card-sizing-check.mjs
```

This asks the tree rather than a browser, which is the half of verification a
confined session keeps: it cannot tell you a card *looks* right, but it can tell
you the rule that decides it is stated once — and that is the half that kept being
got wrong. Every zone of the board used to size its own cards: nine components
carried a verbatim copy of the same `img.card` width, two benches a copy of the
same `--slot-card-width`, and each copy had a comment pointing at another copy.
The card-sizing PRs are the ledger, and five sizes were wrong in a copy rather than
in the rule.

So the check is about *where the answer lives* rather than what it is: the size is
the one `img:where(.zone-card).card` rule in `global.css`, every pile's own front
wears the class, no zone component writes the formula out again, both benches take
one `--bench-card-width` from `global.css`, and the two active spots keep the
`--slot-card-width` they declare themselves, because the active spot is not the
bench's rule — it is not wide enough for a fan of any length.

**One assertion is about whether the rule still *wins*, and it is the one the check
was missing.** The rule was written as `:where(.zone-card).card` to tie with
`img.card` on source order; `:where()` contributes no specificity, so it was a class
alone, `(0,1,0)`, against `img.card`'s `(0,1,1)` — and `img.card` won, leaving the
deck, the discard and the lost zone with the board's fixed 105px while every other
zone scaled. The check now measures both selectors' specificity and fails if the
zone's stops reaching the cards, which is the failure that every other assertion here
passed through. See [card-sizing.md](card-sizing.md#a-card-on-the-board-is-the-size-of-the-zone-it-is-in)
for the rule and [gotchas.md](gotchas.md) for how it was found without a browser.

Two of its assertions are about what must *not* claim the rule, and both are
regressions it was written after: the table's stack keeps its own fixed size (its
cards are read by looking at them rather than by fitting), which is also why the
size cannot be a `--card-width` handed down from the board — a custom property is
inherited unresolved, so it would be resolved against the zone of every card on the
board, the stack included. Read-only, no browser, no server, nothing started.

## Does the board still render?

```sh
node tools/render-check.mjs
```

**This one is here because the app was dead while every other check was green.** A
one-line change to `Board.svelte` — naming the far half's flip state and writing
`class:upright={$topUpright}` for a plain value rather than a store — made the board
throw `TypeError: store.subscribe is not a function` the moment it mounted.
`npm run build` passed, `docs-check` passed, and clicking **Play Solo** left the main
menu on screen, because the board it mounts never rendered. Nothing in this
repository could see it, and [gotchas.md](gotchas.md) is a long account of why a
confined session has no browser to see it with.

It does not need a *browser*, though — it needs a renderer, and Svelte ships one that
is not a browser. Every component compiles to a `render()` function for the server,
and calling it executes the whole tree: every `$:` statement, every template
expression, every subscription. The same throw happens here, in node, in a second.
So the check compiles the real components and renders the app in the states a person
actually reaches — the main menu, the board in solo (the path that broke), the
sidebar in solo, and the board component on its own.

It is **not** a browser check, and does not replace one: it renders to a string, so
it says nothing about CSS, layout, or what a click does. It answers one question —
does the tree render — and answers it where no browser is needed.

Two things worth knowing about running it. It is the only check here that needs a
dependency the app does not (`esbuild`, a devDependency for exactly this), and it
compiles every component, so it takes a couple of seconds rather than milliseconds.
And because esbuild starts its service child with **piped stdio**, it fails with
`spawn EPERM` under the same confined hosts that break `npm run build` — see the
stdio table in [gotchas.md](gotchas.md). That is a property of the sandbox, not of
the check.

## Verifying a change: `tools/relay-check.mjs` and `tools/browser-check.mjs`

`relay-check.mjs` asks the relay directly about the things this project has
got wrong before — leaving, the two waits, restarts, the idle prompt and the
stale-member sweep — and prints a line per check. It needs no browser and no
network beyond the deployment, so it runs against a Vercel preview as happily as
against `vite dev`:

```sh
node tools/relay-check.mjs                              # against localhost:3005
BASE=https://your-app.vercel.app node tools/relay-check.mjs
```

It reads the windows out of `/api/relay/health` and, against a deployment
running the production ten- and fifteen-minute ones, **skips** the timing checks
and says so rather than either failing or pretending to have run them. Point it
at a server started with second-scale windows and it exercises the whole
lifecycle:

```sh
node tools/fake-redis.mjs &
RELAY_IDLE_MS=3000 RELAY_PROMPT_MS=5000 RELAY_MEMBER_STALE_MS=8000 \
RELAY_HOST_WAIT_MS=3000 RELAY_REJOIN_WAIT_MS=10000 \
RELAY_POLL_WAIT_MS=1000 RELAY_POLL_INTERVAL_MS=300 \
KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev &
node tools/relay-check.mjs
```

`browser-check.mjs` drives the same behaviours through **three real browsers** —
two players and a spectator, the arrangement that caught the spectator bugs — and
checks what is actually on screen: the centred dialogs, the board behind them,
the watcher count in the header, the countdown. It attaches to browsers you
started yourself, one per page on ports 9222/9223/9224, because a helper that
spawns its own browsers has twice put an error dialog on somebody's screen. Its
header comment has the commands.

Its `panel` section covers the board panel's own changes, which nothing else can
see because none of them cross the wire — the Hide Pokémon glow that stays until
it is clicked, the clock in both directions, the Chat tab lit by a message that
arrived while the log was showing, the zone names that come with the zone
outlines and the number the table does not carry, and both markers at once, each
with its own click, its own used state and its own log line:

```sh
node tools/browser-check.mjs --only panel     # just that section
```

It answers the relay's "Still playing?" while it works. The idle windows are the
room's clock rather than one section's, and they are set in seconds for the idle
section's sake — and this is the section that spends longer than that reading the
board without appending anything to the relay. Unanswered, the prompt closed the
room halfway through and every check after it read the main menu: eighteen
failures with one dialog behind them, and three that passed because an empty list
satisfies "none of them do X". Its checks that assert an absence — the deck is
shut, nobody has been told the time is up, no marks are left — now ask for the
board as well, so a room that has gone cannot pass them.

Its `lobby` section covers the way in — the **main menu**. The menu is the logo and
the four buttons and nothing else on the window: the board, the settings cog and
Edit Deck all stand aside while it is up. The logo sits to the left of the buttons,
the buttons are a column of equal widths evenly spaced down it, and the pair is
centred in the window. There is no name field and no Room ID field either, so every
button opens a centred prompt for whatever that button needs — the name, and for
joining or spectating the room code.

```sh
node tools/browser-check.mjs --only lobby     # just that section
```

## Does a selected prize glow?

```sh
node tools/prize-check.mjs
```

A prize is the one card on the board whose box is worked out by a formula rather than
by a grid cell, and the one zone whose rows overlap, so it is the one place a selection
ring can be written correctly at the wrong element (no ring at all) or drawn correctly
under the row below (a ring nobody can see). Both of those happened, and both look like
"my click did not select the prize" from the chair — see
[selection.md](selection.md) for the rules the glow follows.

So the check clicks a prize **through the browser's own hit testing** rather than by
dispatching an event at the element, compares the ring it finds against a selected card
in the hand's own glow, and asserts that the card's rect and its image's rect are
byte-identical before and after the click — a prize that moved when it was selected
would be the outline written as a border. Then it deals past six prizes so the rows
overlap and asks a hit test just inside the selected card's bottom edge which prize is
on top there.

The other half is the log: the double click, the menu's **Show Details** and the space
bar on a **face-down** prize each write *Viewed prize card* once, the space bar again
puts the details away and writes nothing, and none of the three writes anything once
*Show Prizes* has turned that half's prizes face up. The far half's prizes are checked
the same way in solo, and their line has to be in that half's name.

It builds its board without Setup — see the deck stand-in note in
[gotchas.md](gotchas.md) — by sending the top cards of the deck to the prizes.

## Does the Active spot hold a fan of any length?

```sh
node tools/fan-check.mjs
```

The Active spot is the one zone holding a Pokemon with whatever is attached to it that
cannot grow, scroll or be scrolled: a bench's row is as long as it takes and scrolls, and
the hand is the same, but there is one Active spot per player and it is a fixed box in the
grid. It is also the zone a report came in about — *attach a lot of cards and the layout
falls apart, the cards spread apart* — so it is the one zone whose fan is measured rather
than looked at.

Four things are asserted, at twelve lengths of fan, and each is one of the way that report
was true (see [card-sizing.md](card-sizing.md) for the rules and
[gotchas.md](gotchas.md) for the mechanism):

- the Pokemon **keeps the place a lone card has** in its zone, in both axes: the fan used to
  be reserved in the flow, so every card attached pulled the Pokemon a step further left
  until it was outside its own zone
- **every attached card is exactly the size the Pokemon is**: a card may not be resized by
  the box it is drawn in, and the fan's steps are shares of the card, so a clamped card came
  out smaller than the step it was placed with
- the **fan stays inside the zone** however long it gets: past a few cards the steps are
  shares of the room beside the card rather than of the card, and twenty energies are twenty
  overlapping edges rather than a row marching over the Stadium
- and the **cards still overlap, in order**: what a long fan tightens into is a fan

The card images are answered by the check itself rather than fetched — a stand-in deck's
card names are ones no image host serves, and an image that never loads has no height, which
is a different board from the one this is about. What it measures is a real board in a real
browser, so it needs what the other browser checks need: the dev server, the stand-in store
and deck API, and a browser on CDP (`tools/dev-servers.ps1`, then
`node tools/fan-check.mjs`). It fails loudly on the board as it was before the fix — the
Pokemon walked 421 → 329 CSS px across the twelve lengths, and the fan left the zone.

## Does the table's stack stay in its cell?

```sh
node tools/zone-fit-check.mjs
```

Two reports, one subject — something drawn at a size its box did not give it. The table is the
one zone whose cards are sized by its *width* alone and scrolled down when a stack is taller
than the cell, and it is a cell it shares with the other half; the damage counter is a circle
that was a share of its card while the number in it was the page's own font size, so on a small
Pokemon it stood out of the circle on every side.

What it measures, through the browser's own geometry and hit testing:

- the table's zone is the cell, less the pile's own padding, and it is the element that scrolls
- a stack that fits does not scroll, draws no bar, and is centred; a stack taller than the cell
  scrolls, draws a bar that takes its own width (a bar that is *drawn* rather than a floating
  one that hides itself), and both ends of it are reachable — the first card at the top, the
  last at the bottom, which is the assertion that catches a centred stack hiding its own start
- nothing of the stack is the topmost element at any of the four points just outside the zone
- the cards are **the card the zone gives** — the same rule the deck's own card is measured
  against on the same board, so the two cannot drift — and the whole cascade fits the room the
  zone has, so no card is cropped
- the damage counter's circle *and* its digit are shares of the card in both zones that hold a
  Pokemon — the same ratios at 1277x821 and at 900x620 — and the digit fits inside the circle
  at the smaller one

It answers the card images itself, for the reason `fan-check.mjs` does: a stand-in deck's card
names are ones no image host serves, and cards with no picture have no height, which is a
table that never reaches the bottom of its cell. `node tools/zone-fit-check.mjs` after
`tools/dev-servers.ps1`.

## Is reading the deck written in the log?

```sh
node tools/view-log-check.mjs
```

A look through the deck is the one private look the opponent is entitled to know
happened, so it is written as *Viewed deck* even though the line names nothing. Four
things take that look — the deck menu's **View All**, its *Order Top X*, its *Search &
Order Deck*, and the board's `V` — and the key is the one that had a copy of the entry's
body instead of the entry, so it opened the deck and wrote nothing.

The check presses `V`, reads the line out of the solo log, closes the panel with Escape
and asserts the closing wrote nothing, presses it twice to show a look is a line each
time, and then does the same through the menu's **View All** to show the two routes are
one rule. It also presses `Ctrl+V` and asserts that *neither* happens: the command
modifier belongs to the browser and the clipboard, and opening the deck on top of a
pasted room code is the thing that combination must not do.

## Is the deck in the order that was chosen?

```sh
node tools/fake-deck-api.mjs                            # terminal 1: a stand-in deck API
VITE_LIMITLESS_WEB=http://127.0.0.1:6391 npm run dev    # terminal 2
node tools/deck-order-check.mjs                         # terminal 3
```

A placed card is only *placed* if the player draws it next, so this check reads the
order off the dialog — which shows the deck top card first — and then **draws**.
That is the whole method, and it is the only one that works: a count cannot tell a
placement from a shuffle, and a card's *name* cannot tell a placement from a
lookalike, because a real deck holds four copies of it. Both of those were traps
here, and both are answered by the same thing — the stand-in deck's 60 cards all
have different names, so a grid cell, a name and a position are one statement, and
the card that comes out of a draw is compared to the cell wearing the badge for it.

The convention it is really testing is stated in the check itself rather than
assumed: **the grid is top card first, so its first cell is the card a draw takes.**
Verified against a draw before anything is placed, and again after — a placement
that lands upside down reads perfectly in the dialog, and this is the only place
that shows it.

Ordering inside the deck is checked three ways, because the three are different
claims: placing on the top, placing on the bottom (where card 1 of the pair is the
first of them drawn and the deck is read from its other end), and *Order Top X*,
which additionally asserts that **the cards under the block are untouched** — the
one thing that can tell a rearrangement from a shuffle, since the block itself
looks the same either way.

`fake-deck-api.mjs` is to the deck import what `fake-redis.mjs` is to the relay: a
stand-in for somebody else's API, so a browser check does not depend on
limitlesstcg.com being up, answering, and answering the same way twice. Its deck is
deterministic and its 60 card names are all **different** — `Card01` to `Card60` —
which is what makes an order assertable at all. Point the dev server at it with
`VITE_LIMITLESS_WEB`, or leave it out and "Import Random Deck" reaches the real API.
(A duplicate-name deck is the harder case and the one a real game hands you; it is
deliberately *not* what this stand-in serves, because a check about order cannot say
where a card went while four cards answer to the same name.)

## Is the clock smooth, and the same on both boards?

The clock is the one thing here that is about *time*, so it gets its own tool
rather than a section of `browser-check`: it needs twenty quiet seconds on two
browsers, and it makes the room it uses itself. A section that continued in
whatever room another section left open was a check that could be skipped for the
wrong reason — and the fault it exists for, a client-side crash while a board is
being built, shows up as *every* later section failing instead.

```sh
node tools/clock-check.mjs
```

It says whether the room opened at all (which is what a crash in the clock
component looks like from outside), then samples both boards every 700 ms for
twelve seconds of a running clock: never counting up, never stuck, never dropping
several seconds at once, and the two players never drifting apart. Then it moves
one browser's wall clock +8 s and then −9 s underneath it and checks that nothing
on screen moved — a machine clock being corrected by NTP is not time passing on
the table.

Its dev server needs idle windows longer than the run (two minutes is
comfortable), since a clock sits still for twenty seconds at a time on purpose.

## A room's story: `tools/room-log.mjs`

The relay keeps a room as an ordered event log, so every question about a broken
game is really a question about that log. Reading it by hand - fetch
`/api/relay/poll?since=0`, scan for the last `boardState`, look for a
`boardReset` - is easy to do badly, and a bad read is how a wrong conclusion gets
drawn.

```sh
node tools/room-log.mjs ABC123                       # against the dev server
node tools/room-log.mjs ABC123 --tail 40             # just the end of the log
node tools/room-log.mjs ABC123 --json > room.json    # attach it to a bug report
BASE=https://your-app.vercel.app node tools/room-log.mjs ABC123
```

It prints the seats in join order, a timeline with the seconds since the first
event, the counts per event name and per sender, and then a **verdict**:

```
what this log says
  [ok] the last full board state (#6) holds 67 cards (deck 45, hand 7, prizes 6, discard 4, active 2, bench 3)
  [ok] the last full board state (#6) is newer than the last spectator change (#5)
  [-] 11 events over 0s (first #1 at 2026-09-18 17:44:21Z, last #11 at 2026-09-18 17:44:21Z)

verdict: no problem visible in the log - if the board is wrong, suspect the client
```

That last line is the point. `[x]` findings mean the **state** is wrong and the log
says so - a board reset with nothing published after it, a full state that is
empty, a sequence gap, an event burst from two clients echoing each other. No
`[x]` at all means the relay's own record is sound, which moves the suspicion to
the client - and that is what `/diagnostics` is for.

It is **read-only**, and deliberately so: it never sends a `memberId`, so the
relay records no presence for it and spends no writes. Reading a small room costs
four commands (two `GET`, one `LRANGE`, one `HGETALL`) and a room larger than one
poll page costs one extra round.

## The diagnostics panel

Open it from **Settings -> Diagnostics**. It appears as a dialog over the board,
which is deliberate: diagnostics are wanted while a game looks wrong, and going to
another page reloads the app and rebuilds the board - so the thing being diagnosed
would be gone. Pressing the cog, Escape or a click outside closes it.

The same panel is also served at `/diagnostics` as a standalone page, which is
handy for a bug report or for looking at things with no game open. Both render one
component, so they cannot drift apart.

It is a live snapshot of *this browser*: relay health and the poll settings the
deployment is running, the room and its role, the seats in join order, the
spectator count, the clock skew against the relay, the boards' zone counts, and
the last events the transport delivered.

The section that earns its place is the event list:

```
age   seq   event              from          handled
2s    41    boardState         Alice         yes
2s    42    damageUpdated      Bob           yes
1s    43    prizeToggle        relay         IGNORED
```

`IGNORED` means the relay delivered that event and **no handler in this client
was listening for it**. That is the shape of the spectator bugs: the log was
healthy, the poll delivered everything, the board stayed empty and nothing on
screen or in the console said why. An event with no listener used to disappear
without a trace; now it is a line here.

The zone counts are read through `exportBoard()`, the same shape a player sends
the relay - so "deck 45, hand 7, bench 3" here is the number this client is
*publishing*, not a second opinion about the board. If that disagrees with what
the other half shows, the fault is in between.

There is also a **Copy report** button, which puts the whole snapshot on the
clipboard as JSON.

## Claiming a deploy: `tools/deployed.mjs`

Merged is not deployed. A build can lag a merge by minutes, and checking by eye
twice is how "deployed" gets claimed when it is not. This asks the deployment
itself:

```sh
node tools/deployed.mjs --url https://your-app.vercel.app
node tools/deployed.mjs --url https://your-app.vercel.app "some literal from your change"
node tools/deployed.mjs --local            # just this build, no network
```

It answers two ways, because either alone can mislead:

- **the fingerprint** - SvelteKit writes `/_app/version.json`, and each asset
  carries a content hash in its filename. It prints both versions and compares the
  module graph file by file. Assets are discovered the way a browser discovers
  them, by following `import()` from the served HTML, so a route chunk that is not
  preloaded still counts as present.
- **the marker** - a literal string you know is in your change, searched in both
  the local build and the served bundle. `local yes, deployment no` is the exact
  answer to "has my merge shipped?":

```
verdict: NOT DEPLOYED - "last relay error" is in the local build but not in the
served bundle, so the deployment is behind this build.
```

A marker must survive minification, so pick a string literal, a route path, an
event name or a CSS class - not an identifier you invented, which the minifier may
rename.

Three answers are refused deliberately, because each would otherwise be a
confident guess:

- **a marker in neither build** - it proves nothing, so the tool says so rather
  than reporting "not deployed" from no evidence
- **a deployment that cannot be read** - a wrong URL, a 404, or a login wall
  produces "cannot tell", naming what actually came back. Reading a login page
  and calling it an empty deployment is the mistake this avoids
- **a fingerprint that differs** - a deployment built somewhere else (Vercel, CI)
  compiles the same source into different content hashes, so its fingerprint can
  never match a local build and the asset diff is noise. When every marker is
  present the answer is "deployed", with the differing hashes explained rather
  than reported as drift:

```
verdict: deployed - every marker is in the served bundle, so this change is live.
The fingerprint differs (local 1789755944145, live 1789756230756) because the
deployment was built separately, which is normal and not a sign of drift.
```

The version fingerprint is most useful for comparing **one deployment against
itself over time** - before and after a release, or two preview URLs - rather than
a local build against a remote one.

## Failures that used to be silent

A relay fault used to end at `console.error` and nowhere else, so a board could
sit there quietly wrong with nothing to explain it. The transport now keeps the
last 40 faults - failed sends, failed polls, handlers that threw, and events
dropped with nowhere to send them - and the connection panel shows the most
recent one as `relay: <kind> - <reason>`. The full list is on `/diagnostics`.

Solo mode is excluded from "dropped event" reports on purpose: having no room is
the design there, so it is not a fault.
