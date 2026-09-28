# The board

One grid, two halves. The bottom half is always the near side — a player's own
board; the top half is the other side of the table, either the opponent's mirror or,
for a spectator, the second player's. `src/lib/play/Board.svelte` owns the grid and
that assignment; the zones themselves are components under `src/lib/play/board/`
(drawn for the player sitting at the bottom) and `src/lib/play/opponent/` (the same
zones drawn for a half that is rotated, so their cards face the player on that side).

## The zones

A zone is a place a card can be dropped on and clicked in. It is a cell of the
board's grid — and it is not the same thing as the name written inside it (see
[Zone borders and names](#zone-borders-and-names)), nor as what it holds: the deck, hand, prizes, discard, lost zone, stadium
and table are piles, while the active spot and the bench are *slots*. A slot holds
up to three lists (Pokémon, energy, trainer) plus the state that belongs to them —
damage, status, ability used.

| Zone | Grid area | Near half | Far half | Board field |
| --- | --- | --- | --- | --- |
| Hand | `hand` / `hand2` | `board/Hand.svelte` | `opponent/Hand.svelte` | `hand` |
| Prizes | `prizes` / `prizes2` | `board/Prizes.svelte` | `opponent/Prizes.svelte` | `prizes` |
| Deck | `deck` / `deck2` | `board/Deck.svelte` | `opponent/Deck.svelte` | `deck` |
| Discard | `discard` / `discard2` | `board/Discard.svelte` | `opponent/Discard.svelte` | `discard` |
| Lost Zone | `lz` / `lz2` | `board/LostZone.svelte` | `opponent/LostZone.svelte` | `lz` |
| Bench | `bench` / `bench2` | `board/Bench.svelte` | `opponent/Bench.svelte` | `bench` (slots) |
| Active | `active` (`active1`, `active2`) | `board/Active.svelte` | `opponent/Active.svelte` | `active` (one slot) |
| Table | `play` / `play2` | `board/Temp.svelte` | `opponent/Temp.svelte` | `table` |
| Stadium | `stadium` / `stadium2` | `board/Stadium.svelte` | `opponent/Stadium.svelte` | `stadium` (up to two cards) |
| Pokemon Power | `power` / `power2` | `PowerZone.svelte` | `PowerZone.svelte` | `powerMarker` |

The board fields are the ones `src/lib/stores/custom/board.js` creates and
`player.js` re-exports; `opponent.js` builds the same shape as a mirror. The `2`
suffix on the far half's class names is the whole of the difference between the two
halves' markup, and `play2` and `stadium2` deliberately resolve to the *same* grid
area as `play` and `stadium`.

A zone is named in four vocabularies — the store's field, the grid area, the wire
name an event carries, and the name a log line uses — and they are not the same
set. The store name and the wire name are the *same string*, so a rename that
looks like tidying a field is a protocol change; the log's name for the Pokémon
in play is `play`, which is not a store, while `play` is also the *grid area* of
the table's cell, whose store is `table`. Renaming those keys to match is how a
log line starts naming cards it is meant to count. **[terminology.md](terminology.md)
is the table of all four**, and it is worth reading before touching `logger.js`
or anything that names a zone.

**Pokemon Power** holds the player's VSTAR / GX marker, the tokens a deck's own power
is tracked with — and **no Pokémon**. It is deliberately not a card zone: nothing is
played into it and no card is ever drawn there, so `PowerZone.svelte` is a single
component rather than the board/opponent pair every other zone needs. It shows no
cards and reads no board store, so what it shows is handed to it. It is also why the
marker is no longer a token floating in the free space past the opponent's deck: a
token belongs to a zone, and this is the zone for it. The marks are sized by the band
they are in, so a short window takes them with it instead of letting them spill over
the Stadium. **The zone is not on every board**: a format with no Rule Box powers to
mark has no Power zone either, and the Stadium takes the cell — see
[The format, and the zones it can take away](#the-format-and-the-zones-it-can-take-away).

Four cells are not one zone to one component:

- **The table, and the Stadium's cell, are shared.** Both players play into the same
  cell, so each half's component is placed in it and the near one is on top (`.play`
  at `z-index: 11`, `.stadium` at `10`). The near table stands aside while it is empty
  and nothing is being dragged (`pointer-events: none` on `.play.empty`), which is what
  lets a gesture reach the far half's table lying underneath — and that is for a room
  as much as for solo, because a card of theirs on the table is read there: a double
  click on it opens its details and a right click pings it. A drag turns the near table
  back on (that is what the `$dragging` clause is for), so a card being played still
  lands on the table being played. The near
  stadium passes clicks through the same way until it has a card in play, and it stays
  the player's own whichever way the board is flipped. Both hold two cards per player
  (see [The Stadium holds two cards](#the-stadium-holds-two-cards-and-a-play-clears-the-other-players) below).
  **A shared zone is still one zone per player**: the cards in it are their owner's,
  and only their owner's are selectable — a card on the other half's table or in the
  other half's Stadium cannot be picked up, online or in solo
  ([selection.md](selection.md#what-a-selection-is)). What the near half stands aside
  for is the *gesture*, not the pile: it is their cards that are under the pointer, so
  nothing of the player's own is reachable there while their own table is empty.
- **The Stadium's cell is three bands.** `.stadium-area` is itself a grid of
  `1fr 2fr 1fr`: `power2` in the top quarter, the two stadiums sharing the middle
  half, `power` in the bottom quarter. So each player's Pokemon Power zone is the
  quarter of the cell between their own bench and the Stadium, the two Power zones
  take half the cell between them, and each name is centred in its own band rather
  than in the cell.
- **The active spot holds two zones.** `.active` is itself a two-row grid: `active2`
  in row 1 for the top half and `active1` in row 2 for the bottom, with the pokeball
  watermark (`:before`) belonging to the cell rather than to either zone.
- **The veil is not a zone at all.** It is the shading drawn while Hide Pokémon is
  on (`pokemonHidden`), placed by named lines rather than declared as an area, so it
  is deliberately outside both the zone outlines and the zone names. `pokemonHidden`
  is one of three per-zone visibility flags — with `handRevealed` and `prizesFlipped`
  — and each one both hides its zone's cards and decides whether a move involving
  them is logged by name or by count (see [gotchas.md](gotchas.md)); it is also the
  flag behind the log's `play` key, which is the bench and the active spot together
  rather than any grid area.

The grid is seven columns by six rows, with every track floored at `minmax(0, …)`:
plain `fr` has an automatic minimum, so a zone with more in it — a full hand, a pile
of prizes — grew its row and squeezed the others, which is how two views ended up
disagreeing about where a zone was. Zones are placed by `grid-template-areas`, so the
whole layout is one declaration and a zone's position is its area name; `grep` for
that name to find the cell, and the table above to find the component.

`pickup` is the one pile with no zone on the board: cards wait there while a
multi-card selection is being resolved (the *in hand (moving)* line in the
diagnostics panel), so it is state rather than board furniture.

A pile draws its own count badge in the corner, except the table's, which asks for
none: the stack there is read by looking at it, and a number on top of it was noise.
Deck, hand, prizes, discard and lost zone carry one; the stadium, the active spot and
the bench never did — the first because two cards are read by looking at them, the
other two because they are slots.

**The table is a stack of cards rather than a pile that draws one**, and every card in
it is picked up on its own — a click selects that card, Ctrl/Cmd adds it to the
selection, right-clicking one opens that card's menu and dragging one carries it, the
way a card attached under a Pokémon behaves. *View All* is the stack's own gesture
(double click, the `W` key, and the zone's menu on the part of the stack no card
covers), and the whole stack is never selected at once — not by a click, and not by
`Ctrl+A` ([selection.md](selection.md#the-tables-stack-where-a-card-is-picked-up-on-its-own)).
The `X` key still takes the whole table to hand with nothing selected, which is the
move that key is for; it leaves nothing selected behind it.

**A double click shows a card, and on the far half's table that is the card rather than
the stack.** The two tables share a cell, so both are drawn as the same cascade — but a
card of the other player's is not this player's to pick up or to move, and the near half's
own double click is *View All*, so the far half's cards carry the gesture themselves and
stop it there. It is the same rule a card of theirs gets in every other zone: a card drawn
face up may be read where it lies, and one drawn face down — their hand, their unflipped
prizes — is refused ([board/Card.svelte and opponent/Card.svelte](#the-zones), one rule
each side of the table). Reaching it at all depends on the near table standing aside, which
[the shared cells](#the-zones) above are about: the handler and the hit test are two
different things, and the card has to be the element the pointer actually meets.

**The stack is a cascade, and the cell holds it by scrolling it.** A card is laid over the
one above at a step down that is a share of the card (35/105), and every second card takes one
step across (20/105) — the zig-zag the stack has always been drawn with, both steps shares so
the cascade keeps its shape at any size. A card on the table is **the card a pile draws** — one
board row's height at a card's shape, or the cell's width less the bar the stack reserves and
the share the step across costs it, whichever is smaller (`--table-card-width`, one rule in
`global.css` for both halves, because the two tables are one stack drawn in a cell they share).
The cell is two board rows and a pile's zone is one, which is why the size is that cell's
*height halved*: a card on the table and the cardback in the deck's zone are the same card. A
card is not also fitted to the cell's whole height — the cell is about two cards tall at
1277x821 and a game can put a dozen on the table — so a stack taller than the cell is scrolled
by it (`Vertical.svelte`), with the bar drawn only while there is something to scroll and
*drawn* while there is, rather than handed to the platform as an overlay bar that hides until
the pointer arrives. What that replaced was worse than untidy: the cascade was drawn straight
through the zone's border and over the rows around it, and the cards were a fixed 105px of
their own, so at a small window the stack was wider than the cell it is in and reached over
its neighbours. The stack is centred in the cell while it fits — and *gives that up* when it
does not (`safe center`), because a centred box that overflows a scroll container has its first
cards above the start edge, where no wheel and no bar reaches them.

**Reading a pile** — *View All* on a deck, discard or lost zone — is a grid of every card
in it, which is taller than any window: fifty cards at 136px each is four rows. The panel
is therefore the window's height at most and its *body* scrolls (`Popup.svelte`), with the
panel's own actions at its foot; a panel that simply runs off the bottom of the window
cannot be scrolled at all, because a fixed box that is off the bottom is not part of
anything's scrollable area — the wheel over it does nothing, and there is no bar to drag.
The panel takes its share of the window the same way the board does (see [The zones](#the-zones)), and
the same is true of the multi-card selection dialog, which is the same grid.

**Reveal, Look and Reveal Hand** are the other three ways cards come out of a deck or a hand,
and they are about *who is shown them* rather than about moving them: a **Reveal** shows the top
X cards to both players in a window on the revealer's board, a **Look** shows the top X of the
opponent's deck to the one player who asked (and reports them to the room's watchers, in the log
rather than in a window), and a **Reveal Hand** shows the whole of the opponent's hand to the
player who asked (and to the watchers, in a window of its own). Reveal and
Look are entries on a deck's own menu — *Reveal Top X* on either deck, *View Top X* on the
opponent's — and Reveal Hand is the **opponent's hand** menu's entry; a player's own hand menu
has none, so a hand is hidden unless the other player reveals it. None of them ever moves a
card: they are views of the top of a deck or of a hand, and the pile is exactly where it was
until *Close & Shuffle* says otherwise.

A card any of the three is showing may be acted on **as the other player's**, which is
the "allowed to take action on this opponent card" property: it can be clicked and
right-clicked like a card of the player's own, and its menu's entries land on the
owner's half. It is the card *as the window carries it* and nothing else — a card of the
opponent's lying on the board, in a hand zone or under a window, is never actionable. That is one
whole subject of its own — the property, the split between
the player who asks and the board that owns the card, and the two names a half is
called by — and it is written up in **[reveal.md](reveal.md)**. What belongs here is
where the entries are: all three are refused outside a room, and a spectator is not given
the menu at all (see [Spectating](#spectating)).

**Putting cards back in a chosen order** — *Search & Order Deck* on the deck — is the
other half of a search: *Ciphermaniac's Codebreaking* is "search your deck for 2 cards,
shuffle your deck, then put those cards on top of it in any order", and the order is the
whole of what the player is deciding, because it is what they draw next.

The dialog is the deck, read top card first, and clicking a card marks it: **the click order
is the placement order, and the badge says where each card sits — 1 is the card drawn
first.** The strip over the grid names that order back as `1 → 2 → 3`, so the sequence reads
the way a sequence does, and clicking a marked card again takes it out. The whole of the
editing is one gesture, and no drag is involved: a grid with sixty cards in it scrolls, and
nothing that has to be scrolled to can be dragged to.

Two ends of one deck, and the dialog shows one of them: the grid is **top card first** — the
same way the inspection dialog reads a pile — while `placeOrdered` puts a top placement at
the *end* of the array **reversed**, because the card drawn next is the array's last. So the
**first cell of the grid is the card that leaves next**, and card 1 is drawn first. The badge
is what makes that readable: the grid is where the cards are, the strip is the sequence
being built, and the number on a card is its place in both.

*Order Top X* is the same dialog over the top X cards of the deck instead of all of them,
for reordering what is already at the top — which is what a search of 2 cards out of 60 is
really doing, putting them back where they came from in a chosen order. It is opened from
the deck's own menu, asks how many cards with the browser's prompt, **shuffles nothing**
and offers no bottom: those cards are already at the top, and shuffling the rest would
throw away an order an earlier search put there. Its action is *Arrange the Top X in This
Order* rather than a placement, and the cards under the block are left exactly as they
were — which is the one thing that can tell "rearranged" from "shuffled", so it is what the
browser check asserts.

What is placed, in either mode, is **the cards that were marked, in the order they were
marked in, and only those** — so an *Order Top X* reads as *these first, and the rest of the
block keeps the order it had*. Marking one card of the top five brings it to the top and
moves nothing else; marking none of them is not an action, since there is no order to write.
That is the whole of what the dialog can say: it fixes *which* cards are in the block off
the deck itself and lets the player decide their sequence, rather than asking for an
arrangement of cards they never named.

One of the two actions of the full dialog places the marked cards on the **top** of the deck
and the other on its **bottom**, in the same order; *Shuffle the rest of the deck first* is
the shuffle the search asks for, and it is checked by default. The marked cards never leave
the deck while the dialog is open — the search is a look and the placement is one move — so
closing the dialog needs no cleanup at all, and a shuffle cannot carry a card that is being
held somewhere else.

**Opening either dialog writes `Viewed deck` to the log**, the same line View All writes and
for the same reason: it is a look through the one pile the opponent cannot see, and that is
what they are entitled to know happened. A player who opens the dialog and closes it again
has left one `Viewed deck` behind and nothing else.

Nothing else in the log names the cards. A search is private however it ends, and this one
ends with a face-down deck: after the look, the placement says `Put 2 cards on top of Deck
in order`, which says what happened without saying what the player went and got
(`logPlacement`, and the same rule `logPickup` follows). An *Order Top X* writes the
placement line and no `Searched deck`, because it is a rearrangement rather than a search.

Placements travel as the `cardsMoved` event with two optional fields — `position`
(`top`/`bottom`) and `ordered` — rather than as an event of their own, because a placement
*is* a move of cards from the deck to the deck. The opponent's mirror reads them: the
per-card loop it used before pushed the top card in first and left it at the wrong end of
the array, and no list of ids can carry an order unless the whole list is put back at once.

## The format, and the zones it can take away

A room is played in one of three **game formats** — **Standard**, **Gym Leader
Challenge** or **Expanded** — chosen by whoever makes the room, in the prompt that also
asks for their name. The format belongs to the room: the joiner, and anyone watching,
are told which one it is rather than asked, so the two halves of the table can never
disagree about what is on the board. `$lib/util/format.js` is the whole of what a
format means here.

| Format | Lost Zone | Pokemon Power zone |
| --- | --- | --- |
| Standard | no | no |
| Gym Leader Challenge | yes | no |
| Expanded | yes | yes |

- **The Lost Zone is missing from Standard alone.** The zone came in with the Sword &
  Shield sets and rotated out of Standard with them, so a Standard board has neither a
  zone to send a card to nor one to draw.
- **The Pokemon Power zone — and the VSTAR / GX markers it holds — is there only in
  Expanded.** Expanded is the one card pool carrying both Rule Box powers: GX cards
  rotated out of Standard, and Gym Leader Challenge allows no Pokemon with a Rule Box at
  all.

That Gym Leader Challenge has one and not the other is the reason the two are two
questions rather than one flag, and why `format.js` answers them with a function each
(`showsLostZone`, `showsPowerZone`) instead of a single "is this Expanded".

**A zone a format does not have is not drawn at all**, on either half and for a
spectator watching both. `$lib/stores/zones.js` derives that from the room's format —
and from solo, which has no room and keeps every zone — and `Board.svelte` reads it.
Two details are what make the difference between hidden and broken:

- **The grid keeps its tracks.** A missing Lost Zone leaves its cell empty, which is
  what the board's own corners already do, so the zones beside it neither move nor
  resize.
- **The Stadium takes its whole cell.** With the Power bands gone `.stadium-area` is one
  row rather than three, and the Stadium's own name moves to that row with it. Left as
  three rows, the board would keep a quarter of itself empty above and below the
  Stadium, which reads as a board that failed to load rather than one played in a
  format.

**A zone's name goes with the zone**, and so do the menu entries that feed it: *To Lost
Zone*, the deck's *Lost Zone Top Card* and the `L` shortcut are offered only where the
board has a Lost Zone. A destination the board does not draw is a card sent somewhere
nobody can see it or get it back, which is worse than the entry being absent.

Solo is the exception to all of it: no room, so no format, so every zone — and its
Settings keeps the marker control a room does not have (see
[mechanics.md](mechanics.md#the-vstar-and-gx-markers)).

## Selecting a card, and what a selection looks like

A click on a card selects it, Ctrl/Cmd-click adds to the selection rather than replacing it,
and Escape or a click on the background clears it (`selectCard` and `resetSelection` in
`player.js`). **Adding spans the zones of the player's own half**: a card in the hand, a
card on the table and a card in the Stadium can be picked up together, and a move then
takes each of them out of the pile that holds it. The selection does not span the two
*halves*, even in solo where both are played by the same person — a card of the other
half's starts a new selection, because every key that moves one asks which half it was
made on (see [Keyboard shortcuts](#keyboard-shortcuts)). The board has **one** selection,
and in solo both halves share it.

**A selected card is drawn with a 2px ring in `--selection-color`, and that ring is the whole
of the feedback a click gets**: a card that does not glow is a card the player will click
again. What each kind of selection is drawn with, the three rules a zone has to follow to
draw it — the class goes on the wrapper rather than on the `img`, the ring must not cost any
room, and the ring must not be buried by its neighbours — and why the prizes are the one zone
that draws it as an `outline` with the box lifted, are all in **[selection.md](selection.md)**.

## The Stadium holds two cards, and a play clears the other player's

The Stadium is the one zone both players play into, and each of them may place **two
cards** in it (`STADIUM_LIMIT`, in `src/lib/stores/custom/board.js`). Both are drawn
side by side, each taking half of what one card used to, so the pair fits the band the
single card did.

- **A card played while that player is already at two is the stadium being replaced.**
  The whole of that player's own is discarded — both cards, not the oldest of them —
  and the card just played is the only one they have left in play. Below two the card
  simply joins what is there, which is the only way the pair is ever reached. Nothing
  is refused: a drop that did nothing would be worse than a rule with a name.
- **A card one player plays clears the other player's out of it**, all of them
  whatever they held — one or two — into that player's discard. So the two players'
  cards are only ever in it together for the moment a play takes to cross the wire.

That second rule is the one with a shape worth knowing, because the client that
answers it is not the client that plays the card. Playing a card shares
`stadiumPlayed`; the *other* client receives it, puts the card in its mirror of that
player's Stadium, and then clears **its own** player's cards out — this board is the
one that knows what its own player had in play. A spectator's mirrors follow the same
event, and the cleared player's own `cardsMoved` is what moves those cards in a
spectator's other mirror. In solo there is no relay and no other client, so the answer
is made locally: `soloCardToStadium` clears the near half's cards itself, and the
mirror image of it — a card played into the *near* half's Stadium clearing the far
half's — is registered with `player.js` as `onStadiumPlay`. It is registered rather
than imported because the board that answers imports `player.js`, and a second
direction of import is the cycle that took the app down once already (see the note in
`connection.js`).

## Pinging a card

**Right-clicking a card of the other player's offers *Ping Card***, which points at it: a line in
the game log, and a two-second glow on the card itself on both players' boards. It is the entry
that used to be *Declare Target* on a Pokemon in play, and it is the only thing on the board that
names a card without changing anything — nothing is marked, nothing is moved, and nobody answers
it (`stores/ping.js`).

- **Where it is offered.** Every zone of theirs a card is read in: the hand, the prizes, the
  Active spot and the Bench (a Pokemon's own menu, `dialogs/OppSlotMenu.svelte`), their Stadium,
  and the cards they played to the table. **A card attached under one of their Pokemon is pinged
  as its own card** — the energy and the tools are cards of theirs lying face up, and pointing at
  a tool is not the same thing as pointing at the Pokemon holding it. **The three zones that are a
  pile are not among them** — the deck, the discard and the lost zone — because each of those is
  one card on the screen whatever is in it, so a ping there would point at a position nobody can
  read. The pile is what answers that (`pingable`, marked in `opponent.js`), because the component
  that draws a card of theirs also draws every card of those three piles when one is opened as a
  view.
- **What the log says.** `Ping: <card>` for a card this player can read, and `Ping: Hidden card`
  for one they cannot — the opponent's hand, a face-down prize, a Pokemon whose owner has hidden
  their board. The name is the *pinger's* knowledge rather than the card's, and that is the whole
  of the rule: a mirror is handed the names of the opponent's hidden cards as part of the board
  state, so printing one would name a card this player was never shown, in a log the whole table
  reads.
- **The glow is the other player's.** `cardPinged` carries the card's id and is the room's, so the
  pinger's board lights the card in its mirror and the owner's board lights it in their own zones:
  that is what makes a ping reach the person it is for. `.pinged` (`global.css`) is the one rule
  all six components that draw a card wear — an amber ring that **glows on and off** twice over
  the two seconds, rather than the blue a selection wears, because a ping is something happening
  and not a state the card is in.
- **The pinged card is raised over the cards around it.** A card is rarely alone — one flex item
  in a hand, one of a table's cascade, one of the fan under a Pokemon — and a halo painted in the
  card's own place is half covered by whichever card is painted after it, which reads as a glow
  behind the cards rather than around the one that was pinged. So `.pinged` carries a `z-index`
  above every layer of the board and below the panels and the context menu, since a card rising
  over the menu it was opened from would hide the thing it is offering.
- **The glow lights one card, and the id alone does not say which.** Both boards number their
  cards `1..n` from their own decklist, so the same id names a card of the player's *and* a card
  of the opponent's, and a ping that carried only the id would light two cards on one screen. So
  the half travels with it, in the terms of the board holding it, and `pingedCard` is the one
  place that is asked. A spectator's board draws both halves with the far half's components, so a
  ping lights nothing there: the log line is the spectator's half of a ping, and the glow is the
  two players'.
- **A player's gesture, and a room's.** A spectator is refused and so is solo, at the store rather
  than at each menu entry; the entry is drawn *disabled* for a spectator, so no menu changes shape
  under them.

## Zone borders and names

**Settings → Board zones** (`zoneBorders`, persisted as `zone_borders`, off by
default) outlines every zone of both halves and — only while it is on — writes each
zone's name in the middle of it. The two are a pair: a line says where a zone begins
and ends, a word says which zone it is. It is a development and teaching aid as much
as a setting, and `node tools/browser-check.mjs --only panel` is what reads it.

The names are the game's words rather than the components' — the discard pile is a
*Discard*, the prize cards *Prizes*, the active spot an *Active*, and `Temp.svelte` is
the *Table* — which is why the list is written out in `Board.svelte` instead of being
derived from the files. A two-word name is broken over its words (`white-space:
pre-line`), so *Lost Zone* reads as a small centred block rather than one long line
across the zone.

Four things about them are deliberate, and each was a bug first:

- **A name is drawn under the cards, not over them.** The labels come first in the
  board, before the zones they name, so whatever a zone draws comes after them and a
  card in the middle of a zone covers its name. A caption belongs on the empty part
  of a zone, not read through the cards.
- **A name takes no pointer events and cannot be selected.** A zone is what the board
  reacts to; a label that swallowed a click would be a hole in the middle of every
  zone.
- **Half strength is the colour's alpha, not the element's `opacity`.** `opacity`
  gives the name a layer of its own, and it is then drawn over the cards in any zone
  whose own markup is not positioned — the stadium's is not.
- **A name is sized by its own words.** The rule that makes a zone's component fill
  its zone caught the first of the active area's two names and stretched it to the
  whole cell, which put its words at the top of the zone while its box still measured
  as the zone — so it read as centred and looked wrong.

The active area is the one cell holding a zone per player, so it carries the name
**Active** twice, each centred in its own row of that cell; the Stadium's cell carries
three, one per band, so **Pokemon Power** is written twice — once for each player's
zone — with the **Stadium** between them. Eighteen names for fourteen cells, for that
reason, is the number the browser check asserts.

**That eighteen is the Expanded count.** A format that takes a zone away takes its name
with it, so a Gym Leader Challenge board names sixteen and a Standard board fourteen —
and the Stadium's cell, down to one band, names one rather than three. The browser check
reads a board of each format and asserts the tally, because a name left behind in an
emptied cell looks like a zone that is still there.

## Flipping the board

The flip button sits beside the settings cog, and only a **spectator** or **solo**
gets it: a player in a room already sits on their own side, so there is nothing to
swap.

One control and one store — `spectatorFlipped` in `opponent.js` — with two meanings,
because the two modes have the same problem from opposite ends:

- **A spectator** swaps which player is on which half of its screen. A spectator
  keeps a mirror per player, and flipping re-points the two mirrors. It is a *local
  view change*: nothing is sent to the relay and neither player's own board moves.
- **In solo** both halves are the same person, so the flip swaps your own board with
  the other side's: your half moves to the top and the other side's comes down, where
  you can play it. `Board.svelte` states it as `soloSwapped = $solo &&
  $spectatorFlipped`, and it is the same button and the same store as a spectator's
  flip. The button's tooltip names which of the two it means.

What travels with a half when it flips is whatever belongs to the player shown on it:
for a spectator, the two nameplates (`topName` / `bottomName`, taken from the relay's
seats in join order) and each half's VSTAR/GX marker; for anyone, the hand's
*revealed* tint, which follows the hand that is at the bottom *now* (`soloSwapped ?
$oppHandRevealed : $handRevealed`) because a flipped solo board has the other side's
hand down there. A solo board has only one name to write — its own — because solo
never joins a room and so has no seats.

The two shared cells are the one thing a flip does not move. The table and the
stadium are a single cell each with the near copy on top, and the near copy stays the
player's own however the board is flipped; the other half's is the one behind it.
Handing the player's own table or stadium to the other side of the screen is the one
thing a flip must not do.

What does not travel is everything else. No card moves, no event is relayed and no
board state is touched: the turn, the clock, the decks and the piles are all where
they were. It is a view, not an action — which is why a spectator can flip a game it
cannot touch, and why the flip is safe to reach for mid-turn.

The half being flipped is also the one piece of rendering that turns:

- The top half is drawn rotated (`transform: scale(-1, -1)`) because it is the far
  side of the table, so its cards face the player sitting opposite. A spectator's and
  solo's top half uses the same layout, but the cards are turned back up again (the
  `upright` class), because both halves are read by the same pair of eyes.
- Anything that has to stay readable by whoever is looking at a rotated half — a
  pile's count, a damage counter, a status marker, the ability stripe — is rotated
  back in `Board.svelte`, the one place that knows the half is flipped. An element
  added to the far half that carries words needs putting on that list, and there is no
  error if it is forgotten: it simply arrives upside down.
- The hand row is never rotated, for a player or a spectator, because its pile menu
  renders inside it.
- Flipping is not remembered. `spectatorFlipped` is a plain writable rather than a
  `storable`, so a reload starts unflipped, and it is set back to false when a room is
  left and when solo starts or ends.

## Spectating

**Spectate Game** on the main menu joins a room without taking a seat. A spectator is
read-only, and the enforcement is not in the UI: every state change in the app funnels
through `share()`, which refuses to act while `spectating`, and the relay answers any
event but `chatMessage` from a spectator member with *"spectators cannot change the
game"*. So the board's menus and shortcuts cannot touch the game however they are
reached. Chat is the one thing a spectator may send, which is why it does not go
through `share()`.

On screen a spectator gets the whole board and none of the play:

- **Two mirrors, one per player**, created once at module level (`spectatorOpponents`
  in `opponent.js`) and seated from the relay's `seated` event. The normal single
  mirror is switched off while spectating rather than unmounted, because it would
  otherwise quietly collect both players' cards into one set of slots.
- **No game actions.** The Game Setup button, the turn row's ends and the action row
  are not rendered and the shortcuts are not bound, so End Turn and New Game are not
  one keystroke away for somebody who is only watching.
- **Both hands and both sets of prizes are face up** (`$spectating` reveals them
  outright), which is the deliberate difference from a player, who sees a hidden hand
  and hidden prizes.
- **The clock, without its controls**, no VSTAR/GX marker of its own, and no Import
  Deck window — a spectator has no deck to import.
- **A spectator is not a seat.** A spectator leaving never closes the room, and a
  spectator's presence going stale is only a count change (see [Leaving, and what
  closes a room](rooms.md#leaving-and-what-closes-a-room)).

## Keyboard shortcuts

Two document-level listeners, and both refuse while somebody is typing
(`$lib/util/typing.js`, which also keeps Enter and Space for a focused button). No
board shortcut uses the command modifier, on purpose: that combination belongs to the
browser and the clipboard, so `Ctrl+V` / `Cmd+V` pastes a room code or a message and
View All is `V` and only `V`.

The board's own shortcuts, from `Board.svelte`:

| Key | Does |
| --- | --- |
| `1`–`9` | draw that many cards |
| `Alt`+`1`–`9` | look at that many from the top of the deck (the deck menu's *View Top X*) |
| `D` `H` `L` `P` | the selection to discard / hand / lost zone / prizes |
| `B` `A` | the selected Pokémon to the bench / the active spot |
| `G` | the selection to the stadium, or what is in the stadium already |
| `S` | shuffle: the selection into the deck, or the deck itself |
| `T` `M` | the selection to the top / bottom of the deck |
| `Q` `E` | attach / evolve with the selected card |
| `U` | mark the selected Pokémon's ability used, or take that back |
| `Space` | the selected card's details, and again to put them away — a face-down prize is written to the log |
| `V` `W` | View All of the deck (written to the log) / of the table |
| `X` | the selection to the table; with nothing selected, the whole table back into the hand (a move, not a selection — see [selection.md](selection.md#select-all-and-the-one-zone-that-does-not-answer-it)) |
| `Esc` | clear the selection |

`Space` and `V` are the menu entries they stand for, key for key, and that includes
what those entries write in the log: the details of a **face-down prize** are recorded
as *Viewed prize card* (a prize already turned face up is readable across the table and
says nothing), and View All is recorded as *Viewed deck*, the one pile the opponent
cannot see. The keyboard reaching the same look by another route is not a reason for it
to go unrecorded. See [gotchas.md](gotchas.md) for what happened when `V` did.

**`Ctrl+A` is not in that table, and it is not a board shortcut**: it is a pile's own
gesture, listened for on the zone itself, and it fills the selection with the whole
pile. The piles answer it and the table does not, because the table's cards are picked
up one at a time ([selection.md](selection.md#select-all-and-the-one-zone-that-does-not-answer-it)).

The game actions, from `GameActions.svelte`, which a spectator does not get at all:
`Enter` ends the turn, `C` starts the next one, `N` starts a new game (after asking),
`F` flips a coin, `Z` shows or hides Pokémon. In a room the shortcuts are the *only*
way to reach three of those: the room's panel has one button — **Game Setup**, on a row
of its own above the turn and the full width of it — and nothing else. Flip Coin and
End Turn are off the screen rather than out of the app, and the same is true of Hide
Pokémon in both modes. See [Setup](mechanics.md#setup) for what Game Setup does and
does not write to the log.

In solo both halves are playable, so every key that moves a selection first asks which
board it is meant for (`farSelected()`): the same key moves the far half's own cards
into the far half's own zones, and never carries a card across the table into yours.

## What the browser remembers

Only two kinds of thing are persisted, both in `localStorage`, and nothing else
survives a reload:

- **The room and the seat** (`pvp_session`, written by `src/lib/relay/client.js`), so
  a reload lands back in the same game as the same member. Leaving a room, or finding
  it gone, forgets it.
- **The settings** (`auto_mulligan`, `zone_borders`, `player_name`), through
  `storable()` in `src/lib/stores/custom/storable.js`. `auto_mulligan` is the odd one:
  the setting is still there and still read, but it has no control in the menu any
  more, so its key is deleted on every page load rather than obeyed — a browser that
  had the checkbox ticked when it existed does not get to keep the behaviour
  ([mechanics.md](mechanics.md#mulligans)).

The board itself is persisted nowhere. In a room it is rebuilt by replaying the relay's
event log, which is why a stale `pvp_session` matters and a stale board does not. In
solo there is no relay and so no log: a reload returns to the main menu and the game
is gone. That also makes the settings a debug lever — a board that looks wrong because
of `zone_borders` is fixed by clearing that key, without touching the game. A
`scale` key left in `localStorage` by a version that had the card size slider is
ignored rather than obeyed, so it can be left where it is.
