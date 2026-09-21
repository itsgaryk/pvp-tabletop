# The selection, and the glow that shows it

A click on a card selects it. **The glow is the whole of the feedback that click gets** —
there is no cursor change, no sound, no counter — so a selected card that does not glow
is a card the player will click again, and every bug in this area arrives reported as
"it will not let me select the card". This is what a selection is, what it is drawn with,
and the rules a zone has to follow to draw it.

## What a selection is

Two lists and a pointer, all in `src/lib/stores/player.js`:

| | |
| --- | --- |
| `cardSelection` | the cards picked up — a card in a pile, a card attached under a Pokémon, the table's stack |
| `slotSelection` | Pokémon in play, whole slots rather than the cards in them |
| `selectionPile` | the pile the selected cards came from — a plain value, not a store |

- **One of the two is active at a time.** `selectCard` clears the slot selection and
  `selectSlot` clears the card selection, so a Pokémon and a card are never both selected.
- **The click is `selectCard(card, pile, holdingCtrlOrCmd(e))`**: Ctrl/Cmd adds to the
  selection, and without it the selection is replaced — clicking a card that is already
  selected takes it out again.
- **Multi-select works inside one pile only.** Holding Ctrl/Cmd while clicking a card in a
  *different* pile replaces the selection rather than adding to it, so the selection cannot
  span the deck and the hand at once.
- **Dragging selects first.** `onDrag` picks the card up if it was not already selected, so
  a drag of an unselected card carries that card and nothing else.
- **`Ctrl+A` over a pile** (`selectPile`) fills the selection with the whole pile; that is
  what `tools/solo-select-check.mjs` uses to check the far half's bench.
- **It is cleared** by Escape (unless a card is being dragged), by any click on the document
  that a card did not stop, and by every action that consumes it. Each card's own click
  handler stops propagation precisely so that the document's listener does not undo it.
- **A spectator's selection is read-only.** `selectCard` returns early while `$spectating`,
  so no card can be picked up; a Pokémon in play can still be selected, because that is how a
  spectator reads one, and nothing that acts on a selection will move it — every board
  mutation checks the same flag.
- **In solo both halves share the one selection**, which is why every key that moves it asks
  which half it was made on (`farSelected()` in `Board.svelte`). See
  [solo.md](solo.md#the-two-halves-are-separate-boards).
- **The multi-card dialog is a phase of its own.** `dialogs/Selection.svelte` shows the
  `pickup` pile — the cards a search took off the top of a deck, waiting for the player to
  decide where they go — and it is the same `Card` wearing the same ring, but its own
  selection: `pickup` is a place cards wait, not a place the board's selection came from
  ([terminology.md](terminology.md)).
- **A pile inspection selects off the pile it is showing.** The cards in
  `dialogs/Inspection.svelte` — a deck's *View All*, a discard, a lost zone — are ordinary
  board cards, so clicking one selects it from that pile, click again takes it back out,
  Ctrl adds to the selection and Ctrl+A takes the whole pile. That is the same selection
  the board has, and the same one *Search & Order Deck* uses: it is what the panel's own
  actions move (below), and what the keyboard's `h`/`d`/`b`/`t` move once the panel is
  closed. The actions are enabled only for a selection made *in* the pile the panel is
  showing, because the selection outlives the panel and a card can still be selected on the
  board behind an open one (`selectionPile === pile` in `Inspection`).
- **Both pile dialogs say what is picked out, above the grid.** A selection is one click
  away from leaving the pile, and the *ring on the card is not enough to read a pile by*: a
  count and the names, on a line of their own that does not scroll away, is what makes
  "the three I clicked" something the player can check before saying where they go.
  `Inspection` says *N cards picked out: …* and what a click does when none is;
  `DeckOrder` numbers its strip instead, because there the sequence is the whole of what is
  being decided (a card put back on the deck has a *place*, and one moved to a zone does
  not). Both keep the line whether or not anything is selected, so the grid does not jump
  the moment a card is clicked. It is said in words rather than drawn on the cards because
  the grid is a scroll container, and that clips the other axis too — a badge hung off the
  corner of a card is simply not drawn (see `Popup.svelte`).
- **A pile inspection moves cards to a zone, and that is the whole decision.** Its foot
  carries *Add to table*, *Add to hand*, *Add to bench* and *Add to discard pile* beside
  the buttons that close it — the four places a card comes out of a deck, a discard or a
  lost zone into. They are the board's own moves (`moveSelection`, and `toBench` for the
  bench, since a card put into play is a slot rather than a card in a list), so the move,
  the log line and what the opponent is told are the same as a card dragged out of the
  deck. Each button then closes the panel and, **when the panel is the deck's, shuffles
  it**: a card taken out of a deck is a card out of a deck, and what is left of it is
  unknown — the same reason the button beside them is called *Close & Shuffle*. A discard
  and a lost zone are public and ordered, so nothing is shuffled for them. A spectator sees
  all four disabled, like every other action they cannot take.

## What it looks like

The ring is **2px of `--selection-color`** — `#3b82f6` in the light theme, `#f5d0fe` in the
dark one (`global.css`). Where a particular selection gets it:

| selected | drawn as | where |
| --- | --- | --- |
| a card in a pile, or a Pokémon in play | the `border` of the element the click handler is on | `board/Card.svelte` (`.selected`), `board/Slot.svelte` (`img.card.selected`), `opponent/Card.svelte`, `opponent/Slot.svelte` |
| a prize card | the same wrapper's `outline`, and its box lifted over its neighbours | `board/Prizes.svelte`, `opponent/Prizes.svelte` |
| a card attached under a Pokémon | an `outline` just inside the card's edge, a drop-shadow, and the fan comes to the front | `board/Slot.svelte` / `opponent/Slot.svelte` (`.card-attached-selected`, `z-index: 12`) |
| the table's stack | a **drop-shadow glow in `#fbbf24`**, the one selection on the board that is not the selection colour | `board/Temp.svelte`, `opponent/Temp.svelte` |

The two card components are one rule written twice on purpose — each half's cards are
rendered by its own component — and they agree: a selection is `--selection-color`
wherever it is.

## The three rules

Each of these has been got wrong here, and two of them produce the same symptom: a click
that selected the card and looks like it did not.

**1. The class is on the wrapper, not on the `img`.** `selected` comes from
`class:selected` on the `div` that carries the click handler; the `img` inside it only ever
has `card`. A rule written at `img.card.selected` therefore matches **nothing on the board**,
however sensible it reads — which is exactly how a selected prize had no glow at all while
the state, the menu and the keyboard all behaved.

**2. The ring must not cost any room.** A card on the board is the size of the zone it is in
([card-sizing.md](card-sizing.md)), so a ring drawn as a border *outside* the card's box
makes the card bigger and moves everything beside it. Two ways out, and each zone uses the
one that fits it:

- the wrapper's border, where the wrapper is sized *by* the image inside it (a pile's card,
  and `Slot.svelte`, which asks for `box-content` so the 2px lands outside the image);
- an `outline`, which takes no room at all, where the box has already been worked out and
  must not change.

**3. The ring must not be buried.** A zone whose contents overlap has to bring the selected
thing to the front, or the ring is drawn under whatever is on top of it — "I can see the
glow, but it is behind the cards". The `z-index` has to go on the box that is a sibling of
the covering boxes, not on a child of it: raising the card inside its own wrapper raises it
only within that wrapper's stacking context. The prizes lift the `.prize` box; the attached
fans lift the `img` directly (`z-index: 12`), because there the covering cards are siblings
of the `img` itself.

One more thing a zone that draws its own selection must get right: **the card is rendered by
another component**, so a rule has to be written with `:global()` to reach it. A scoped
`.prize > div` compiles to a class the wrapper does not carry, and matches nothing in
silence.

**And only the card should be `:global()`.** Writing the whole selector global —
`:global(.prizes .prize > div)`, which is how the prizes' rules were first written — makes
each half's copy of them apply to *both* halves, because both halves' grids are named
`prizes` ([terminology.md](terminology.md)). A fault in one half's prizes is then covered by
the other half's stylesheet, and this is not hypothetical: it is what a mutation test of
`board/Prizes.svelte` found, where deleting the near half's selection rule changed nothing on
screen until the far half's copy was deleted as well. `.prizes .prize > :global(div)` scopes
the grid to the component that draws it and leaves only the card global, so each half's rules
are its own and a fault in one shows.

## The prizes, where the arithmetic forces the outline

The prizes are the one zone that is not a grid cell: each prize is an absolutely positioned
box, placed by the row and column it fills, and past the six a game is dealt the rows
overlap so the pile still reads as the two columns it was dealt as — *The prizes cascade*
in [card-sizing.md](card-sizing.md). That is what a selection there has to work around, and
it is the whole of why the rule looks different:

```css
/* the card is 100% of the prize's box, so a live border would come out of the image */
:global(.prizes .prize > div) { border-width: 0 }

/* the ring the hand's cards get from their border, drawn where it costs no room */
:global(.prizes .prize > div.selected) {
   outline: 2px solid var(--selection-color);
   outline-offset: 0;
}

/* and the box the ring is on is lifted over the row that would paint over it */
.prize.selected { z-index: 1 }
```

The selected prize therefore glows **the same** as a card in the hand — the same colour, the
same 2px — by a different mechanism, and the card underneath it does not move by a pixel.
`tools/prize-check.mjs` is what holds that claim down.

## How the glow is checked

`node tools/prize-check.mjs` (see
[diagnostics.md](diagnostics.md#does-a-selected-prize-glow)) clicks a prize **through the
browser's own hit testing** rather than by dispatching an event at the element, because a
synthetic event bypasses the question a stacked zone is really asking. It then:

- reads the ring off the element that carries the selection, and compares it to the ring on
  a selected card in the hand, which is the reference the glow is defined against;
- measures the card's rect **and its image's rect** before and after the click, so a ring
  written as a border — which would shrink the image by 4px — fails rather than passing;
- deals past six prizes, so the rows overlap, and asks a hit test just inside the selected
  card's bottom edge which prize is on top there.

A CSS rule about a selection is a claim about a class another component puts on an element,
and nothing in the build checks either half of it: `npm run build`, the docs check, the
render check and the card-sizing check are all green on a board whose selected prize glows
nowhere. The only thing that answers it is a browser and a real click — see
[gotchas.md](gotchas.md) for what it cost to find out.
