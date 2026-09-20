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
