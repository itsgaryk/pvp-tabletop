# Reveal and Look

Two ways a player is shown cards out of a deck, and the two ways one player may touch a deck
that is not theirs. They are the same gesture with two different audiences, and that is the
whole of the difference between the first two:

| | Shown to | Window opens on | Ends with |
| --- | --- | --- | --- |
| **Reveal** | both players | both boards | Close & Shuffle, then Close |
| **Look** | the player who looked | that player's board only | Close & Shuffle |
| **Discard Top Card / X** | nobody — no window | — | the cards are in the discard |

Both of the first two are entries on a deck's own right-click menu — *Reveal Top X* on either
deck, *View Top X* on the opponent's — and both are asked for with the browser's
`prompt`, the way every other "X" on this board is (*Draw X*, *View Top X*, *Order
Top X*). Each opens a pile window: the same panel a pile's view is, the same scroll
container, the same foot of actions.

The discards are the third entry on the opponent's deck and the third and fourth on the
player's own, and they are the ones with no window at all: the cards move from the top of the
deck to the discard when the entry is taken, and that is the whole of the gesture (see
*Where the entries are offered*, below).

The cards never leave the deck during a Reveal or a Look. A reveal is a *view of the top of a
deck*, so nothing is moved, nothing is drawn, and closing the window needs no cleanup at all
— the deck is exactly where it was, in the same order, until *Close & Shuffle* says
otherwise.

## Why this is not "Reveal Hand"

The board already had a *Reveal Hand*, and it is a different thing wearing a similar
name. It is worth writing down, because the obvious next question is why two features
that both "show cards to the other player" share no components.

**Reveal Hand is a standing flag on a zone; a Reveal is one act about a deck.** The
flag is `handRevealed` (one of the three per-zone visibility flags, see
[board.md](board.md)), and it is read in exactly three places: `board/Hand.svelte`
toggles it and shares `handToggle`, `opponent/Hand.svelte` reveals that hand with it,
and `Board.svelte` tints the hand row. It shows nothing by itself — the opponent's
hand is *always on their board*, and the flag only decides whether those cards are
drawn as faces or card backs, in place, until it is switched off again. There is no
window, no set of cards, and no ending: nothing to close and nothing to shuffle.

| | Reveal Hand | Reveal Top X / View Top X |
| --- | --- | --- |
| what it is | a standing per-zone flag | one act about a deck |
| what it shows | every card in a zone, always there | the top X, named once, as ids |
| where it is drawn | in place, in the zone | a window, over the board |
| how it ends | toggled off | Close & Shuffle, then Close |
| reaches whom | the other player, via `handToggle` | a batch, via `cardsRevealed` |
| may be acted on | no — they are not yours to move | yes, by the permission above |

So there was no component to reuse: the flag's three readers are a toggle, a boolean,
and a CSS class, and none of that is a pile window. What *is* shared is the machinery
underneath both: the same `Card` a pile's view draws, the same `Popup`, the same
`cardback`-or-face decision at the card, and the same rule that a card of the other
player's stays theirs. The window a Reveal opens is deliberately the panel
`Inspection.svelte` is, because what it shows is the same kind of thing — cards held by
a pile — while Reveal Hand has no panel to reuse in the first place.

## The permission: "allowed to take action on this opponent card"

A card a Reveal or a Look is showing may be **acted on as the other player's**. It
can be left-clicked like a card of the player's own, and right-clicking it gives
this player's own card menu — *To Hand*, *To Discard*, *To Bench*, *To Active*,
*To Stadium*, *Shuffle Into Deck*, *To Top/Bottom of Deck*, *To Lost Zone*, *To
Prizes*, *To Table*, *Attach to Their Active*, *Show Details* — with every entry
landing on the **owner's** half.

That property is not a field written onto the card. It is the **batch**: a card is
actionable exactly when it is one of the cards of an open batch, and `isActionable`
in [src/lib/stores/reveal.js](../src/lib/stores/reveal.js) is the one place the
answer lives. Three reasons it is done that way, and each of them was a design
decision rather than a shortcut:

- **A flag on the card would leak.** A card object is shared between a board and its
  mirror *within one client* — the mirror's cards are the same objects, handed over
  in a board state — so a property written onto one would follow it onto the owner's
  own board, where it would offer the opponent's menu for the owner's own card.
- **A set of ids beside the cards can drift.** It is a second record of something
  every move already changes, and it would need writing in every place a card moves.
  The batch is derived from the deck itself, so it cannot be stale.
- **It cannot outlive the board it was about.** The batch is reset with the board
  (`onBoardCleanup`), and the next reveal replaces it wholesale.

What the player sees is the pulse: a card that may be acted on wears a 2px
`--primary-color` outline that breathes, drawn as an `outline` so it costs no room
and so it can sit *beside* the selection ring rather than instead of it
(`opponent/Card.svelte`). Without it there is nothing on screen to say which cards
answer — a Reveal's cards are the other player's, so the default assumption is that
they are inert, and a player who assumes that never finds the menu.

The pulse is an **affordance and not a rule**, and a Look turns it off (`pulse={false}`).
In a Reveal it distinguishes the one or two cards of the other player's from the cards of
the player's own around them. In a Look *every* card in the window answers, so a glow on
all of them is decoration — and worse than decoration, it made a chosen card's own ring
hard to read. What replaces it is a line in the header saying what a click does
(`Look.svelte`), because the ring that appears *after* a click is then the only feedback
there is, and a window with no hint and no pulse reports itself as "I cannot select the
cards" (which is how that was reported).

### One card or several

The permission is per card and the selection is the board's own, so a window's cards are
selected the way every other card on the board is: click one, **Ctrl-click** to add
another, **Ctrl+A** over the window for all of them. Right-clicking any of them gives the
same menu, and its entries act on **everything picked up that is in the same pile** — so
three cards out of a reveal can go to the opponent's discard with one entry. Two details
make that read honestly rather than mysteriously:

- the menu's heading says `2 cards` rather than the clicked card's name, and *Attach*, the
  one entry that can only take a single card, says `Attach the First to Their Active`
- what bounds it is the pile, not the window: a request names **one** pile, so the cards
  carried are the selected ones in the same pile as the clicked card. In a Reveal or a
  Look that is the whole batch, and it is also what keeps a card of the opponent's
  selected on the board *behind* the window from being swept up with them.

### Dragging a card out of a window

A card in one of these windows can also be dragged onto the other player's half: dropping
it on a zone is the same request the menu entry for that zone makes (`actionForPile` →
`dropRevealedCard` in `oppAction.js`), so it lands in the owner's zone and not the
player's. The gesture is the board's own drag (`pointerdown` and a five-pixel threshold,
not HTML5 drag-and-drop), and it is wired on the far half's zones — `opponent/Pile.svelte`,
`Bench.svelte`, `Active.svelte` — because those are the drop targets that belong to the
cards' owner.

**The window gets out of the pointer's way while a drag is in flight**, and that is not a
detail: the two windows float over the middle of the board and are rendered *inside* it
(`Board.svelte` has them as children of `.gameboard`, beside the zones they cover), so a
drag from a window down to the other player's Bench has the pointer over the window the
whole way and `document.elementFromPoint` answers with the window's own grid. The zone
never sees a `pointerenter`, never highlights, and never receives the `pointerup`, so the
drop lands on nothing at all. `Popup` therefore takes `pointer-events: none` for as long
as `$dragging` is true; the drag started from the panel, so nothing the panel was going to
do with a click is lost, and the class is gone the moment the drag ends.

One thing to know before changing the drag: **it carries the whole selection**, exactly as
a menu entry does. A player who has picked up three cards and drags one of them sends all
three. That is deliberate — it is the same answer the menu gives — but it is also why
`tools/reveal-check.mjs` drags the card that is left *after* its two-card menu move rather
than one of the two that are still selected.

### Every entry is instant, including the ones that put a card into play

An action on the other player's card is applied on the acting board's mirror at once
(`optimisticMove`), so the card does not sit still for the relay's round trip. The zones
that are *piles* — Hand, Discard, Lost Zone, Prizes, Table, Stadium, the deck — are the
easy half: the card comes out of the mirror's pile and goes into another.

**Bench and Active are the hard half**, because a Pokemon in play is a *slot* rather than
a pile entry, and the slot is created by the owner's own event carrying an id this board
cannot know in advance. The first version of the optimistic move left those two to the
round trip for exactly that reason, and the result was a menu where *To Discard* was
instant and *To Bench*, one line below it, took two seconds. So the acting board now
makes the same move with a slot id of its own, and the seam that opens is closed on the
other side: the owner's `cardsBenched` / `cardPromoted` handler takes the mirror's copy of
the card out of play before it adds the owner's slot, so the board never draws two Pokemon
holding one card. The owner's events stay the authority for what is on the board; the
optimistic slot is a stand-in that the owner's own answer replaces.

*Attach* is the one entry still left to the round trip, and it is the one that has to be:
the card goes *under* a Pokemon of theirs whose attachments are the owner's to order, and
"put this under your Active" has no shape on this side that the owner's `cardsAttached`
would confirm rather than duplicate. The card still leaves the pile it was in at once, so
the window does not go on offering a card that has been sent somewhere.

## Why an action is a request, and not a move

A board is authoritative for its own half: a player moves their own cards and tells
the room, and the other client's mirror follows the event. A card of the opponent's
is the one thing that breaks that rule, because the player acting on it does not own
the pile it is in. So the two halves are split deliberately
([src/lib/stores/oppAction.js](../src/lib/stores/oppAction.js)):

```
   the acting player's board            the owner's board
   ────────────────────────            ─────────────────
   click an entry
        │
        │  oppCardAction { card, from, action }        ── relay ──▶   the card is
        │                                                             looked for
   the card is taken out of its pile                                  in `from`
   in the mirror (so it reads as                                             │
   done at once)                                                             ▼
        │                                                          the owner's own
        │                                                          move runs on the
        │                                                          owner's board
        │                                                                 │
        ▼                          cardsMoved / cardsBenched /             │
   the card lands where it          cardsAttached / …                      │
   went, through the mirror   ◀── relay ───────────────────────────────────┘
```

Step 2 is the point: the owner performs the move with **the board's own functions** —
`moveSelection`, `toBench`, `toActive`, `toStadium` — with the board's one selection
pointed at the one card. So the events, the log line, the shuffle-after-a-search
rule and what the acting player's mirror does with them are *the same* as if the
owner had made the move, because it is the same code.

The alternative — the acting player mutating its mirror and telling the owner to
catch up — is the shape that rots: a mirror is a copy, and a copy that is
authoritative for one gesture is a second source of truth for the board. It would
need an event per zone, a rule for the card having gone by the time the owner looks,
and a way to tell "my mirror is behind" from "my mirror is wrong".

**The one local mutation is a removal.** The acting player takes the card out of the
pile it is in so the action reads as done immediately rather than as a card that sits
there for a round trip; the owner's events then put it where it went. It is guarded
by `takeFrom`, because `pile.remove` is `splice(indexOf(card), 1)` and `indexOf` on a
card that is not there is `-1` — which removes the *last* card instead
([gotchas.md](gotchas.md), and the note over `slots().remove` in
`src/lib/stores/custom/cards.js`).

If the owner never answers — they closed the tab between the request and its arrival
— the card is missing from the acting board's view until the next full board state.
That is what any lost event is; nothing here invents a reconciliation for it.

## What travels, and what does not

`cardsRevealed` carries **ids and a pile name** — never the card objects. Both
clients already hold the cards (the far half is a mirror, and a mirror is handed
every card its owner's board holds), so an id is enough, and a payload of full cards
would be a second copy of something the wire already carries.

- `cardsRevealed { owner, pileName, cards }` — the batch, stated rather than
  announced, so one handler serves the revealer, the opponent and a spectator.
  `owner` is the **sender's** word for the half.
- `backToDeck { owner }` — the shuffle that ends such a window. It carries a *half*
  rather than a list, because a shuffle is the deck's state and no client can mirror
  the order of a deck it cannot read.
- `oppCardAction { card, from, action, slotId }` — one player asking the owner of a
  card to move it.
- **A Look has no event at all.** It shares nothing, which is not a convention: the
  three names above are the allow-list in
  [src/routes/api/relay/events/+server.js](../src/routes/api/relay/events/+server.js),
  and what is not in it cannot be relayed.

A Look's only visible effect on the other player is the shuffle, if the looking
player ends it that way — which is what a card that says "look at the top X, then
shuffle that deck" looks like from their side of the table too.

## The two names for a half, and the one place they are flipped

The `owner` field is written by the player who acted, so their `mine` is the other
board's `theirs`. Everywhere else the batch's word is the **reader's**: `mine` is
this board's own deck, and the two windows print their heading straight off it
("Your deck" / "Your opponent's deck").

The flip happens in exactly one function (`localOwner`), on the way in. Getting it
wrong is quiet in the worst way: the batch would be gathered off the wrong deck,
none of the ids would be found in it, and the window would never open on the other
player's screen — which reads as the event not being relayed at all. It is the
newest member of the family [terminology.md](terminology.md) is about, and it is
worth knowing that it exists before adding a fourth thing that names a half.

## Where the entries are offered

| Menu | Entry | Does |
| --- | --- | --- |
| the player's own deck | *Reveal Top X* | `revealTop(deck, x)` → `owner: 'mine'` |
| the opponent's deck | *Reveal Top X* | `revealTop(deck, x)` → `owner: 'theirs'` |
| the opponent's deck | *View Top X* | `lookTop(x)` — local only |
| the opponent's deck | *Discard Top Card* | `discardTopOfTheirDeck(1)` |
| the opponent's deck | *Discard Top X* | `discardTopOfTheirDeck(x)` |
| the player's own deck | *Discard Top Card* | the top card, to the discard |
| the player's own deck | *Discard Top X* | that many, to the discard |

**The Look entry is called *View Top X*, not *Look at Top X*.** It was renamed so that the
two decks' menus read the same way: *View Top X* is what the top of a deck is called on this
board, and the player's own deck already has one. The two do different things — the player's
own asks which of the top X to *take*, and the opponent's just shows them — and that is
intended rather than a fault to reconcile: one is a search in a deck you can read, the other
is a look at a deck you cannot. The name is the same because the *words* are the same.

**Discarding needs no window and no drag.** *Discard Top Card* and *Discard Top X* are one
menu entry each: the player picks it, answers how many for the X one, and the cards go from
the top of the deck straight to the discard. Nothing is revealed by either — a discard is a
face-up pile, so the *owner* sees what they lost, which is what a discard is, and the player
who asked sees the deck get shorter.

Both discards are **requests**, and they are the one pair here that names no cards. The top
of a deck this player cannot read is not a card this board can name, so what travels is a
**count** and the owner reads its own deck (`discardTopOfTheirDeck` → `discardOwnTop`). It is
also the one action in that module that moves nothing on the acting board: the owner's events
and an optimistic move would be removals from the same pile, and the mirror is not
authoritative for what is on top of it, so a stale mirror would leave the two boards
permanently short of each other. The deck gets shorter when the owner's own event says so.

The player's own two entries are local moves, because the deck is theirs: `moveTop(discard)`
and `moveTop(discard, x)` in `board/Deck.svelte`, which is the same function the *Lost Zone
Top Card* and *Prize Top Card* entries use.

**All of these refuse solo and a spectator**, and the rule is one function (`canReveal`): a
Reveal is a shared act, so it belongs to a room with two players in it. Solo has
nobody to reveal to — both halves are one person, and that half's deck is already
readable there — and a spectator does not own a board to reveal from, so
`opponent/Deck.svelte` does not even hand one a menu. The entries are rendered
*disabled* rather than removed wherever they do not apply, so the menu does not
change shape between the two modes.

There is no *View Top X* on the player's own deck beyond the search it already has, and no
*Reveal* on a hand or a prize pile: a Look is what you do to a deck you cannot read, and a
Reveal is what you do to the top of one. The two share `topCount`, so "the top X" means the
same thing in both — X, or the whole deck when X is larger.

## The windows

`dialogs/Reveal.svelte` and `dialogs/Look.svelte` are twins and deliberately not
one component. They differ in three ways that are rules rather than styles:

- **the audience** — a Reveal is drawn on both boards from each client's own copy of
  the batch; a Look is drawn on one board from local state
- **the cards** — a Reveal's are drawn by `board/Card.svelte`, because a Reveal may
  be about the player's *own* deck and those cards are the player's; a Look's are
  drawn by `opponent/Card.svelte`, because they are always the other player's
- **the ending** — Close & Shuffle shuffles the deck the batch names, which for a
  Look is the other player's

Both windows carry **Close & Shuffle and never a Close beside it**, they are the same fixed-width grid (one full row of
136px cards) so a reveal of two opens the same window a reveal of ten does, and **the shuffle
belongs to the pair of them**: one reveal is one act with one deck and one ending, so once either
player has shuffled, the other player's window — which is still open, and still showing the cards —
loses the shuffle and keeps only Close. The same `shuffled` flag rides the `backToDeck` event, so
which button each player has never depends on which of them pressed it.

A *Close* beside *Close & Shuffle* was the first shape both windows had, and it was wrong for the same
reason in each: it offers a way to put the deck back exactly as it was found, which is the one ending a
reveal is not. A reveal is taken *because* the top of the deck is about to be read, so the order it was
read in is the thing that should not survive it; a Look ends with a shuffle because the deck belongs to
somebody else. So the ending is one button that changes rather than two that sit together — **Close &
Shuffle while the shuffle is owed, Close after it has happened** — and Escape or a click outside still
closes either window without shuffling, which is how every panel in the app closes.

A **frozen batch** is what makes that possible, and it is also what keeps the other player's window
alive at all: a window draws the batch's cards *that are still in the deck*, and a shuffle leaves
none of them there — so without freezing, the cards would vanish, the window would close itself, and
the button that would have closed it would go with it. Freezing is an explicit act rather than
something the view works out for itself, because "a card that was moved" and "a deck that was
shuffled" are different answers to what is on show.

Until it is frozen, a batch is a **live view of the deck it was taken from**, not a copy: the window
shows the batch's cards that are *still in that deck*, and a card that has been moved goes from the
window and stops answering clicks. A copy of the list taken at reveal time would keep offering a
card that has already been sent somewhere, and the click would do nothing at all, silently.

That view is a **store of its own** (`revealView` / `lookView`), refreshed by a
subscription to the deck, and it has to be: the card is moved on the *owner's* board,
by the board's own code, and a player's own events are never handed back to them — so
nothing the window subscribes to would ever change, and on that one board the window
would go on drawing a card that is already in the discard. Svelte cannot see a `get()`
inside a template, and a `$:` statement cannot see a store that a plain function call
reads; both of those cost this feature an afternoon ([gotchas.md](gotchas.md)).

Neither window is a pile's view. There are no Natural/Sorted tabs (there is one
order — the order the deck is read in, top card first, the order the cards were
revealed in), and no four move buttons: those are where a *search* takes a card out
of a deck to, and a reveal is not a search. What a card in one of these windows
answers to is its own right-click menu, which is the permission above.

## What the log says

| Gesture | Line |
| --- | --- |
| the player reveals their own deck | `Revealed the top 3 cards of their deck` |
| the player reveals the opponent's | `Revealed the top 3 cards of the opponent's deck` |
| the player looks at the opponent's | `Looked at the top 3 cards of the opponent's deck` |
| Close & Shuffle | `Shuffled Deck` |
| an entry taken on a revealed card | the move's own line, written by the owner |

A Look is written even though the opponent cannot see the cards, for the same reason
*Viewed deck* is (`logDeckView` in [logger.js](../src/lib/stores/logger.js)): the
line names nothing, and it is what the opponent is entitled to know happened. A
Reveal is written because it is a public act.

The line about a card acted on is the **owner's own move**, so it reads exactly as
it would if they had moved the card themselves — which is the point of the design
above.

## Checking it

`node tools/render-check.mjs` holds the half of this that needs no browser: the
permission rule (a card is actionable while it is in a batch and not otherwise), the
batch's shape (a live view of a deck, and not one of the board's own piles), both
windows rendering with their cards and their two buttons, and the wiring that offers
the entries and picks the right menu for a card of the far half's.

What it cannot see is the two clicks that make the feature real — a card's ring
pulsing, a menu entry moving a card on *the other* board — and that is the same line
[diagnostics.md](diagnostics.md) draws for every other browser check.
