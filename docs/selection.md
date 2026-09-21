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
| `cardSelection` | the cards picked up — a card in a pile, a card attached under a Pokémon, a card in the table's stack |
| `slotSelection` | Pokémon in play, whole slots rather than the cards in them |
| `selectionPile` | the pile the **last** picked-up card came from — a plain value, not a store |

- **One of the two is active at a time.** `selectCard` clears the slot selection and
  `selectSlot` clears the card selection, so a Pokémon and a card are never both selected.
- **The click is `selectCard(card, pile, holdingCtrlOrCmd(e))`**: Ctrl/Cmd adds to the
  selection, and without it the selection is replaced — clicking a card that is already
  selected takes it out again.
- **Multi-select spans the player's own half of the board.** Holding Ctrl/Cmd while
  clicking a card adds it *wherever it is on that side*: the hand, the table's stack, the
  Stadium, the cards fanned under a Pokémon, a prize. A selection is the player's cards,
  not the contents of one pile — which is what the table's cards needed, because they are
  picked up one at a time (below) and a card of the player's on the table has to be able
  to join one in their hand.
- **It does not span the two halves.** In solo both halves are played from the one
  selection, and every key that moves one asks which half it was made on (`farSelected()`
  in `Board.svelte`), so a card of the other half's *starts* a new selection rather than
  joining this one — a selection holding both would have no one answer to that question,
  and a move would carry half of itself across the table. `sameHalf` asks the board for
  its own lists (`piles()`), so the far half is recognised without `player.js` having to
  know anything about the mirror. Online this never comes up: the far half's cards are
  not selectable at all.
- **Only the player's own cards are picked up, in the two shared zones included.** The
  table and the Stadium are cells both players play into, and each half's cards there
  belong to that half: online the other player's are not clickable in those cells (their
  own components refuse the click, as they do in every zone), and in solo the far half's
  cards are the far half's selection. Nothing here can pick up a card the player does not
  own, which is the rule a shared zone makes worth restating.
- **A move takes each card out of the pile it is in.** `selectionPile` is where the last
  click was made, and it is what the card menus and the "which half" question are about;
  *where a card is* is a per-card question, and `selectionByPile` asks the board's own
  lists for it (see [The pile a card is in](#the-pile-a-card-is-in)). A card already in
  the destination is not a card to move — it is the destination — and a selection with
  nothing but those is a selection with nowhere to go, which is what pressing `H` with a
  hand card picked up has always done.
- **Dragging selects first.** `onDrag` picks the card up if it was not already selected, so
  a drag of an unselected card carries that card and nothing else, and a drag of a card
  that *is* selected carries the whole selection — across zones, if that is where it is.
- **It is cleared** by Escape (unless a card is being dragged), by any click on the document
  that a card did not stop, and by every action that consumes it. Each card's own click
  handler stops propagation precisely so that the document's listener does not undo it.
- **A spectator's selection is read-only.** `selectCard` returns early while `$spectating`,
  so no card can be picked up; a Pokémon in play can still be selected, because that is how a
  spectator reads one, and nothing that acts on a selection will move it — every board
  mutation checks the same flag.
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
  closed. The panel is a view of **one pile**, so what it acts on is the picked-up cards
  that are *in that pile*: a card can still be selected on the board behind an open panel,
  and it neither appears in the panel's line of names nor is carried out of the panel by
  its four buttons (`keepInPile`, called as one of them is pressed).
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
  the buttons that close it — the four places a card comes out of a deck into. They are the
  board's own moves (`moveSelection`, and `toBench` for the bench, since a card put into
  play is a slot rather than a card in a list), so the move, the log line and what the
  opponent is told are the same as a card dragged out of the deck. Each button then closes
  the panel and **shuffles the deck**: a card taken out of a deck is a card out of a deck,
  and what is left of it is unknown — the same reason the button beside them is called
  *Close & Shuffle*.
- **The four buttons belong to the deck's view alone, and the other views are reads.**
  They are what a *search* does with what it finds, which is a move out of a deck; a discard
  and a lost zone are public and ordered, and nothing comes out of either into play. So
  those views, and the hand's, are the cards, the heading that says which zone they are, and
  one button that closes the panel — the deck's is the only view with a foot full of
  actions. The condition is `isDeck` in `Inspection.svelte`, and
  `tools/render-check.mjs` renders every zone's view and asserts which of them offer the
  four, because a check that rendered one pile could not tell which way round the condition
  was. A spectator sees the four disabled, like every other action they cannot take.
- **Every pile's view says which zone it is.** A heading at the top of the panel carries the
  zone's name, how many cards are in it, and the zone's own colour. Without it a deck, a
  discard and a lost zone are one screen with different cards in it — and the point of the
  colour is two of them open side by side, which is how a deck is read against a discard.
  The name and the colour come from the pile's own store name, the one vocabulary the board,
  the log and the wire already agree on ([terminology.md](terminology.md)), so a pile cannot
  be labelled as some other pile. The table of the zones and their colours is `ZONES` in
  `Inspection.svelte`.
- **The panel is a fixed window, not one the pile sizes.** The grid is the panel's widest
  part and the panel is only as wide as its content, so a grid that is as wide as its cards
  make it resizes the whole panel with the pile: a narrow window for a pile of three, a wide
  one for a pile of sixty, and a panel that changes size as cards are moved in and out of it.
  `width: max-content` on the grid pins it to one full row of 136px cards — about seven —
  which is what makes a pile of three short *inside* a window of the same size as a full
  deck's. Nothing about the panel depends on how many cards there are, which is also why it
  has no placement of its own: the base rule centres it, and a fixed box that is centred
  stays where it is put. A window too narrow for that row (a small screen) is the one case
  that is not the size it says: `max-width: 100%` hands the grid the room there is and the
  cards wrap to fewer to a row.

## The pile a card is in

One selection can hold cards from several zones, so "which pile did this card come from?"
stopped being a question the selection as a whole could answer, and it is now asked once
per card. The answer is not remembered anywhere: `cardPile(card)` looks in the board's own
lists for the card and returns the one that holds it, and `selectionByPile()` gathers the
selection that way. `custom/board.js`'s `piles()` is the list it looks through — the zones'
piles plus the three lists inside every Pokémon in play — and it is derived from the stores
rather than kept beside them, because a second record of where a card is drifts the moment
a move forgets to write to it.

Two things follow, and both are the reason it is done this way:

- **A move is one move per pile.** `cardsMoved` (like `cardsBenched`, `cardsAttached` and
  `cardsEvolved`) names *one* `from` and *one* `to`, and the opponent's mirror takes the
  cards out of the pile the event names — a list that came from two piles cannot be read
  that way. So a selection picked up across the board crosses the wire as one event per
  zone, and the log reads as one line per zone, each naming where those cards came from.
- **A card that is nowhere is not carried.** If something else has moved a picked-up card
  on, it is in none of the lists and is simply left out — rather than removed from a pile
  that does not hold it, which is a `remove` that takes the *last* card instead
  ([gotchas.md](gotchas.md), and the note over `slots().remove` in `custom/cards.js`).

In solo the far half is a board of its own, and its own `piles()` answers for its cards:
`soloSelectedTo` and `soloSlotAttach` gather that half's selection the same way, out of
`defaultOpponent.piles()`.

## The table's stack, where a card is picked up on its own

The table's cards used to be one thing: a click anywhere on the stack selected the whole
of it, and the stack — not the card under the pointer — was what the click was on. Each
card is now picked up on its own, the way a card attached under a Pokémon is: a click
selects that card, Ctrl/Cmd adds it, right-clicking one opens *that card's* menu, dragging
one carries it, and the selected card comes to the front of the cascade so that its glow
is readable where a dozen cards overlap. What is left of the stack as a stack is its own
gestures — *View All* is the double click, the `W` key and the zone's menu on the part of
the stack no card covers.

Two things about the stack do not change, and are worth keeping in view while reading the
component:

- **Its cards keep their own size.** Every other card on the board is the size of the zone
  it is in; the table's are the size the board gives a card with no zone to size it
  (`.game`'s `--card-width`), because a stack is read by looking at it
  ([card-sizing.md](card-sizing.md)).
- **The stack's offsets are the layout, and the card is the element they are written on.**
  The first card is in the flow and sizes the stack; every card after it is absolutely
  placed at a fixed step, and each of them is an `img` with the click, the selection and the
  drag on it — the way a card attached under a Pokémon is written. That is deliberate, and
  not only for the ring: **wrapping the card in a `div` changes its size.** An absolutely
  positioned box with `left` set and `width: auto` is shrink-to-fit, so its available width
  is the containing block's less that offset — the wrapper comes out `--card-width − left`
  wide, and the card image inside it, which wears `max-width: 100%`, shrinks with it. Two
  cards of one stack then draw at two different sizes, which is what the cascade looked like
  the first time this was written ([gotchas.md](gotchas.md)).

So a selected card's ring is an `outline` and its glow a `drop-shadow` on the image itself,
and neither of them moves anything: a border on the card would shift it out of the cascade,
and a wrapper to hang the ring on would resize it.

## Select all, and the one zone that does not answer it

`Ctrl+A` over a pile fills the selection with the whole of it (`selectPile`), and the zone
it is pressed in is the element that listens for it (`use:ctrlA`, on the `Pile` a zone is
built from, and on the grid a pile's view draws). The piles answer it: the deck, the
discard, the lost zone, the hand, the prizes, a pile's own view in a panel, and the bench —
which takes its slots rather than cards in a list.

**The table does not.** It is a stack of cards that are each picked up on their own, so
"the whole stack at once" is not a selection this zone offers; `Pile.svelte`'s `selectAll`
prop is the mechanism, still there and still on by default, and both tables pass
`selectAll={false}` (the far half's too, because in solo that half is played from this same
board). Nothing on the board selects the whole table now — the `X` key still *takes* it
with nothing picked up, which is the move that key was always named for ("pick the table
back up") and leaves nothing selected behind it, since a move ends by clearing the
selection.

The mechanism is kept rather than deleted: it is the piles' own, the table is the one zone
that wants no part of it, and a future zone may want it back. Both table components are
read by `tools/render-check.mjs`, which asserts they no longer call `selectPile`.

## What it looks like

The ring is **2px of `--selection-color`** — `#3b82f6` in the light theme, `#f5d0fe` in the
dark one (`global.css`). Where a particular selection gets it:

| selected | drawn as | where |
| --- | --- | --- |
| a card in a pile, or a Pokémon in play | the `border` of the element the click handler is on | `board/Card.svelte` (`.selected`), `board/Slot.svelte` (`img.card.selected`), `opponent/Card.svelte`, `opponent/Slot.svelte` |
| a prize card | the same wrapper's `outline`, and its box lifted over its neighbours | `board/Prizes.svelte`, `opponent/Prizes.svelte` |
| a card attached under a Pokémon | an `outline` just inside the card's edge, a drop-shadow, and the fan comes to the front | `board/Slot.svelte` / `opponent/Slot.svelte` (`.card-attached-selected`, `z-index: 12`) |
| a card in the table's stack | the same outline and glow, and that card lifted over the cards it overlaps | `board/Temp.svelte`, `opponent/Temp.svelte` (`img.card.table-card.selected`) |

The table's stack is the one that changed sides here. It used to wear a drop-shadow glow in
`#fbbf24` — the one selection on the board that was not the selection colour — because what
was selected was *the stack*: one thing, picked up whole, like a pile's front. A card is now
picked up on its own, and a card selection is `--selection-color` wherever it is, so the
stack's own colour is gone with the stack's own selection. What it keeps from the pile's
cards it was standing in for is nothing: the ring, the glow and the lift are the attached
card's treatment, because that is the same gesture on the same kind of thing.

The two card components are one rule written twice on purpose — each half's cards are
rendered by its own component — and they agree: a selection is `--selection-color`
wherever it is.

## The three rules

Each of these has been got wrong here, and two of them produce the same symptom: a click
that selected the card and looks like it did not.

**1. The class goes on the element that carries the click handler, and on a pile's card that
is the wrapper, not the `img`.** A pile's card is `Card.svelte`'s `div`, so `selected` comes
from `class:selected` on that `div` and the `img` inside it only ever has `card`. A rule
written at `img.card.selected` therefore matches **nothing in those zones**, however sensible
it reads — which is exactly how a selected prize had no glow at all while the state, the menu
and the keyboard all behaved. The table's stack is the other way round, and deliberately: it
draws its own card, the `img` itself carries the handler, and so `selected` is a class on that
`img` — which is also how `Slot.svelte` writes an attached card. Read the markup for the zone
before writing the rule; the class is wherever the click is.

**2. The ring must not cost any room.** A card on the board is the size of the zone it is in
([card-sizing.md](card-sizing.md)), so a ring drawn as a border *outside* the card's box
makes the card bigger and moves everything beside it. Two ways out, and each zone uses the
one that fits it:

- the wrapper's border, where the wrapper is sized *by* the image inside it (a pile's card,
  and `Slot.svelte`, which asks for `box-content` so the 2px lands outside the image);
- an `outline`, which takes no room at all, where the box has already been worked out and
  must not change — the prizes, whose box is the cascade's arithmetic, the attached cards,
  which are placed by the fan's shares of the card, and the table's stack, which is placed
  by the offsets that draw it.

**3. The ring must not be buried.** A zone whose contents overlap has to bring the selected
thing to the front, or the ring is drawn under whatever is on top of it — "I can see the
glow, but it is behind the cards". The `z-index` has to go on the box that is a sibling of
the covering boxes, not on a child of it: raising the card inside its own wrapper raises it
only within that wrapper's stacking context. The prizes lift the `.prize` box; the attached
fans lift the `img` directly (`z-index: 12`), because there the covering cards are siblings
of the `img` itself; and the table's stack lifts the card (`z-index: 12`) the same way, since
its cards are siblings with no wrapper between them.

One more thing a zone that draws its own selection must get right: **the card is rendered by
another component**, so a rule has to be written with `:global()` to reach it. A scoped
`.prize > div` compiles to a class the wrapper does not carry, and matches nothing in
silence.

**And a rule that names the `img` has to out-specify the board's own rule about it.** The
table's cards are the case: `img.card.table-card.selected` carries `img.card` in it not for
clarity but for weight, because `Board.svelte` sets a `filter` on `img.card`
(`.game img.card`), each component's scope class adds one more to that, and a rule written at
`.table-card.selected` therefore loses — the glow is simply not drawn, silently, while
everything about the selection works. It is the same shape as the card's own size, which had
to *tie* with `img.card` on specificity to win ([card-sizing.md](card-sizing.md)); a rule
about a card's appearance lives next to a rule about the card, and has to reckon with it.

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

What a browser is not needed for is the *selection itself*, and the table's stack is where
that line falls: `tools/render-check.mjs` renders the boards, picks cards up across the
hand, the table and the Stadium, moves them and asks where they landed, and reads both table
components to assert that a card is picked up on its own and the stack no longer takes the
whole selection. What it cannot see is the ring those cards draw — that is
`tools/solo-select-check.mjs`, which clicks the far half's table through the browser's own
hit testing (see [diagnostics.md](diagnostics.md)).
