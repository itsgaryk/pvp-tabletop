# Things that cost somebody an afternoon

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

**A `Popup`'s body scrolls; its actions do not.** `Popup.svelte` gives the panel
the window's height at most and hands what is left to `.popup-body`, which
overflows — so anything that has to stay visible while the cards are scrolled
belongs in the `buttons` slot, and the actions are **one per line**, which on a
636px-tall window is 20% of the deck per button. Anything inside the body is
clipped horizontally too (`overflow-y: auto` does not leave the other axis
visible), so a badge hung off the corner of a card is simply not drawn.

**`tools/relay-check.mjs` asks the clock for an exact millisecond, which the relay
cannot promise.** The check *and the time really left on it* compares the `remaining`
a late spectator is handed against `RUNNING_MS - elapsedRelay(...)` with `===`, and
both numbers are the relay's own reading of its clock, taken a moment apart — so the
assertion fails whenever the two land either side of a millisecond:

```
FAIL  and the time really left on it - 298772 left, 1227ms into the clock
```

300000 - 1227 is 298773, and the check three lines above it measures the same quantity
with the tolerance it needs (`Math.abs(drift) <= 1`), so the file already contains the
slack the failing one lacks. It is a flake rather than a fault: **it turns a push's CI
red with nothing changed**, and re-running the job is what clears it — which is worth
knowing before going looking for a cause in a diff that has nothing to do with the
clock. The fix, if it is wanted, is that same `<= 1`.
