# Reveal, Look and Reveal Hand

Three ways a player is shown cards out of somebody else's pile, and the three ways one player
may touch a pile that is not theirs. They are the same gesture with three different
audiences, and that is the whole of the difference between them:

| | Shown to | Window opens on | Ends with |
| --- | --- | --- | --- |
| **Reveal** | both players | the revealer's board | Close & Shuffle, then Close |
| **Look** | the player who looked | that player's board | Close & Shuffle |
| **Reveal Hand** | the player who asked | that player's board and a watcher's | Close |
| **Discard Top Card / X** | nobody — no window | — | the cards are in the discard |

Reveal and Look are entries on a deck's own right-click menu — *Reveal Top X* on either
deck, *View Top X* on the opponent's — and both are asked for with the browser's
`prompt`, the way every other "X" on this board is (*Draw X*, *View Top X*, *Order
Top X*). Reveal Hand is an entry on the **opponent's hand** menu and asks for nothing: the
hand is already a list of cards, so there is no X to ask for. Each opens a pile window: the
same panel a pile's view is, the same scroll container, the same foot of actions.

The discards are the third entry on the opponent's deck and the third and fourth on the
player's own, and they are the ones with no window at all: the cards move from the top of the
deck to the discard when the entry is taken, and that is the whole of the gesture (see
*Where the entries are offered*, below).

The cards never leave the pile during any of the three. A reveal is a *view of the top of a
deck*, a reveal hand a *view of a hand*, so nothing is moved, nothing is drawn, and closing
the window needs no cleanup at all — the deck is exactly where it was, in the same order,
until *Close & Shuffle* says otherwise.

## Reveal Hand, and why it stopped being a toggle

*Reveal Hand* used to be one line on the **player's own** hand menu, and it was a different
kind of thing wearing the same name: it flipped the standing flag `handRevealed` (one of the
three per-zone visibility flags, see [board.md](board.md)), and the opponent then read that
hand as faces rather than card backs, in place, until it was switched off again. There was no
window, no set of cards and no ending.

It is now a window, and it is this feature's third gesture rather than a flag:

| | Reveal Hand (now) | the toggle it replaced |
| --- | --- | --- |
| what it shows | every card in the opponent's hand | every card in your own hand |
| where it is drawn | a window, over the board | in place, in the zone |
| how it ends | Close | toggled off |
| reaches whom | the player who asked and the room's watchers, via `handRevealed` | the other player, via `handToggle` |
| may be acted on | yes — the batch is the permission | no |
| the hand zone | still card backs | faces, until it was switched off |

Two things about the change are worth stating, because both were asked for in as many words:

- **it is applied to the opponent's hand zone, and the player's own hand lost its entry.**
  A player no longer has a switch that shows their own hand: *my own hand should always be
  hidden unless the opponent uses "Reveal Hand" on my hand zone*.
- **it needs no permission from the hand's owner.** It is unilateral, and the log is the
  record: *when the player performs this action it should just happen and add to the game
  log*. So there is no request, no *Allow*, and no answer — see *Who gets a window*.

**And the hand zone stays drawn as card backs**, which was asked for after the first version of
the window: *when "Reveal Hand" is selected the cards in the hand zone should remain as Hidden
Cards*. So the gesture sets no per-zone flag at all — the window is the whole of what it shows,
on the board that asked and on the board that owns the hand alike. That is also the reading that
keeps it honest: the cards are the opponent's, the player is being *shown* them, and the zone they
came from goes on looking exactly as it did to both players. What the owner is told is the log
line, and nothing about their own screen changes.

That is a *reversal* of the first attempt, which set `handRevealed` — the flag the old toggle
used — and drew the hand face up behind the window as well as in it. The flag and `handToggle`
are both still there and still work (`opponent/Hand.svelte` reads the flag, `opponent.js` applies
the event); nothing writes them any more, because nothing on this board turns a hand face up.

## The permission: "allowed to take action on this opponent card"

A card a Reveal, a Look or a Reveal Hand is showing may be **acted on as the other
player's**. It can be left-clicked like a card of the player's own, and right-clicking it
gives this player's own card menu, minus one entry: *To Discard*, *To Bench*, *To Active*,
*Shuffle Into Deck*, *To Top/Bottom of Deck*, *To Lost Zone*, *To
Prizes*, *Attach to Their Active*, *Show Details* — with every entry
landing on the **owner's** half. There is no *To Hand* and no shared-zone entry, and both
absences are rules — see *The owner's hand is not a destination*.

That property is not a field written onto the card, and it is not "one of the cards of a batch"
either. It is **the card as the window carries it**, and three things make it so:

- **the window is on screen.** A batch deliberately outlives its window (a Look's cards are
  kept when the panel is closed), so "the window is up" is part of the answer rather than
  something left to whatever happens to be drawn
- **the card is one of the cards the batch is showing** — the batch's live view of the pile,
  so a card that has been moved out of it stops answering
- **the card is carried by that window's own pile.** A window hands each of its cards the
  *batch* (`asPile`); every zone of the board hands over the zone. This is what keeps the
  permission inside the window, and it is the answer to a reported fault: the Reveal Hand
  window drew the opponent's hand, and the **same card objects** in the opponent's Hand Zone —
  behind the window, and again after it was closed — were selectable too, because a batch is a
  live view of a pile the mirror already holds. Stated the other way round, which is the same
  rule: **in a room, a card of the opponent's on the board is never actionable**, whether a
  window put it there or its owner did.

`isActionable` in [src/lib/stores/reveal.js](../src/lib/stores/reveal.js) is the one place the
answer lives, and it takes the pile the gesture is carrying the card with. Four reasons it is
not a flag on the card, and each of them was a design decision rather than a shortcut:

- **A flag on the card would leak.** A card object is shared between a board and its
  mirror *within one client* — the mirror's cards are the same objects, handed over
  in a board state — so a property written onto one would follow it onto the owner's
  own board, where it would offer the opponent's menu for the owner's own card.
- **A set of ids beside the cards can drift.** It is a second record of something
  every move already changes, and it would need writing in every place a card moves.
  The batch is derived from the pile itself, so it cannot be stale.
- **It cannot outlive the board it was about.** The batch is reset with the board
  (`onBoardCleanup`), and the next gesture replaces it wholesale.
- **And the answer is re-asked rather than remembered.** `isActionable` reads the batches, their
  views and the spent record itself, so a component needs to *subscribe* to what the windows are
  showing for its answer to stay live — `windows` in reveal.js is that subscription, and
  `opponent/Card.svelte` reads it. A `$: actionable = isActionable(card, pile)` has no inputs a
  compiler can see: it runs once, when the card is built, and keeps that answer for the card's
  whole life. That is the shape the reported fault came and went in — the cards of the Hand Zone
  were built before the window opened and answered none of it, while a board state that rebuilt
  them during a window left them answering after it closed. The same snapshot had a card put back
  into its own pile (*To Top of Deck*) go on offering its menu.

What the player sees is **nothing at all**, and that is the second report this section answers:
the cards that may be acted on used to be picked out with a 2px `--primary-color` outline whose
colour breathed on a loop (`opponent/Card.svelte`). It is gone — see *No glow*, below — so the
window has to *say* what a click does, because a Reveal's cards are the other player's and the
default assumption is that they are inert.

### No glow

The outline animation was removed, and the two reasons are worth keeping because only the first
is about this feature:

- **it advertised a permission that was wrong.** A card this player had already moved went on
  wearing it, because the batch that made it actionable still held its id — see *A card that has
  been moved*, below. Reported as *this shouldn't be happening* about a card sitting in the
  opponent's hand with a glowing border.
- **a card that is always glowing never reads as chosen.** In solo *every* card of the far half
  is actionable (`$solo` in `opponent/Card.svelte`), so the whole half breathed, and the glow
  was asking to be mistaken for the selection ring — which is `--selection-color` and is
  already spoken for.

What says a card can be clicked instead is a line in the window's own header — *Click a card to
pick it out, Ctrl-click to add, Ctrl+A for all* — in all three windows. That is the feedback that
does not need a loop to be noticed, and it is the answer the Look window had already arrived at
for its own cards.

### A card that has been moved stops answering

**Once a card in any of the windows is moved by the player to one of the owner's zones it is not
actionable any more**, and that is a rule of its own rather than a consequence of the view. The
view is "the batch's cards that are still in the pile it reads", so a card sent to a *discard*, a
lost zone, a bench, a deck or a prize leaves the window by itself — while a card sent to a
**hand** does not, because the hand is a pile the view still finds it in, and it went on being
selectable, draggable and outlined. That asymmetry is the whole of the fault that was reported.

`spendCards` in [src/lib/stores/reveal.js](../src/lib/stores/reveal.js) is the record of what this
player has acted on, `isActionable` asks it, and every gesture asks `isActionable` — so one line
refuses the click, the menu, the drag and the request together, in every window and for every
destination rather than only where the view happens to agree.

It is **emptied when a new batch goes up**, which is not tidiness: ids are handed out per board
load (`loadDeck` numbers them 1..n), so a board that is reloaded hands the same ids to different
cards, and a record that outlived its batch marked a fresh window's cards as spent. Measured:
every drag of a card in a new window refused, on a board that had been reloaded since.

### The owner's hand is not a destination

A card out of a window may be sent to the owner's **zones**, and the hand is deliberately not one
of them: *prevent the player from placing the owner's cards into the owner's hand zone*. The menu
entry is gone (`OppCardActionMenu.svelte`) and so is the drop (`actionForPile` has no entry for
it, and `opponent/Pile.svelte` only highlights a zone whose drop means something) — the two ways
of moving a card agree, which is the rule every other zone in that table follows.

The reason is the one above: a hand cannot be read back by the player who puts a card in it. The
zone is drawn as card backs to them, so the card is out of their sight and out of their reach, and
the only thing the gesture reliably produced was a card they could no longer act on — which is
what the glow report was about.

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
detail: the pile windows float over the middle of the board and are rendered *inside* it
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

**The local changes are the ones the acting board can make truthfully, and they are
made at once.** A round trip between two boards is about three and a half seconds
measured — two poll cycles — and an entry that leaves the board sitting there for that
long reads as a menu entry that did nothing. So:

- the card leaves the pile it was in (`takeFrom`, guarded — see below)
- it is put where the owner's own move will put it (`optimisticMove`), including the
  **slot** a Pokemon in play becomes
- and the owner's events then confirm all of it

`takeFrom` is what guards the removal, because `pile.remove` is
`splice(indexOf(card), 1)` and `indexOf` on a card that is not there is `-1` — which
removes the *last* card instead ([gotchas.md](gotchas.md), and the note over
`slots().remove` in `src/lib/stores/custom/cards.js`).

The two entries that put a card **into play** need one more thing than the rest: the
owner's event carries *its* slot id, which this board cannot know in advance, so the
owner's own handler takes the mirror's stand-in out of play before it adds the real one
(`dedupeSlot`). Without that the board drew two Pokemon holding one card. The same seam
exists for the **Stadium**, which is a list rather than a slot, and is closed the same
way in `opponent.js`.

## Where a card out of a window may go

A card of the other player's may be sent to **their own zones, except their hand** — their
discard, lost zone, prizes, deck, bench or active spot. Three things are deliberately
not on that list, and each was reported as a bug when it was:

- **the player's own zones.** The near half's `discard` and the far half's `discard` are
  different stores that both call themselves `discard`, so "is this pile one of theirs"
  cannot be answered by the name — a lookup by identity is exactly what goes wrong here.
  `actionForPile` maps only the far half's own piles, and `dropRevealedCard` asks the pile
  itself (`theirPile`, marked on every pile of a mirror in `opponent.js`).
- **the shared zones**, the Stadium and the Table. Both are cells the halves meet in, and
  each half plays *its own* cards into them, so a card out of somebody else's deck has no
  business in either. The menu entries for them are gone as well as the drop, because the
  two ways of moving a card must agree.
- **the owner's hand**, which is the one zone of theirs that is missing for a different
  reason: a card put in a hand cannot be read back by the player who put it there. The zone is
  drawn as card backs to them, so the card is out of their sight and out of their reach, and
  the only thing the gesture reliably produced was a card they could no longer act on. See *A
  card that has been moved stops answering* and *The owner's hand is not a destination*.

### How many cards at once

**Several, to every zone but the Active spot.** A window's cards are picked out with clicks —
Ctrl/Cmd adds, Ctrl+A takes the batch — and a drag carries the *selection*, so dropping one of
three picked cards sends all three. That is the same rule the board's own zones follow, and the
same rule the card menu follows when an entry acts on the cards picked out.

The **Active spot takes one card**, and a batch aimed at it is refused whole rather than
half-answered. One Pokemon is Active, so the player's own `toActive` declines a selection of more
than one; a request to the owner's Active spot is answered the same way, and the acting board does
not guess at it either — moving the cards out of the window for a request that is about to be
refused would empty a window the player is still reading.

### And the drop is refused, rather than quietly doing nothing

`actionForPile` maps only the far half's piles, so a drop on one of the player's own reads
as "no action" — but a drag the board *accepts* and then does nothing with is not the same
thing as a refusal, and the difference is what was reported. All six of the player's own
zones highlighted under the pointer and then left the card where it was, which reads as a
card that was placed and came back.

So the gesture is refused where it is offered. Each zone of the player's own side — the six
piles, the bench, the active spot, the slot of a Pokemon in play, the Stadium and the table —
asks `isWindowPile` before it will take what is being carried, and a window's card is not
this board's pile, so nothing highlights and the card is not carried anywhere. `isWindowPile`
is in `reveal.js` because it is the same question `board/Card.svelte` asks to pick the right
menu, and it is off in solo, where both halves are one person and a window's cards are played
on the far half from the same keyboard.

## A card of theirs in a shared zone stays theirs

The Stadium and the Table are the two zones the halves meet in, and **each half keeps its
own list** for them. So "whose card is it" is answered by which list a card lands in, and
a card of the opponent's goes into *their* list — the mirror's own pile on this board —
never into the player's. An entry that put it in the player's own Stadium would be the
player playing somebody else's card as their own, and that is what a check on this is for.

The two zones differ in one way worth knowing: the Stadium is **replaced** when it is
played into at its limit, so the owner's own move discards what was in play there first —
which is why the acting board's guess is confirmed rather than repeated, and why a card
sent to a Stadium can legitimately end up in the owner's discard a moment later. The
mirror's own `stadiumPlayed` also refuses to add a card it already has, which is the
duplication seam `dedupeSlot` closes for the Bench.

## Who gets a window

The three gestures have three audiences, and the shape they share is: **a window is the board of
the player who took the gesture, and the table is told by the game log.** A Reveal and a Look are
both that, exactly; a Reveal Hand adds the room's watchers to the boards the window opens on.

**A Reveal puts the window on the board that revealed, and on nobody else's.** Everyone else is
told by the game log, which names the cards — that is the record of what the table was shown, and
a window over another board is the same information a second time on a board whose player is not
the one revealing. That is the answer the opponent gave twice: *the reveal window is still
showing for the owner — it should not be*, and *the cards are shown in the game log; the same
applies with the spectator*. A window is the revealer's own reading, and the log is how the table
is told.

Two things follow from it, and both are deliberate:

- **the batch still travels to every board.** The window and the *record* are different
  questions, and `applyReveal` is one function so that the two boards cannot hold different
  accounts of the same act.
- **the opponent therefore cannot act on a revealed card**, because a revealed card sits in a
  face-down deck — one pile image — and the permission is only ever asked of a card a *window* is
  carrying. That was put to them as the consequence of the change and accepted: *the opponent
  does not need to act on revealed cards*.

**A Look puts the window on the player who took it, and on nobody else's board.** The watchers are
told the same way the table is told about a Reveal — by the log, in this case the *named* line
(`Looked at [Pikachu, Switch, …]`, which the looker gets too) — and that is a change: the window
used to be drawn on a watcher's board as well, on the reasoning that *a Look is a public act with a
private meaning*, and a table where a look happens is a table where something is happening. It was
reported as a window in the way: *when a player looks at the X cards on the opponent's deck it
should not bring up the Look window for the spectator*. A Look's window is a reading of somebody
else's deck, and a panel over a watcher's board is the one board that has no business reading it.

What the Look keeps from that first design is its **audience on the wire**, which is unchanged:

- **the owner of the deck does not get it, and neither does its client.** This is the
  place in this feature where an event is addressed to some members and not others, and the
  reason is that the *ids* are the secret: `cardsLooked` names cards out of a face-down
  deck, and the owner is the one player the face-down deck is hidden from. So the client
  asks for an audience and the relay decides it — `audienceOf` in the events route, which
  sends the event to the sender and to every spectator in the room from membership, strips
  the routing field before storing it, and is what a poll filters on. A rule kept on the
  client would be a rule a crafted client could ignore.
- **the watcher is handed the batch**, which is the record of the gesture (`cardsLooked`, the
  same event the log's named line rides), and draws nothing with it: a spectator is refused the
  permission anyway (`isActionable`), and there is no window for it to be refused in.

A Look is *not* shared in the sense a Reveal is. The looker may still act on the cards it
was shown (that is the permission the batch carries, while the window is up), the opponent is
told nothing, and the cards leave the deck the moment they are moved.

**A Reveal Hand has a Look's audience and a Reveal's consequence for the owner.** The window
opens on the player who asked for it and on the room's watchers, and the ids go the same way
(`handRevealed`, the same addressed-event machinery and the same `audienceOf`) — because a hand
is the pile its owner does not read, and an id out of one is exactly what it withholds. The owner
is told one thing instead: the log line. Their own screen does not change at all, which is the
point of the hand staying drawn as card backs.

Two more things are specific to this gesture:

- **it is a Reveal in what it lets the reader do.** They may act on those cards, right up to
  playing them onto their owner's board — the same permission, the same request
  (`oppCardAction`), the same log line written by the owner's own move.
- **and it is a Look in what it asks of the owner: nothing.** There is no request and no
  answer. *When the player performs this action it should just happen and add to the game
  log* — so the gesture is unilateral, and the log is the whole of the consent.

### What the log says, and to whom

A Reveal writes one line and it is the room's, with the cards named — a reveal is a public act, so
the record of what the table was shown belongs to the table.

A Look writes **two**, and they go to different people:

- the **unnamed** line — `Looked at the top 3 cards of the opponent's deck` — is the room's, so the
  deck's owner knows a look happened without being told what was in it
- the **named** line — `Looked at [Pikachu, Switch, Boss's Orders]` — goes to the looker and the
  room's watchers, the same people the window reaches

That split is a second audience, and it rides the same machinery as the window: the sender names its
audience, the relay adds the room's spectators from membership and delivers to those members only
(`audienceOf` in the events route), and the routing field is stripped before the event is stored.
`publishLogTo` is the client's half of it — it writes the line locally, because a client is never
handed its own events back, and sends it to the members it named. An ordinary `publishLog` still
goes to the room, which is what almost every line in the game is.

A Reveal Hand writes **one line to the room** — `Revealed opponent's hand` — and it is the room's
rather than the reader's, which is the opposite of the Look's split and is deliberate. There is
nothing to withhold from the owner beyond the cards themselves: they are told *that* it happened,
by a line that names no card and no count, and their own screen says nothing at all. An unnamed
running log of a hand that has since changed would be a record of nothing in particular, and the
window is where the cards are read.

### One seam this leaves

An action on a window's card is a **request to the deck's owner** (see *An action is a request,
not a move*), and a Look always reads the far half of the looker's board — so for a Look the
direction is always right. A Reveal can be of the revealer's **own** deck, though, and then "the
owner of the card" and "the player acting" are the same person while the request still travels to
the *other* board. Measured: the revealer sends the card to discard, the acting board's optimistic
move puts it in its mirror of the other player's discard, and the other board — which holds no
such card — takes one out of its own deck instead. It is pre-existing rather than new, it is
outside the reported faults, and `tools/reveal-check.mjs` asserts that the entry works while
saying in place that where the card lands is not asserted, rather than pretending otherwise.

## What the acting board decides, and what it cannot

The acting board makes every change it can make truthfully, at once — and there is one thing
it cannot, which is worth stating because it is the difference between "this is slow" and
"this cannot be faster here".

**The acting board's own screen is immediate.** The card leaves the pile it was in, and it is
put where the owner's move will put it, including the slot a Pokemon in play becomes. All of
that is local.

**Every other screen waits for the relay.** A move reaches the other player and any watchers
on their next poll of the relay, and the poll interval is a *server* setting
(`RELAY_POLL_INTERVAL_MS`, 2 seconds by default — see
[src/lib/relay/config.js](../src/lib/relay/config.js), which is the knob and its cost). The
client cannot ask for a keener one: the poll endpoint clamps a requested interval up to the
configured minimum, deliberately, so that one client cannot raise the cost of the room. So
"the discard takes about a second on the opponent's screen" is that interval and not this
feature, and the number is printed by `tools/reveal-check.mjs` rather than asserted, so a
change to the interval shows up as a number.

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
- `cardsLooked { looker, lookerSeat, pileName, cards }` — the same batch for a Look, with the
  player who took it named instead of a half, because a Look is always a reading of the far half
  of *that player's* board. It is addressed: the looker and the room's watchers, never the deck's
  owner. What the looker does with it and what a watcher does with it are different things now —
  the looker's board opens the window, and a watcher's draws nothing and reads the log's named
  line (see *Who gets a window*).
- `handRevealed { reader, pileName, cards }` — the same batch for a Reveal Hand, with the
  reader named instead of a half: a hand is read off the far half of the *reader's* own board,
  so a watcher's board — which mirrors both players — has to be told which of its mirrors the
  ids came from. Its `pileName` is `'hand'`, which is what picks the hand off that reader
  (`theirPileFor` in reveal.js). It is addressed, the way a Look is: the reader and the room's
  watchers, never the hand's owner. Unlike a Look, the window does open on a watcher's board.
- `handToggle { revealed }` — the per-zone flag an *owner* sets to show their own hand, and the
  one event in this group that **nothing in this feature sends**. It is still relayed, still
  applied (`opponent.js`), and still read by `opponent/Hand.svelte`; a Reveal Hand leaves the
  zone drawn as card backs, so there is nothing to flip. See the note in *Reveal Hand, and why
  it stopped being a toggle*.
- `backToDeck { owner }` — the shuffle that ends such a window. It carries a *half*
  rather than a list, because a shuffle is the deck's state and no client can mirror
  the order of a deck it cannot read. Only a Reveal and a Look have this ending.
- `oppCardAction { card, from, action, slotId }` — one player asking the owner of a
  card to move it.

The names above are the allow-list in
[src/routes/api/relay/events/+server.js](../src/routes/api/relay/events/+server.js), and what is
not in it cannot be relayed.

A Look's only visible effect on the other player is the shuffle, if the looking
player ends it that way — which is what a card that says "look at the top X, then
shuffle that deck" looks like from their side of the table too.

## The two names for a half, and the one place they are flipped

The `owner` field is written by the player who acted, so their `mine` is the other
board's `theirs`. Everywhere else the batch's word is the **reader's**: `mine` is
this board's own deck, and the two deck windows print their heading straight off it
("Your deck" / "Your opponent's deck").

A Look and a Reveal Hand name **nothing** of the kind, and that is not a gap: neither
gesture has a half to flip, because both always read the far half of the reader's own board.
What they carry instead is `reader` — the member id of the player who read — and a `pileName`,
which is the pair that answers "which pile on which board's mirrors" (`theirPileFor` in
`opponent.js`). A watcher is the only board that needs the member id; a player's own reading
resolves against its single mirror either way.

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
| the opponent's hand | *Reveal Hand* | `revealHand()` — the whole hand, shown to this player and the watchers |
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

**Reveal Hand is on the opponent's hand and nowhere else**, and the player's own hand menu lost
the entry it used to have. That is the shape that was asked for twice over: the act belongs to
the hand it is about, and a player has no switch that shows their own hand. It is also the first
entry the *opponent's* hand menu has ever had in a room — that menu used to exist only in solo,
where the far half is yours to play, and it is now reachable whenever an entry on it could be
taken (`reachable` in `opponent/Hand.svelte`, the same rule `opponent/Deck.svelte` uses). The
solo entries on it are rendered only in solo, because they *are* solo's, while Reveal Hand is
rendered disabled outside a room rather than removed.

**Discarding needs no window and no drag.** *Discard Top Card* and *Discard Top X* are one
menu entry each: the player picks it, answers how many for the X one, and the cards go from
the top of the deck straight to the discard. Nothing is revealed by either — a discard is a
face-up pile, so the *owner* sees what they lost, which is what a discard is, and the player
who asked sees the deck get shorter.

Both discards are **requests**, and they are the pair that carries a *count* as well as ids:
the top of a deck this player cannot read is not a card this board can name, so the request
says "the top *n*" and the owner reads its own deck for what that is
(`discardTopOfTheirDeck` → `discardOwnTop`).

The request **also names the ids this board's mirror has at the top**, and the owner uses
them when it can. That is what lets the move be made here at once, like every other entry:
the mirror's top *n* go to the mirror's discard, and the owner is asked to move *those*
cards, so its events confirm a move this board has already made rather than making a second
and different one. Without the ids the owner would take *its* top *n*, which is the same
list only while the mirror is in step — and it is not always in step. The owner falls back
to the count when the ids it was named are not all in its deck, which is what a stale mirror
looks like from the other side: the gesture was "the top *n*", so it is answered as that
rather than refused.

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

There is no *View Top X* on the player's own deck beyond the search it already has. The two
top-of-a-deck entries share `topCount`, so "the top X" means the same thing in both — X, or the
whole deck when X is larger — and Reveal Hand asks for no X at all, because a hand is not a
deck: there is no "top" to name and nothing to count off, so the gesture is the whole of it.

## The windows

`dialogs/Reveal.svelte`, `dialogs/Look.svelte` and `dialogs/HandReveal.svelte` are three
components and deliberately not one. They differ in three ways that are rules rather than
styles:

- **the audience** — a Reveal is drawn from this client's own copy of the batch, on the board
  that revealed; a Look on the board that took it; a Reveal Hand on the boards the addressed
  event reached, which includes the room's watchers
- **the cards** — a Reveal's are drawn by `board/Card.svelte`, because a Reveal may
  be about the player's *own* deck and those cards are the player's; a Look's and a
  Reveal Hand's are drawn by `opponent/Card.svelte`, because they are always the other
  player's
- **the ending** — Close & Shuffle shuffles the deck the batch names, which for a
  Look is the other player's; a Reveal Hand's only ending is Close

Why three rather than one component with a `kind` prop is worth stating, because a copy is
usually the thing to avoid: what the three share is already shared — the same `Popup`, the same
fixed-width grid, the same `Card`, the same `ctrlA` selection — and what they do *not* share is
three separate rules, each of which a prop would turn into something a caller can pass wrongly.
A `shuffle` prop on this window is a window that can be told to shuffle a hand.

Both deck windows carry **Close & Shuffle and never a Close beside it**, they are the same fixed-width grid (one full row of
136px cards) so a reveal of two opens the same window a reveal of ten does. A Reveal's ending is
**one shuffle between the two of them**: the revealer and the board that was told share one
`shuffled` flag riding the `backToDeck` event, so which button either of them sees never depends on
which of them pressed it. A Look's ending is the looker's alone, because there is nobody else with
the window.

A *Close* beside *Close & Shuffle* was the first shape both windows had, and it was wrong for the same
reason in each: it offers a way to put the deck back exactly as it was found, which is the one ending a
reveal is not. A reveal is taken *because* the top of the deck is about to be read, so the order it was
read in is the thing that should not survive it; a Look ends with a shuffle because the deck belongs to
somebody else. So the ending is one button rather than two — **Close & Shuffle while the shuffle is
owed, Close after it has happened** — and Escape or a click outside still closes either window without
shuffling, which is how every panel in the app closes.

A **frozen batch** is the other half of that ending: a window draws the batch's cards *that are still
in the deck*, and a shuffle leaves none of them there, so the batch is frozen where it stands rather
than following a deck that no longer holds what it was reading. Freezing is an explicit act rather
than something the view works out for itself, because "a card that was moved" and "a deck that was
shuffled" are different answers to what is on show.

**That pair of mechanisms is older than the audience it was written for**, and it is worth saying so
rather than leaving the reader to work it out: the freeze and the "Close after the shuffle" button
exist for a window that is still up on the board that did *not* press the button — and there is no
such window any more. A Reveal's window is the revealer's, and a Look's is the looker's, so the board
that presses the shuffle is the board that has the window, and its window closes with the button. What
is still load-bearing is the `shuffled` flag riding `backToDeck`, which is what makes one reveal one
ending between the two halves; the frozen view is kept as the batch's own account of what was on show.

Until it is frozen, a batch is a **live view of the pile it was taken from**, not a copy: the window
shows the batch's cards that are *still in that pile*, and a card that has been moved goes from the
window and stops answering clicks. A copy of the list taken at reveal time would keep offering a
card that has already been sent somewhere, and the click would do nothing at all, silently.

That view is a **store of its own** (`revealView` / `lookView` / `handRevealView`), refreshed by a
subscription to the pile, and it has to be: the card is moved on the *owner's* board,
by the board's own code, and a player's own events are never handed back to them — so
nothing the window subscribes to would ever change, and on that one board the window
would go on drawing a card that is already in the discard. Svelte cannot see a `get()`
inside a template, and a `$:` statement cannot see a store that a plain function call
reads; both of those cost this feature an afternoon ([gotchas.md](gotchas.md)).

None of the three windows is a pile's view. There are no Natural/Sorted tabs (there is one
order — the order a deck is read in, top card first, and for a hand the order it is held in),
and no four move buttons: those are where a *search* takes a card out of a deck to, and a
reveal is not a search. What a card in one of these windows answers to is its own right-click
menu, which is the permission above.

## What the log says

| Gesture | Line |
| --- | --- |
| the player reveals their own deck | `Revealed [Pikachu, Bulbasaur, Charmander] from the top of their deck` |
| the player reveals the opponent's | `Revealed [Pikachu, Bulbasaur] from the top of the opponent's deck` |
| the player looks at the opponent's | `Looked at the top 3 cards of the opponent's deck` |
| the player reveals the opponent's hand | `Revealed opponent's hand` |
| Close & Shuffle | `Shuffled Deck` |
| an entry taken on a revealed card | the move's own line, written by the owner |

**A Reveal names the cards and a Look does not**, and that pair is a rule rather than a
wording. A reveal is a *public act* — the cards were shown to the table — so the log is the
record of what was shown, and a line saying only "the top 3 cards" leaves out the one thing
the gesture was for. A Look is the opposite: the opponent cannot see those cards, so naming
them would tell them what the look was for, which is exactly the information a face-down
deck withholds. The names sit in brackets the way every other line that names cards does
(`logMove` in [logger.js](../src/lib/stores/logger.js)).

A Look is still written even though the opponent cannot see the cards, for the same reason
*Viewed deck* is (`logDeckView`): the line names nothing, and it is what the opponent is
entitled to know happened.

**A Reveal Hand's line names neither the cards nor the count**, and it is the one line in
this feature that is short on purpose. The words were asked for exactly — *in the game log
output "Revealed opponent's hand"* — and they are also what the gesture is: unlike a Reveal of
a deck, nothing here is a *sample* whose size or contents the table needs recorded. A hand is
already a face-up thing once this has happened, so the line's job is to say that it happened,
and the window is where the cards are read.

The line about a card acted on is the **owner's own move**, so it reads exactly as
it would if they had moved the card themselves — which is the point of the design
above.

## Checking it

`node tools/render-check.mjs` holds the half of this that needs no browser: the permission rule —
a card is actionable while it is one of the cards a window that is *up* is showing **and** it is
carried by that window's batch, the same card handed one of the far half's own zones is refused,
and a closed window's cards stop answering — the shape of a batch (a live view of a pile, and not
one of the board's own piles), all three windows rendering with their cards and their buttons, and
the wiring that offers the entries and picks the right menu for a card of the far half's.

It holds the permission's other edges as well: a card stops answering the moment this player has
acted on it, and the record of that does not outlive its batch. It also asserts, out of the
component's own source, that the far half's card carries no action class and that there is no
outline rule behind it — a binding with nothing to draw it and a rule with nothing to bind it are
two separate bugs, and one assertion cannot see both — and that the card *subscribes* to what the
windows are showing (`$windows`) rather than keeping the answer it was built with, which is the
shape the reported fault came and went in.

`node tools/reveal-check.mjs` drives the rest in two browsers, and a third where one is running:
the window's audience (the revealer's alone, the looker's alone, a Reveal Hand's on the watcher's
board too), the whole of a hand in the window where the count says it should be, the cards in the
**Hand Zone** answering nothing with the window open or closed, the one button, the log line on
both boards, the hand still drawn as card backs afterwards, the owner's hand refusing a drop, the
menu offering no *To Hand*, no card animating anywhere, and a card that has been moved going on
refusing once it is out of the window.

`node tools/solo-check.mjs` asserts the same about the animation where it was worst — in solo
every card of the far half is actionable, so the whole half used to breathe.

What neither can see is the clicks that make the feature real — a card's ring appearing after a
click, a menu entry moving a card on *the other* board — and that is the same line
[diagnostics.md](diagnostics.md) draws for every other browser check.
