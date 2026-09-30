# Game mechanics

The rules of the game as this app implements them: what a player may do, what the
app does in response, and — the longest section — what it deliberately leaves to
the players.

This is a different document from [gotchas.md](gotchas.md). That one is about the
code: a trap in the way a store or a component is written, and what it cost. This
one is about the *game*: a rule you need to know to play or to test, whether or not
any code behind it is interesting. Where the two meet — a rule that exists because
of a trap — this document states the rule and links out.

| Document | What it is for |
| --- | --- |
| [board.md](board.md) | where every zone is, and what the screen looks like |
| [selection.md](selection.md) | the selection: what is picked up, and what glows |
| [reveal.md](reveal.md) | Reveal, Look and Reveal Hand, in full |
| [timer.md](timer.md) | the clock, and how two browsers are kept together |
| [rooms.md](rooms.md) | a room's life: joining, waiting, closing |
| [solo.md](solo.md) | how solo differs from a room |
| [terminology.md](terminology.md) | what each zone is called, in each vocabulary |
| [diagnostics.md](diagnostics.md) | the checks, and how to run one |

## The one rule that explains the rest

**This is a tabletop, not a rules engine.** The app tracks the state of a game two
people are playing by hand, and it enforces exactly two things:

- **Whose card is whose.** A card does not cross the table: you cannot move, attach,
  evolve, discard or draw from the other player's board. The exceptions are the
  gestures the game itself hands across — damage and a status effect on their Active
  Pokémon, declaring a target, and an action on a card they have *shown* you.
- **Who may see what.** A hand is card backs, a deck is one image, a prize card is
  face down until somebody turns it up, and Pokémon in play can be hidden.

Everything else a Pokémon TCG rule would say — that a turn has an owner, that energy
is attached once per turn, that a Pokémon cannot evolve the turn it was played, that
damage is compared against HP, that six prizes is a win — is applied by the players
at the table. The app neither checks it nor refuses it.
[What the game does not enforce](#what-the-game-does-not-enforce) is the list.

So "does the app stop me doing X?" is almost always no. The useful question is
"does the app *say* I did X?", and that answer is the game log.

## The table

### The two halves

The screen is two boards, one per player, laid out as the far side of a table: each
half has its own Deck, Prizes, Discard, Lost Zone, Hand, Bench, Active spot and
Table, and each half has its own Stadium band and Pokémon Power band inside the one
Stadium cell. Two of those cells — the Table and the Stadium — are **shared**, with a
copy of the zone per player in the same place, and they get
[a section of their own](#the-two-shared-cells) because almost every awkward rule in
the game comes from them ([board.md](board.md#the-zones)).

A player's own cards are the ones on their half. In a room the far half is drawn
from the other player's events, so "my card" and "their card" are two boards rather
than one rule. In solo both halves are the same person's keyboard, so the rule has
to be written down and is ([solo.md](solo.md#the-two-halves-are-separate-boards)).

### The zones

| Zone | What it holds | Readable by the opponent |
| --- | --- | --- |
| Deck | the shuffled deck, face down | count only |
| Prizes | the prize cards, face down when dealt | backs, unless the owner shows them |
| Discard | discards, in order | yes, face up |
| Lost Zone | the lost zone, in order | yes, face up |
| Hand | the hand | backs |
| Bench | up to any number of Pokémon, each a *slot* | the Pokémon, unless hidden |
| Active spot | one Pokémon, a *slot* | the Pokémon, unless hidden |
| Table | cards in play that are not Pokémon, stacked | yes, face up |
| Stadium | up to two cards per player | yes, face up |
| Pokémon Power | no cards at all — only the VSTAR / GX marker | the marker |

Two of these are not piles of the board proper:

- **`pickup` is a phase, not a zone.** Cards wait there while a multi-card choice is
  resolved (a *View Top X*, an *Inspect Prizes*), and
  [terminology.md](terminology.md#the-zones) lists it among the zones precisely
  because moves name it.
- **Slot innards** — the Pokémon, the energy and the tools under one Pokémon in
  play — are three lists inside the slot rather than zones of their own.

### The two shared cells

Two of the zones are **one cell each on the screen with a copy per player in it**, and
they are the only place the two halves meet:

| Shared cell | The near copy | The far copy |
| --- | --- | --- |
| The Table (grid area `play`) | your `table`, drawn over the far one | theirs, lying underneath |
| The Stadium's middle band | your `stadium`, drawn over the far one | theirs, lying underneath |

The Table is where cards in play that are not Pokémon go, drawn as a face-up stack, and
the Stadium is the zone a Stadium card is played into — the cell also carries each
player's Pokémon Power band above and below it, which is a token and not a shared zone
at all.

**Shared cell, not shared pile.** Each half has its own `table` and its own `stadium`;
a card in the cell is on the half that played it, and the two piles are drawn in the
same place with the near one on top. That is the whole reason the rest of these rules
exist:

- **A card only ever goes into its owner's copy.** Your keys, menus and drags put a card
  into your own Table or Stadium and never into the far one. In a room the far half is
  not draggable at all, so this costs nothing; **in solo both halves are one keyboard**,
  so it is a rule the code has to enforce, and it does — a solo drag of a far-half card
  lands on the far half's copy, and a card of one half's cannot be taken out of a shared
  cell by the other.
- **The near copy stands aside for a drag that belongs to the far half**, or the drop
  would stop at the wrong one. In solo that is while a far-half card is being carried;
  for a card out of a Reveal or a Look it is because the card belongs to the other
  player, so the cell has to let the drop reach *their* zone underneath. The Table also
  takes no pointer events while it is empty and nothing is being dragged, which is what
  lets a click through to the far half's Table under it.
- **A card of the opponent's in a shared cell is never actionable**, even one a window
  showed you. The Table and the Stadium are deliberately absent from the places a
  window's card may be sent — from the action menu and from the drop table both —
  because each half plays only its own cards into them.
- **A flip does not move them.** The two shared cells are the one thing flipping the
  board leaves alone: the near copy stays the player's own however the board is turned,
  because handing the player's own Table or Stadium to the other side of the screen is
  the one thing a flip must not do. It is a view change, and the cells are where that
  matters.
- **Neither draws a count.** The Stadium is read as cards — up to two each, side by
  side — and the Table is a stack, so neither carries a count badge. The Table also
  refuses `Ctrl+A`: its cards are picked up one at a time.
- **What is in them is public.** Both are face up for everybody, and the moves that
  touch them are logged with the cards named — a card played into the Stadium, and any
  card moving to or from the Table.

The Stadium's own rules — the two-card limit, the replacement, and the play that clears
the other player's — are [below](#the-stadium).

### Slots, and what is attached to a Pokémon

A Pokémon in play is a **slot**, and a slot is one Pokémon with what is attached
under it:

- `pokemon` — a stack. Evolving pushes onto it, so the top card is the one on screen
  and the card it evolved from is still under it.
- `energy` — everything attached that is not a tool by type.
- `trainer` — attached cards whose `card_type` is `trainer` (the tools).
- plus the three tokens that belong to the Pokémon rather than to a card: **damage**
  (a number), **status** (two corners) and **abilityUsed** (a flag).

Any number of energy and tools may sit under one Pokémon: the app counts none of
them and caps none of them. A slot whose Pokémon list goes empty discards its energy
and tools and removes itself, which is the one automatic cleanup in the game — see
[Taking a card out of play](#taking-a-card-out-of-play).

## Starting a game

### The deck

Each player imports a deck through the **Import Deck** window: a text box for the
list, *Import Deck*, and *Import Random Deck* directly under it. In solo the window is
asked for by a button in the board's corner — **Import Deck 1** for the player's own
half, **Import Deck 2** for the opponent's, because both halves are one person's there.

In a room the window opens *by itself*, the moment the board appears: creating or
joining a room puts it up in the middle of the board and leaves no way out until a
deck has imported cleanly. It has no close button while that is true, and neither the
backdrop nor `Escape` dismisses it — a player who could close it would be sitting at
an empty board with nothing to import into. An import that reports nothing closes the
window, and the board answers **Deck successfully imported** in the middle of itself,
fading after two seconds. From then on the window is an ordinary one: the **Import
Deck** button opens it again, and it closes like any other window.

The text in the window is sent verbatim to the Limitless TCG API and the cards that
come back are the deck; the app parses nothing itself. Two requests are possible:
*Import Deck* posts the textarea, and *Import Random Deck* asks the same API for a
random list — behind a confirmation (*OK* / *Cancel*), because it is the one button
that replaces whatever is in the box.

Two things are reported back to the player, and neither is a gate on the *board*:

- **The API's own errors**, joined into one message.
- **`Decklist is not 60 cards!`** — the app adds up the `count` of the returned
  cards and complains if the total is not 60. The deck is *already loaded* at this
  point, and it stays loaded: the message is a warning, not a refusal.

Neither is a gate on the *board* — the deck is loaded either way — and they are a gate on
the *window* for a typed list only. **The two imports are held to different rules**, and
that is the point of them: *Import Deck* closes the window when the API reported nothing
and the list adds up to 60, while *Import Random Deck* closes it as soon as cards have
arrived. A random list is not the player's to correct, so a check that refused one would
leave them at a window with nothing they could do about it; a typed list is theirs to
correct, so a complaint about it leaves the window up to be fixed.

**A request that never answers does not leave the window spinning.** The API is somebody
else's, so the request has a deadline of 30 seconds and a failure is reported where the
deck would have been: the spinner stops, the reason is on screen (*the deck API did not
answer within 30 seconds*, or *could not reach the deck API*), and the buttons are there
to press again. Nothing is loaded for a failure, because nothing arrived — the deck the
player already had is left alone. It matters more than it looks: a room's window cannot
be dismissed until a deck lands, so a request with no deadline and no answer was a player
with no way out of the window at all ([gotchas.md](gotchas.md)).

An import is **shuffled as it lands**, and it writes nothing to the game log — neither
the import nor the shuffle. That makes the deck a deck from the moment it arrives rather
than from the first *Setup*: a look through it, or a card drawn out of it by hand, is not
the list in the order it was typed. And nothing is written because nothing happened at
the table — *Shuffled Deck* in the log is a player shuffling, which an import is not.

**The one and only deck rule the game knows** is that the list contains at least one
Basic Pokémon (`card.stage === 'basic'`). It is used in exactly one place:

- With **auto-mulligan on**, *Setup* would be disabled while the imported list has
  no Basic — a deck that cannot produce a starting Pokémon cannot be set up, so the
  button says so rather than dealing a hand that has to be redrawn for ever.
- **Auto-mulligan is off and cannot be turned on from the app** (see
  [Mulligans](#mulligans)), so *Setup* is always enabled and the check is not asked
  at all. A deck with no Basic can be set up, and nothing complains.

So the game enforces **60 cards as a message** and **one Basic as a precondition for
the mulligan loop**, and nothing else at all. With the loop off, that precondition has
nothing left to hold back: the rule is still in the source and still holds the Setup
button, but the button is never disabled in play.

### Setup

*Setup* deals a fresh game in this order. In solo it is the *Setup* button of the row solo
keeps, and **it is the only mode with a button for it**: a room deals when its opening
finishes, which is not a press anybody makes — see [Opening a room's
game](#opening-a-rooms-game). **There is no key for it**: the `N` shortcut and its
confirmation are gone, and starting again over a game in progress is *New Game* in the
settings menu ([Starting again, inside the same
room](rooms.md#starting-again-inside-the-same-room)).

**The two modes are not the same flow any more.** Solo is one person at a button: the
press deals both halves, and that is the whole of it. A room has a second player in it,
so the deal is the *end* of a short negotiation and cannot happen until both of them
have a deck and have decided who goes first — see
[Opening a room's game](#opening-a-rooms-game). What follows here is the deal itself,
which both modes share: solo calls it from its button, and a room calls it from the
phase the order settles into.

1. **The board is reset.** Deck rebuilt from the imported list, and hand, prizes,
   discard, lost zone, bench, active spot, stadium, table and pickup cleared. Both the
   VSTAR / GX marker's used flags go back to unused, the turn counter goes back to 0,
   prizes go back face down, Pokémon come back visible. **The clock is not touched**: it
   is the table's, not the board's ([timer.md](timer.md)).
   The marker itself goes back to *Off* in solo, and to whatever the room's format says
   in a room — Expanded stamps both marks back on, because there the marker is the
   room's rather than the player's (see
   [The VSTAR and GX markers](#the-vstar-and-gx-markers)).
2. **The deck is shuffled.** Setup's shuffle writes nothing to the log on its own —
   the deal is one line, below.
3. **Seven cards are drawn** into the hand. This draw is silent: no log line and no
   event, because the seven cards are about to be sent as part of the whole board
   state anyway.
4. **Six prizes are dealt face down**, off the top of the deck, *after* the draw.
   A 60-card deck is therefore 53 after the hand and 47 after the prizes.
5. **The turn counter is set to 0.**
6. **Your Pokémon are hidden** (in a room, not in solo) — the same action `Z` takes.
   In solo the *Setup* button glows until it is pressed, because the glow is the only
   thing that says the board is hidden and it points at the control that brings them
   back. **In a room nothing glows and the veil is not the player's to lift**: it comes
   off for both of them when both have pressed *Ready*, because until then the hand in
   front of each of them is still being decided
   ([Opening a room's game](#opening-a-rooms-game)).
7. **The deal itself writes nothing.** The room's opening hand is not an event at the
   table and the board it deals already says so — the hand, the prizes, turn 0 — so the
   room's deal and the *Mulligan* behind it keep quiet, and the lines a room's log gets
   are the ones the players actually say: the coin, the order, the mulligans and
   *Game started*. **Solo's own button logs `Setup`**, because its row is the solo
   player's alone and the one button is the deal. The board state is published to the
   room in every case.

Nothing is refused for being unusual: a deck that is short deals a short hand and
fewer prizes, a deck with no Basic sets up, and Setup can be pressed mid-game. Setup
is the only way to get a fresh board, and it is a *new game* rather than a rewind:
the log keeps both games' lines.

**Setup is one player's own move, and it is not the same thing as *New Game*.** Setup
deals *your* board from the deck you already imported and leaves the log, the clock and
the other player alone; **New Game** — the settings menu entry — puts the whole room back
to how it was when it was created, which the other player has to accept and which throws
the decklists and the log away with the game
([rooms.md](rooms.md#starting-again-inside-the-same-room)). A player who wants a
differently shuffled opening wants Setup; a table that has finished a game — or wants to
play a different one — wants New Game.

In solo, Setup deals both halves — seven cards and six prizes to each — from the two
imported decks.

### Opening a room's game

A room's game begins with two people agreeing, and the deal above is the *last* thing
that happens rather than the first. The flow is `src/lib/stores/gameSetup.js`, and it
has five phases: `idle`, `coin`, `order`, `deal` and `live`. Both boards are told every
step, so the two are never in different phases.

**Solo does none of this.** There is no second player to toss with, and solo's row is
unchanged.

**1. The board is locked until both players have a deck.** Nothing on the table is anybody's
to touch while a deck is missing, so a **lock** covers the whole window — the board, the
cards, the chat and the panel — from the moment a room has two players in it. It says
*Setting up the game* and *Both players need to import a deck before the game can begin*, and
it carries **nothing to press**: the way to satisfy it is the Import Deck window, which is
drawn over it.

**There is no *Game Setup* button, and no press to make.** The opening used to wait on a
press from each player; it waits on the **two decks**, which is the same condition the lock
was already drawn on — and the room can see a deck for itself, so asking the players to
confirm it was asking them to confirm something nothing was waiting on. The moment the second
deck lands, the opening starts by itself: a room where one player imported while alone waits
for the seat rather than for a second press.

That condition is not a flag of its own: the deck a player imported *is* the card list on
their board, and the other player's arrives with every board state, so the rule asks `cards`
and the opponent mirror.

**2. Deciding who goes first.** The second deck does not deal. It picks one of the two
players **at random, on the board that saw it arrive**, and names them in the event — two
boards each drawing for themselves would disagree about half the time, and the board that
receives the event takes the phase from it rather than drawing a second caller. That player
is shown *Determining player order* with **Heads** and **Tails**, and the other player is
shown the same dialog saying that the call is being made.

- The call is logged as `Chooses HEADS` or `Chooses TAILS`, and the coin is flipped in the
  same act: `Coin flip: HEADS` or `Coin flip: TAILS`. **Neither line says `Player`**: the
  relay already names the sender on every line it delivers, so the line reads
  *[Alice] Chooses HEADS* and the word was the only thing in it that was said twice.
- **Calling it right wins the toss.** The winner is asked whether they want to go **First**
  or **Second**; a wrong call hands that question to the other player instead, and the
  dialog on both screens says which way the toss went.
- The choice is logged as `Decided to go First` or `Decided to go Second`. Choosing
  *Second* is not "I am second" — it says the other player goes first, and that is what the
  turn order records.

While either question is open the dialog still takes the screen, and it cannot be clicked
away or escaped out of, because neither of those is a call or a choice — the same behaviour
the Import Deck window has. **The board stays locked through both questions**, and the
moment one of them is answered the lock goes: that is what the order being settled means.
What the players are let back into is a board that is dealt but *veiled*, so it is their own
cards they can reach first.

**3. The deal, and the opening hand.** As soon as the order is settled both boards deal:
seven cards each and six prizes, hidden as the deal always hides them. The row above the
turn is **Ready** and **Mulligan**:

- **Ready** starts the game. A press that has been made shows a **tick** — *Ready ✓* — and
  the button stops answering. It does not glow: the tick says everything the glow was
  saying, and a light that pulses for as long as the other player takes is a light nobody
  can turn off.
- **Mulligan** is drawn **green**, because it is the one button in the row that is this
  player's own — it buys another hand and changes nothing on the other board — and the grey
  it wore read as a disabled button beside a live one. Each press **adds one to this
  player's count** and writes two lines: `Player had N mulligans`, then `Hand: <the cards>`.
  The count is the player's own and is not sent to the other board; the opponent reads it
  from the log. The button shows the count as it goes.

**4. The game starts when both are ready.** Then, together:

- the **veil comes off** both boards — set as a state rather than toggled, so the second
  board to arrive cannot hide the first one's Pokémon by toggling it back on;
- the **clock starts**, from the room's default of fifty minutes;
- the **turn** is stated as **1** — see below;
- **Flip Coin** and **End Turn** appear *under* the Ready/Mulligan row: the two actions a
  room has always had and had no button for while the setup was the only row there was.
  They were on `F` and `Enter` alone;
- `Game started` goes in the log — **once**, written by the first seat, because both
  boards notice the same moment and a line from each would say it twice.

**Ready and Mulligan stay for the whole game** rather than going with the opening. They are
the room's own controls: a hand drawn mid-game can be mulliganed, and a player who has said
they are ready keeps their tick. Taking them away at the start left a player with no way to
mulligan a hand drawn at turn 5.

**A board that reloads mid-setup replays into it.** The steps are room events, so a client
that comes back arrives at the same phase with the same caller and the same ready list.
*Your own deck is the one thing the replay does not bring back*
([rooms.md](rooms.md#reconnecting-and-idle-boards)), so a reloaded board is sent to the
Import Deck window again and deals when it has a deck — which is why the deal hangs off
the *phase* rather than off whatever caused it.

**The opening turn is stated, not counted.** A game begins at turn 1, so the start says
`setTurn(0)` and then `setTurn(1)` rather than adding one to whatever the counter holds.
Both boards reach the start independently, each applying the turn for itself, and counting
from the current value went wrong the moment one of them got there twice: measured on two
browsers, the game started, the log said so once, and the turn row read **Turn 2**.

**A setup belongs to two players in one room, and is forgotten when either changes.** The
phase lives in the room's log and nowhere else, so a seat changing hands — or the same two
players making *another* room — leaves both boards in a phase agreed by somebody, or
somewhere, that is no longer the case. The second is the one that was reported:
*"after leaving the room and creating a new room the Game Setup button did not appear"* —
which at the time meant an opening that could not be started at all, because the new room
had the **same two members in the same order**, so a watcher on the seats had nothing to
notice while the flow still held a ready list naming both of them — and `bothReady()` was
satisfied by a room that had not dealt a card, which put the phase at `live`. The watcher is
therefore on the **room id** as well, and keyed on the value rather than on an event, which
is what keeps a *reload* from wiping the setup it is in the middle of: resuming a session
re-joins the same room, and that is not a change.

**A second game in the same room is still not checked.** *New Game* goes through — the other
player accepts, both boards are cleared, both import a deck again — but whether the opening
returns has not been verified since the reset was reworked, and it was **broken** when it was
last tried: the reset ran on both boards and left the phase at `live` with the previous
game's ready list in it, so the second game could not
be started at all. The reset now also clears the two lists outright (a union has no way to
empty itself) and is keyed on the room rather than on an event, which is the shape the
diagnosis pointed at — but the section of `tools/game-setup-browser-check.mjs` that drives it
is still written and skipped behind a `SECOND_GAME_KNOWN_BROKEN` flag, so **this is untested
rather than fixed.** Leaving the room and making another one *is* checked there, and passes.

### Mulligans

**A room has a manual mulligan.** It is the *Mulligan* button beside *Ready*, and it is
the player's own: each press redraws the opening hand, counts up, and writes
`Player had N mulligans` and `Hand: <the cards>` ([Opening a room's game](#opening-a-rooms-game)).
The usual extra card per mulligan does not exist, and the count is a log line rather than
a shared state — the opponent reads the number because the line is the room's.

**Auto-mulligan is off, and there is no longer a control for it.** The *Mulligans*
block is gone from the settings menu, and the setting behind it (`autoMulligan`,
persisted as `auto_mulligan`) is `false` with nothing in the app that sets it to
anything else. So the loop below does not run in play, and one line has a branch that
never takes it: solo's log says `Setup`, never `Setup - N Mulligans`.

**The code is still here on purpose**, waiting to be reused rather than rewritten:
the setting and its storage key in `src/lib/stores/settings.js`, the loop that reads
it in `GameActions.svelte` (`setupBoard()` and the call in `setup()`), the
`showMessage` line that reports the count, and the disabled-Setup guard described
above. Nothing was deleted, so bringing mulligans back is a default flip and a
control, not a reimplementation — the settings file has the one-line console write
that exercises it meanwhile.

**A stored value does not outvote the new default.** The setting was a checkbox
before, so a browser that had it ticked still has `auto_mulligan: true` in
`localStorage` — and `storable()` reads what it finds, so that value would have kept
redrawing hands with nothing on screen to say why. It is removed on load instead
(one deliberate line in `settings.js`), which is also why the console write above is
a one-page-load lever: nothing in the app ever writes the key back.

What the feature does when it *is* on, kept for the day it comes back. The deal repeats —
reset, shuffle, draw 7, deal 6 — until the seven-card hand holds a Basic Pokémon, and
reports how many redraws it took:

- a transient message in the middle of the screen, *N Mulligans*, shown even when
  the count is 0;
- on solo's button, `Setup - N Mulligans` in the game log. **A room's deal writes
  nothing either way** (see [Setup](#setup)), and its manual *Mulligan* counts itself.

Three things about the real rule are deliberately absent:

- **The opponent is compensated for nothing.** The usual extra card per mulligan does
  not exist.
- **The count is only ever a log line.** Nothing is sent to the other board; the
  opponent reads the number because the line is shared like any other.
- **Solo has no manual mulligan.** No button redraws a hand there; a player who wants a
  new deal presses *Setup*, which is a new game.

## The turn

The turn is **one number for the table**, starting at 0 and shared, with `+` to count
up, `−` to count back, and `C` for the next turn.

- **`End Turn`** (button, or `Enter`) does three things: writes *End Turn* to the
  game log, moves the counter on by one, and clears the **Ability Used** stripe from
  every Pokémon *you* have in play. Clearing the stripes is deliberately silent;
  the turn is the one line worth reading.
- **A spectator sees the number and cannot change it.** Neither player's counter can
  drift from the other's, because whoever changes it says so and the other board
  adopts the number.

**The app does not know whose turn it is**, and this is the single most important
thing to know when testing: there is one counter for the table and no active-player
flag anywhere. Both players can act at any time — draw, move cards, attach, attack in
the fiction, end the turn, start the next one — and the app refuses none of it for
being out of turn.

**Ending a turn does not do any of the things a turn's end does in the real game:**

| Not done at end of turn | Where it would have to be done by hand |
| --- | --- |
| drawing for the turn | *Draw* in the deck menu, or `1`–`9` |
| attaching an energy | *Attach*, or `Q` |
| poison and burn damage | *Damage* on the Pokémon — +10, or +50 with `Alt` |
| waking up, recovering from paralysis, confusion flips, clearing special conditions | *Clear Status Effects* |
| knockouts, and taking prizes for them | *To Discard* on the Pokémon, and *To Hand* on the prize |
| checking a win | nothing — there is no win condition |

**Flip Coin** (`F`) is always available: it reports *Coin flip result: HEADS* or
*TAILS* on screen and writes `Coin flip: HEADS` to the log. It is a random number and
a line of text; nothing consumes the result.

## Actions on your own cards

### The card menu

Right-clicking any of your own cards opens one menu, on the whole **selection**
([selection.md](selection.md)). Its entries are the card's destinations:

| Entry | Key | What it does |
| --- | --- | --- |
| To Hand | `H` | to the hand |
| To Discard | `D` | to the discard, on top |
| To Bench | `B` | each card becomes its own new Pokémon slot |
| To Active | `A` | one card only: it becomes the Active Pokémon, and the outgoing Active goes to the Bench |
| To Stadium | `G` | one card only: played into the Stadium (see [The Stadium](#the-stadium)) |
| Shuffle Into Deck | `S` | into the deck, then the whole deck is shuffled |
| To Top of Deck | `T` | on top of the deck, and therefore the next card drawn |
| To Bottom of Deck | `M` | under the deck, and therefore the last card drawn |
| To Lost Zone | `L` | to the lost zone |
| To Prizes | `P` | into the prizes, face down if they are face down |
| To Table | `X` | onto the Table, for cards in play that are not Pokémon |
| Attach | `Q` | *arms* an attach: it happens when you click a Pokémon of yours |
| Evolve | `E` | *arms* an evolve: it happens when you click a Pokémon of yours |
| Switch With Top of Deck | | one card only: it goes on top of the deck and the deck's top card takes its place where it was |
| Show Details | `Space` | the full card, in a panel — no move |

The entries that would move a card to where it already is are hidden, so a menu is
never offering a move that would do nothing. *To Active*, *To Stadium*, *Switch With
Top of Deck* and *Show Details* appear only when one card is selected.

**Attach and Evolve are a two-step gesture.** Picking either one closes the menu,
paints every Pokémon of yours as a target, and waits: the card moves when you click a
Pokémon. Clicking the same entry twice, or pressing `Esc`, cancels. What the card
becomes depends on how the click was armed and, for a drag, on what is being carried:

| Gesture | Where the card goes |
| --- | --- |
| Evolve, or a drag whose cards are all Pokémon | onto the `pokemon` stack, under the top card |
| Attach, card type `trainer` | the `trainer` list — a tool |
| Attach, anything else | the `energy` list |

Note the asymmetry that falls out of that table, because it is real: **Attach accepts
any card** and files a Pokémon card as energy, while only the drag path checks the
type. Nothing checks that an evolution is legal, either — see
[Evolving and attaching](#evolving-and-attaching).

### The keyboard

Two sets of keys, and both ignore a keystroke while somebody is typing. The game
actions are `Enter` (end the turn), `C` (next turn), `F` (flip a coin) and `Z` (show or
hide Pokémon). There is no key for the deal, and in a room no button for it either: the
opening finishes by itself and deals the game (see [Setup](#setup)). The board keys are
the table in [shortcuts.md](shortcuts.md#moving-a-selection); the ones worth repeating here
are the move keys, because they are the same moves the card menu offers: `H` `D` `L`
`P` for hand, discard, lost zone and prizes; `B` `A` `G` for bench, active and
stadium; `T` `M` `S` for the top of the deck, the bottom and a shuffle back in; `Q`
`E` attach and evolve; `U` the Ability Used stripe; `X` to the Table (and, with
nothing selected, the whole Table back into your hand); `1`–`9` to draw that many;
`V` and `W` to view the deck and the Table; `Space` for a card's details; `Esc` to
drop the selection.

A shortcut is a bare key on purpose: `Ctrl+V` and `Cmd+V` belong to the browser, and
that is how a room code or a message gets pasted.

### Dragging a card

Almost every move can be made by dragging instead of by menu:

- **Onto a zone** — a card dragged onto the discard, the lost zone, the prizes, the
  deck, the hand, the Table or the Stadium moves there.
- **Onto a Pokémon** — attach or evolve, by the table above.
- **A card out of a Reveal, a Look or a Reveal Hand window** is refused by every one
  of your own zones. It is the other player's card; the drop that means something is
  on *their* half, and it is a request rather than a move (see
  [The permission to act on their card](#the-permission-to-act-on-their-card)).

Where a drag is refused, the zone does not light up, which is the app's way of
saying "not here" rather than accepting the gesture and doing nothing with it.

**A few drops are refused up front**, and the zone does not light up under the
pointer for them: a card already in the pile it is being dragged to; anything but a
single card into the Stadium; more than one card onto the Active spot; a card out of
the Stadium, or out of a window, onto a Pokémon; and anything of the far half's in
solo. These refusals are *silent* — nothing moves and nothing is logged.

### The zones and their menus

Right-clicking a zone opens that zone's own menu. The exact set is the game's action
vocabulary for that zone:

| Zone | Entries |
| --- | --- |
| Deck | Shuffle, Draw, Draw X, View All, View Top X, View Bottom X, Order Top X, Reveal Top X, Search & Order Deck, Discard Top Card, Discard Top X, Lost Zone Top Card, Prize Top Card |
| Hand | Discard All, Shuffle All Into Deck, Shuffle All to Bottom of Deck, Discard Random Card |
| Discard | View All, Shuffle All Into Deck |
| Lost Zone | View All |
| Prizes | Show Prizes / Hide Prizes, Shuffle, Shuffle All Into Deck, Shuffle All to Bottom of Deck, Inspect Prizes |
| Table | View All |
| Stadium | *none* — the Stadium has no menu; a card gets there by *To Stadium*, `G`, or a drag |
| Deck (theirs) | Reveal Top X, View Top X, Discard Top Card, Discard Top X |
| Discard, Lost Zone, Table (theirs) | no menu, but each is readable: a click on the pile opens it |
| Hand (theirs) | Reveal Hand — and in solo, the far half's own play entries |
| Prizes, Stadium (theirs) | nothing in a room: a player cannot open them. A spectator can read either player's prizes and deck; in solo every pile of the far half is playable |

Two gestures are not in a menu:

- **`Ctrl+A` over a zone selects the whole pile.** The piles answer it and the Table
  does not — the Table's cards are picked up one at a time
  ([selection.md](selection.md#select-all-and-the-one-zone-that-does-not-answer-it)).
- **A click on the deck itself** opens *View All*, which is also what `V` does.
  `G` pressed with nothing selected writes what is in the Stadium to the log rather
  than playing anything.

### The deck, and the search that shuffles it

The deck is the one zone whose *order* is part of the game, so its actions are worth
stating precisely. "The top of the deck" is always the end cards are drawn from, and
every entry that says top or bottom means it literally.

- **Draw**, **Draw X** and `1`–`9` take cards off the top into the hand and write
  *Drew N cards*. **N is what was asked for, not what was drawn**: a *Draw 5* on a
  deck of 3 draws 3 and logs `Drew 5 cards`. The same clamp applies to the prompts
  behind *Discard Top X* and *View Top X*, which silently take what there is.
- **Search & Order Deck** and **Order Top X** open the deck-order dialog: click the
  cards in the order you want them, then *Put on Top in This Order* or *Put on Bottom
  in This Order*. They are the same dialog, the second one over the top N cards only.
  **The cards never leave the deck** — this is a look plus a placement, so there is
  nothing to put back if the dialog is closed unused, and *Order Top X* does not
  shuffle. *Search & Order Deck* does shuffle the rest of the deck first, by default;
  the checkbox turns that off. Closing the dialog writes nothing.
- **The shuffle that comes with taking a card out of a deck.** A card taken out of a
  deck leaves the rest of that deck unknown, so the deck is shuffled whenever a card
  is taken out of it — a search, an *Attach* or an *Evolve* whose card came from the
  deck, and the *Close & Shuffle* button on a deck's own view. A discard pile and a
  lost zone are public and ordered, so moving a card out of those shuffles nothing.
  A menu entry that only *adds* to the deck (*To Top of Deck*, *To Bottom of Deck*,
  *Switch With Top of Deck*) does not shuffle either; *Shuffle Into Deck* does, because
  it says so.
- **The deck's log lines**: *Shuffled Deck*, *Drew N cards*, *Searched deck*, *Put N
  cards on top of Deck in order*, *Viewed deck*, *Discarded* / *Moved ... top of Deck
  to Discard*. The log never names a card that came out of a deck into a private
  zone (see [The game log](#the-game-log)).

### A pile's view, and the pickup

*View All* (deck, discard, lost zone, Table, a pile of theirs) opens the pile as a
panel you can read and select from. For **your own deck** the panel also offers four
move buttons — *Add to table*, *Add to hand*, *Add to bench*, *Add to discard pile* —
and *Close & Shuffle*; the other piles are read-and-close. A view of a deck writes
*Viewed deck*, and the deck's view is the one panel whose closure can shuffle (the
shuffle rule above).

*View Top X* and *View Bottom X* on the deck, and *Inspect Prizes*, open a different
panel: the cards are moved into **`pickup`** — a phase, not a zone — and the panel
offers *Close* (put the remaining cards back where they came from), *Shuffle Back*
(when they came from a deck), *Discard*, *To Hand* and *To Lost Zone*. They are drawn
in the panel itself while they wait — the only place a picked-up card is shown, since
`pickup` has no cell — and the diagnostics panel names them *in hand (moving)*.
*Picked up N cards from Deck* goes in the log when the cards are lifted.

**Nothing is automatic about a picked-up card.** Closing the panel puts the
remainder back; leaving them there is not a state the game has an opinion about.

## Pokémon in play

### Putting a Pokémon into play

- **From the hand or anywhere else**, by *To Bench*, *To Active*, or a drag onto
  either zone.
- Each card benched becomes **its own slot** — dropping three Pokémon on the Bench
  makes three Pokémon, not one.
- **There is no Bench limit.** The row scrolls and the game counts nothing. A
  comment in the layout mentions the five a real bench is; the code enforces none of
  it.
- **Putting a Pokémon into the Active spot benches the outgoing Active.** The app
  never refuses a promotion and never discards what it displaces.
- **The Active spot may be empty.** Benching or removing the Active leaves it empty,
  and nothing requires an Active to exist or prompts for one.

### Evolving and attaching

Evolving is a card pushed onto a Pokémon's stack: the new card is what the board
shows, the old one is still under it and is readable in the slot's details, and when
the Pokémon leaves play all of it goes together.

**No evolution rule is enforced.** Not the stage (a Stage 2 can be put on a Basic),
not the turn (a Pokémon can evolve the turn it was played), not "evolved this turn"
(a Pokémon can evolve twice in a row). Attaching enforces no count and no uniqueness
either: as many tools as you like, on any Pokémon, including a Pokémon that has just
arrived.

The log does distinguish the two: `Evolved {Charmander} into [Charmeleon] from Hand`
and `Attached [Potion] from Hand to {Charmander}`. The braces name the Pokémon in
play being referred to, the brackets name the card being moved
([terminology.md](terminology.md#conventions-that-are-not-names)).

### Damage

Damage is a number on the Pokémon, drawn as a red counter in the corner while it is
not zero, and it is entirely manual:

- **Damage / Heal** — 10 at a time, or 50 with `Alt` held. Heal stops at zero.
- **Set Damage** — a prompt for any number, for the big hits.
- On the opponent's Pokémon, only *Set Damage* — a prompt, with no Heal.
- The slot's details panel has a damage field that takes a number too.

**Damage is never compared with anything.** There is no HP on the board, no knockout
detection, no automatic discard when the number gets large, no prize taken, and no
"knocked out" state at all — a Pokémon with 400 damage on it is a Pokémon with 400
damage on it. Damage also does not clear when a Pokémon moves to the Bench or
evolves; it is cleared only by *Heal*, *Set Damage 0*, or by the Pokémon leaving
play.

### Status conditions

Five effects, on two marked corners of the card, and only ever on a Pokémon in the
**Active spot** — the menu offers them for the Active and for nothing else:

| Corner | Effects | Capacity |
| --- | --- | --- |
| left | Confusion ❓, Paralysed ⚡, Sleep 💤 | one — they replace each other |
| right | Poison 💀, Burn 🔥 | two — a Pokémon can be poisoned *and* burned |

Choosing an effect the corner already has takes it off again, so the entries are
toggles with a tick. Setting one corner never touches the other, so poisoning a
sleeping Pokémon leaves it asleep. *Clear Status Effects* takes everything off at
once.

**Nothing resolves a status condition.** No poison or burn damage at the end of a
turn, no waking up, no recovering from paralysis, no confusion flip, and no clearing
on a retreat — a status stays on the Pokémon it is on, in the spot it is in, until a
player takes it off. Moving a Pokémon to the Bench leaves its markers on it.

The statuses go in the log as `Applied [Poison] to {Pikachu}`,
`Removed [Poison] from {Pikachu}` and `Cleared status effects from {Pikachu}`.

### Ability Used

The *Ability Used* stripe is a band across a Pokémon that says its ability has been
used. The menu entry and `U` toggle it — clicking again un-uses it — and the button
in the slot's details panel only ever sets it.

**`End Turn` clears the stripe for every Pokémon you have in play.** That is the whole
of the automation: nothing checks that an ability exists, nothing stops a second use,
and nothing clears the stripe for the opponent — they clear their own, or press the
button.

Each change is logged: `[Pikachu] ability used` and `[Pikachu] ability reset`.

### The VSTAR and GX markers

The markers are the **room's format**, not a preference. A room made as **Expanded**
puts both marks on both players' halves; **Standard** and **Gym Leader Challenge** put
neither on either, because neither has a Pokemon Power zone to put them in (see
[board.md](board.md#the-format-and-the-zones-it-can-take-away)). A player joining, and
anyone watching, is told which format the room is rather than asked — so the two halves
of the table cannot disagree about what is shown, and there is no per-player marker
control in a room to disagree with. It is a token, not a card — the Pokemon Power band
holds no cards at all.

**In solo** there is no room and so no format, and *Settings → VSTAR / GX marker* is
there instead: *Off*, *VStar*, *GX*, or *Both* for a deck that runs one of each. The
control is deliberately kept for solo alone: it is the only mode where the marker is the
player's own choice rather than the room's.

Clicking your own marker says that power has been used: it dims to half opacity, loses
its glow, and writes `Used VStar` or `Used GX` to the log. Clicking it again takes
that back. The two marks on a *Both* board are independent: using one must not dim,
log, or otherwise speak for the other.

**Nothing enforces once per game.** The marker is a reminder the players keep honest,
and picking a different marker in solo resets both of its used flags. Adopting the
room's format does *not* reset them: a player joining an Expanded game already under way
announces the markers, not that the opponent's VSTAR is unused. Choosing a marker is not
an action on the game, so it writes nothing to the log; only using one does.

### The Active spot, the Bench and switching

- **Move to Active** — one Pokémon from the Bench becomes the Active, and the
  outgoing Active goes to the Bench. That is the switch, and the app performs it as
  one action.
- **Move to Bench** — the Active goes to the Bench, leaving the Active spot empty.
- **To Active / To Bench** from a card in the hand, deck, discard or Table do the
  same for a Pokémon that is not in play yet.
- **Dragging the Active onto the Bench**, or a Bench Pokémon onto the Active, works
  too.

What is **not** enforced: no retreat cost, no discarding energy to retreat, no
once-per-turn limit on switching, no "asleep or paralysed Pokémon cannot retreat", no
requirement that an Active exists, and no clearing of damage, status or attachments
when a Pokémon switches. A switch is a move of one slot between two places, and
nothing else happens.

### Taking a card out of play

The Pokémon's own menu has four ways out, and they differ in where the cards go:

| Entry | Pokémon | Energy and tools |
| --- | --- | --- |
| Return to Hand | to the hand | to the hand |
| Discard All | to the discard | to the discard |
| Return Pokémon, Discard Rest | to the hand | to the discard |
| Discard All Energy | stays in play | energy to the discard; tools stay |

The first three take every card out of the slot and the slot goes with them. And a
slot whose `pokemon` list becomes empty by any other route — the Pokémon card taken
out through the slot's details panel, say — discards whatever is still under it and
removes itself, which is the one automatic cleanup in the game.

## The Stadium

The Stadium is the one zone both players play into, in the middle band of the cell it
shares with each player's Pokémon Power band ([the two shared cells](#the-two-shared-cells)).
It holds up to two cards *per player*, and the rules are these:

- **A player may place up to two of their own cards there**, one at a time. They are
  drawn side by side, and below two a played card simply joins what is already there —
  which is the only way the pair is ever reached.
- **Playing a card while that player already has two replaces the whole of what they
  had.** Both of their cards go to their discard — not the oldest of the two — and the
  card just played is the only one of theirs left in the Stadium. So a player can never
  hold more than two, and the third play always costs them both of the first two.
- **Playing a card clears the other player's out of it**, all of them — one or two —
  into *that* player's discard. So the two players' cards are only ever in the Stadium
  together for the moment a play takes to cross the wire.

**Nothing here is refused.** A play that would replace is a play that replaces, rather
than a drop that quietly does nothing; the app answers a play with the rule instead of
with a refusal. That behaviour is intended, and it is one of the few things the app does
to one player's board because of what the other player did — the other being the damage
and the status effect a player declares on their opponent's Active Pokémon.

The client that performs it is not always the client that played the card: in a room the
cards being cleared belong to the other player, so *their* client is the one that knows
what they had in play and puts it in their discard. In solo both halves are this board,
so the answer is made locally. Either way the cards land in the discard of the player
who held them.

A Stadium card gets there by *To Stadium*, the `G` key, or a drag — the zone has no menu
of its own. `G` with nothing selected writes what is in the Stadium to the log instead
of playing anything.

## What you may do to the other player's board

In a room, right-clicking one of the opponent's Pokémon in play offers four things,
and they are the whole of the interaction:

| Entry | What it does |
| --- | --- |
| Set Damage | a prompt for a number of damage counters, applied to their Pokémon |
| Set Status Effect | the five effects, on their **Active** Pokémon only, toggling as they do on your own |
| Ping Card | points at the card: `Ping: Pikachu` in the game log, and the card glows on both boards for two seconds |
| Show All | opens their slot's details: the Pokémon, the energy, the tools, the damage, the status |

*Show Details* on the card's own name opens the card image. That is the lot: **you
cannot move, attach, evolve, discard, draw for or shuffle the other player's cards**
from their board. Their piles have no menu of their own in a room, with two
exceptions: their **deck**, whose menu offers *Reveal Top X*, *View Top X*, *Discard
Top Card* and *Discard Top X*, and their **hand**, which offers *Reveal Hand*.
Everything else of theirs is read-only — clicking their discard, lost zone or Table
opens it — and their counts are not buttons.

**A ping is the one entry offered on their other cards as well.** Right-clicking a card of
theirs in their hand, in their prizes, in their Stadium, on the table, or **attached under one
of their Pokémon** opens a menu whose only entry is *Ping Card*: the same line in the log and
the same glow — and on an attached card it is that card that is pointed at, not the Pokémon
holding it. A card this player was not shown — one in their hand, a face-down prize — is pinged
as `Ping: Hidden card` rather than by name, because the name is the *pinger's* knowledge and the
log is the whole table's. The three zones that are a pile — their deck, their discard and their
lost zone — offer nothing: each is one card on screen whatever is in it, so a ping there would
point at a position nobody can read. See [board.md](board.md#pinging-a-card).

**A left click on their Pokémon does nothing** — it is not yours to select — so their
menu is reached by right-clicking, and it is the only way in.

**Damage and status are not available on a Pokémon they have hidden.** A hidden Pokémon
is a card back that refuses the click that would open its menu, so damage and a status
effect are recorded only while the Pokémon is face up — see
[Hiding your board](#hiding-your-board). The **ping is the exception**, because it reads
nothing: a hidden Pokémon's menu is the ping alone, and it writes `Ping: Hidden card`.

Two things travel the other way — the *effects* of your play on their board:

- **Their Pokémon's damage and status are applied by their own client.** You ask, the
  owner's board writes it down, and then publishes it as its own change, which is what
  lets a spectator's mirror of them follow it. Both sides end up writing a line in the
  game log.
- **Reveal, Look and Reveal Hand** open windows in which you may act on their cards.
  That is the one place a card of theirs can be moved by you, and it is a request
  rather than a move — see below.

## Information: who can see what

### Hands, Prizes and the deck

| Zone | What the opponent sees |
| --- | --- |
| Hand | card backs, with the count |
| Deck | one card back, with the count; *View All* and *View Top X* are yours alone |
| Prizes | card backs, unless you use *Show Prizes* |
| Discard, Lost Zone | every card, face up |
| Table | every card, face up |
| Stadium | every card, face up |
| Pokémon in play | the Pokémon — or a card back while it is hidden; the damage counter, the statuses and the attached energy and tools are visible either way |

*Show Prizes* / *Hide Prizes* is shared: turning your prizes face up makes them
readable across the table, and the log then *names* your prize moves instead of
counting them. That is the same flag that decides how your prize moves read — see
[The game log](#the-game-log). It is also why the app writes `Viewed prize card` when
you look at one of your own still-face-down prizes: the look is information the
opponent is entitled to know was taken, even though the card is not named.

**The deck is never readable by the opponent.** Looking through it is your own view,
and what the opponent gets is the log line *Viewed deck* — nothing about the cards.

### Hiding your board

*Hide Pokémon* (`Z`) turns your Pokémon in play — the Active spot and the Bench —
into card backs for the other player. It is about what the other player can see, so
**solo has no Hide Pokémon button**: there is nobody to hide them from. **A room has
no button for it either** — its row is Ready and Mulligan, and then Flip Coin and End
Turn — so in both modes the action is the `Z` key, and the store and the sharing behind it are
unchanged (see `switchVisibility` in `GameActions.svelte`).

Three things about it are worth knowing, because they are not what "hide" sounds
like:

- **The card is hidden, not the slot.** The damage counter, the status markers and
  the energy and tools attached under the Pokémon are still drawn on the other
  player's half. What is a card back is the Pokémon itself.
- **A hidden Pokémon cannot be clicked by the other player.** That takes away every
  entry of theirs except the ping — *Set Damage*, *Set Status Effect* and *Show All* are
  all gone — so hiding is also how a player stops damage and status effects being
  recorded on their board at all. *Ping Card* is the one that stays, and it names
  nothing.
- **It changes how the log reads.** While your Pokémon are hidden, your bench and
  active moves are *counted* rather than named, which is the visibility rule below
  doing its work.

**Every deal hides your Pokémon for you.** In solo the *Setup* button then glows until
you press it, since the glow is the only thing on screen that says your own board is
hidden. **In a room nothing glows, and the veil is not the player's to lift while the
opening hand is still being decided**: it comes off for both of them when both have
pressed *Ready* ([Opening a room's game](#opening-a-rooms-game)). `Z` is still bound in
both modes — a player mid-game may hide or show their board whenever they like — it is
just not the way out of the opening veil.

### Reveal, Look and Reveal Hand

Three gestures let one player show cards to another, and they are one mechanism with
three audiences ([reveal.md](reveal.md)). **All three ask the cards' owner first**, because
all three read a pile that owner is not shown — see [Consent](#consent-asking-the-other-player)
below:

| Gesture | Where it is | Who is asked | Who sees the cards | How it ends |
| --- | --- | --- | --- | --- |
| **Reveal** | *Reveal Top X* on a deck of yours, or on theirs | the **other player**, when the deck is theirs; nobody when it is your own | the whole table: the revealer's own window, everyone else by a log line that names the cards | *Close & Shuffle* (shuffles that deck), or *Close* / `Esc` with no shuffle |
| **Look** | *View Top X* on the **opponent's** deck | the deck's owner | **a window on your board and nobody else's.** The room's watchers are told by a log line that names the cards; the deck's owner is told only that a look happened | *Close & Shuffle* — one ending, because a card that says "look at the top X" never puts them back untouched |
| **Reveal Hand** | *Reveal Hand* on the **opponent's** hand | the hand's owner | you, and the room's watchers — this is the one of the three whose window opens on a watcher's board; the hand's owner is told by *Revealed opponent's hand* | *Close* only — a hand has no order to shuffle |

**A window is the board of the player who took the gesture, and the table is told by
the game log.** Reveal and Look are exactly that; Reveal Hand adds the room's watchers
to the boards its window opens on.

Four things are worth knowing about all three:

- **No card moves.** All three show cards where they are. Nothing is drawn, discarded
  or rearranged by the look itself; the cards stay in the deck or hand they are in
  until somebody moves them or shuffles.
- **No window is a toggle.** None of the three writes a "this zone is visible" flag
  that has to be turned back off. They open a panel and the panel closes.
- **The hand zone stays card backs.** *Reveal Hand* opens a window over the opponent's
  hand; it does not draw their hand face up in its zone. (The old *Hand Revealed*
  toggle, whose owner showed their *own* hand, is gone: revealing a hand is now an act
  on the hand it is about.)
- **Each gesture asks, every time.** There is no remembered *Allow* and nothing that
  expires: a player searching their deck may look several times in a turn, and each of
  those is a separate reading of somebody else's pile. A *No* is per gesture for the
  same reason. What a player is told when they are asked, and what a *No* does, is
  [Consent](#consent-asking-the-other-player).

## Consent: asking the other player

Some gestures are done *to* the other player rather than by a player alone, and they cannot
happen until that player agrees. One exchange covers all of them: the asker's click is their
own consent, so there is one question and one answer, and the answer is the other player's.

| The gesture | Who is asked | What a *Yes* does |
| --- | --- | --- |
| **New Game** (the settings menu) | the other player | the room goes back to how it was when it was created ([rooms.md](rooms.md#starting-again-inside-the-same-room)) |
| **Look** — *View Top X* on their deck | the deck's owner | the look happens, and they are told only *that* it happened |
| **Reveal** — *Reveal Top X*, or a reveal of their cards | the cards' owner | the cards are shown to the table, and the log names them |
| **Reveal Hand** — on their hand | the hand's owner | the hand is shown to the player who asked and to the room's watchers |

Three things about it, and the first is the whole shape:

- **The two screens are not the same question.** The player who asked is told that the table
  is waiting and is given **nothing to press** — their click was their ask. The player being
  asked gets the only Yes/No. A spectator watching gets neither: the cards a reveal or a look
  shows are the players', and a watcher is shown what the room was shown rather than deciding
  it.
- **A *No* changes nothing and is reported back.** The asker is told, on their own screen,
  that the other player did not allow it. A request that quietly vanished would leave them
  wondering whether it was seen at all.
- **Nothing about it is enforced by the relay**, and that is deliberate: what a consent
  *permits* is a board state, a window or a log line, and each of those belongs to the client
  that would act on it. The relay does what it does for every other action — it refuses a
  spectator, and it writes the two events into the room, so a client that reloads mid-ask
  replays into the question that is still outstanding.

**A gesture of your own is not asked about.** Revealing your own deck is yours to do;
`revealTop` makes that distinction once, off the same fact it derives the deck's owner from.

### The permission to act on their card

A card in one of those windows may be acted on by the player who can see it, and this
is the only place in the game where a card crosses the table. The rules are:

- **Only inside the window.** The permission exists while the window is on screen and
  while that card is still in it. Close the window, act on the card, or replace the
  window with a new one, and the permission is gone. In a room, a card of the
  opponent's lying in a zone of theirs is *never* actionable, however it got there.
- **An action is a request, not a move.** You say where the card goes; the owner's
  board performs the move. Both boards then write the same move in the log, so the
  table reads it the same way twice.
- **Where the card may go**: the owner's discard, lost zone, prizes, Bench, Active
  spot, top or bottom of their deck, shuffled into their deck, or attached under their
  Active Pokémon.
- **Where it may not**: the owner's **hand** — a card sent to a hand could not be read
  back, and would go on glowing as actionable — and the two shared zones, the Stadium
  and the Table, which each half plays only its own cards into.
- **How many at once**: one card or several, to every destination except the Active
  spot, which takes one and refuses a batch aimed at it whole. *Attach* names one card
  and says so.

**A spectator may act on nothing out of a window.** A Reveal's and a Reveal Hand's
windows open on a watcher's board and are read-only; a Look's does not open there at
all, and the watcher reads the named log line instead.

The one gesture of this kind with no card behind it is on the opponent's deck menu:
*Discard Top Card* and *Discard Top X*, which discard from the top of their deck
without naming what is there — the acting player cannot read a face-down deck, so the
request carries a count and the owner discards that many.

### The game log

The log is the game's record, and it is the only place the app states what happened.
**Almost every line goes to the room** — both players and any spectator read the same
log — with one deliberate exception: the line a *Look* writes that names the cards
goes only to the looker and the room's watchers, because the cards it names come out
of a deck the deck's owner is not shown. In solo the log writes locally, with no chat
beside it.

**The one rule to know is what a line names, and that is a visibility rule rather than
a style.** Every move is asked whether it is public, and the answer decides whether
the log *names* the cards or *counts* them:

- `Moved [Pikachu] from Deck to Discard` — a named card, because the move is public.
- `Moved 3 cards from Deck to Hand` — a bare count, because the move is not.
- `Moved {Pikachu} into the Active Spot` — braces for a Pokémon in play being referred
  to, rather than a card being moved.

What makes a move public is the zone it touches: the discard, the lost zone, the
Stadium, the Table, and Pokémon in play are public unless the Pokémon are hidden; the
hand and the deck are private; the prizes are public exactly while they are shown.
So the same *To Discard* reads one way from the hand and another from the deck, and
a player who hides their Pokémon turns the log's named bench moves into counts. The
three bracket forms are the visible half of that rule, so a line's punctuation is
worth reading rather than skipping.

Two looks are recorded even though they move nothing, because they are the
information the other player lacks: `Viewed deck`, and `Viewed prize card` for a
prize still face down. The keyboard reaches the same looks by another route and writes
the same lines.

## The table clock

A room has a table clock under the turn counter, shown as `MM:SS` and as `HH:MM:SS`
past an hour ([timer.md](timer.md)).

- It starts at **50:00**, **paused**. Clicking it opens a prompt for minutes and
  seconds; the button beside it starts and pauses.
- **Either player may set it or start it** — it is the table's clock, not a player's,
  and both boards count down from the one shared value.
- A spectator sees the clock and none of its controls.
- Crossing **fifteen minutes** makes it glow briefly; a clock *set* below fifteen
  does not.
- **At zero it stops, `Time on the Round!` crosses the screen once, and one line goes
  in the log.** It does not end the game, does not stop the players, and does not
  forbid any move — it is a clock and a sentence.
- **Solo has no clock** — a clock against yourself is not a clock.

A board reset does not touch the clock; entering a room sets it back to 50:00.

## Room events that end a game

Several things end a game from outside the board, and the dialog names which one it
was ([rooms.md](rooms.md)):

| What happened | The dialog |
| --- | --- |
| A player left the room | *Room closed: player left the room* |
| The last player left | *Room closed: all players left the room* |
| A player vanished and did not come back within fifteen minutes | *Room closed: player did not rejoin* |
| A room nobody ever joined, after ten minutes | *Room closed: opponent did not join* |
| Nobody answered the idle prompt | *Room closed: nobody answered the idle prompt* |
| A deploy replaced the running code | the room closes, for everybody in it |

- **A player who vanishes is waited for, not walked out on**: the seat is held, the
  player who reloads or gets their network back is recognized as themselves, and the
  player still at the table sees a live countdown. The clock is not paused for it.
- **A spectator leaving never closes anything**, and a spectator is not a seat.
- **The idle prompt** asks a room where nothing has been *done* whether anybody is
  still playing. Either player can answer, and one click takes it off both screens.
  Activity means events, not presence: two players sitting on a board are the case
  worth asking about. A spectator watches the countdown and cannot answer it.
- **A board that has been idle for ten minutes drops to a slow poll**. It is not a
  game rule: the board still works, and any input or news from the other side puts
  it back on the normal beat. It is not announced on the panel — the idle prompt is
  the room's own question, asked on the same clock.
- When a room closes, **the board is emptied rather than reset** — a player who has
  walked away from a game should not still be holding that game's deck on the board.
  The log goes with it and the table clock goes back to 50:00.
- Finally, rooms expire six hours after their last event.

An honest limit: the idle prompt and the sweep ride on the players' own polls, so a
room nobody is polling is never swept. A crashed tab leaves a room the six-hour
expiry collects.

## Solo

**Play Solo** starts a game against yourself: no room, no code, and no relay at all.
Everything about the game is the same except the things that only matter with two
people ([solo.md](solo.md)):

- **Both halves are yours.** *Import Deck 2* gives the far half its own deck; *Setup*
  deals both; the far half's cards are draggable, its piles have menus, and its
  Pokémon keep the usual menu plus the moves that take them off the board.
- **There is no clock and no Hide Pokémon.**
- **The opponent's hand is face up**, and their prizes are readable.
- **A card still does not cross the table.** Each half's zones refuse the other
  half's cards, a selection cannot hold cards from both halves, and the two shared
  cells — the Table and the Stadium — each take only their own half's cards. The
  limitation is the same one a room enforces, written out rather than relied on.
- The game log stays, writing locally and without the chat beside it.

## Spectating

**Spectate Game** joins a room without taking a seat. A spectator watches and does
nothing else, and the refusal is enforced where the state changes rather than in the
menus: every state change goes through one function that refuses while spectating,
and the relay refuses any event from a spectator but chat
([board.md](board.md#spectating)).

As a consequence, a spectator sees a great deal:

- **Both hands and both sets of prizes are face up.**
- **The clock, without its controls**, and the turn counter without its ends.
- **No game actions and none of their shortcuts** — no Setup, Hide, Flip Coin, End
  Turn, and no Import Deck window: a spectator has no deck of their own to import.
- **A window's cards are its to read and not to act on.** A spectator gets the Reveal
  and Reveal Hand windows and may move nothing out of them. A **Look** is the
  exception in the other direction: its window is the looker's board alone, so a
  watcher is told what was looked at by the log's named line rather than by a panel.
- **The flip**, which swaps which player is on which half of the screen. It is a view
  change: no card moves, nothing is relayed, and the two players' boards are
  untouched.

## What the game does not enforce

The list a tester needs, and the reason this document exists. Every row is a real
Pokémon TCG rule with no implementation behind it, so a check that expects the app to
refuse something here will fail — the app is working as designed, and what it does
instead is let the players say it in the log.

| Rule | What the app does instead |
| --- | --- |
| Whose turn it is | one counter for the table, no owner; both players may act at any time |
| One energy attachment per turn | *Attach* is unlimited and uncounted |
| One Supporter, one Stadium play per turn | nothing counts them |
| Drawing for the turn | *Draw*, or `1`–`9`, whenever you like |
| Deck legality: the 4-copy rule, banned lists, ACE SPEC limits, format | only "has at least one Basic", and only for the dormant mulligan loop |
| A 60-card deck | a warning at import; Setup deals whatever is there |
| Six prizes | six are dealt; any number can be added or taken, and none is counted |
| Taking a prize for a knockout | no knockout exists; a prize is moved by hand |
| Winning and losing | no win condition, no deck-out, no bench-out, no result |
| Mulligan compensation | nothing is drawn for the opponent — and with the loop off, nothing is redrawn either |
| Evolving: stage, first turn, once per turn, "evolved this turn" | any card onto any Pokémon, any number of times |
| Retreat cost, and the once-per-turn switch | a switch is a free move between two places |
| Asleep and paralysed Pokémon cannot retreat | no restriction |
| Special conditions on the Bench | status is offered for the Active only, but a Pokémon moved to the Bench keeps its markers |
| Poison and burn damage at the end of a turn | nothing resolves status conditions at all |
| Waking up, recovering from paralysis, confusion flips | *Clear Status Effects*, by hand |
| Damage against HP, and knockouts | damage is a number with nothing to compare it to |
| Clearing damage and status when a Pokémon leaves play | they stay with the card |
| Energy and tools: how many, and of what | unlimited, uncounted, and an *Attach* of a Pokémon files it as energy |
| Hand size at the end of a turn | no hand limit anywhere |
| Searching a deck honestly | the deck is shuffled by the app; the *choice* is the player's, and the log does not name what a search found |
| A shuffled deck being random | shuffling is the browser's random number generator |
| An out-of-turn action being refused | nothing is refused for being out of turn |
| Hidden information being a guarantee | see below |
| Undo, rewind, or taking a move back | the only rewind is *Setup*, which is a new game |

**Secrecy is presentation, not a boundary.** A hidden hand is a card back drawn over a
card the client already holds: the whole board state — including the ids of every card
in both hands — is sent to both players so that each can render the other's half. The
app hides information from the *player*, not from the program, and a determined player
with developer tools can read anything. The trust model is the room code and the
member id, as [rooms.md](rooms.md) says: anyone holding both can act as that player.

**A handful of game-adjacent things are also missing** that a player might look for:
there is no "draw to hand size", no way to reveal one chosen card without a window,
no coin flip except heads-or-tails, no dice, no counters or tokens beyond the damage
counter and the VSTAR / GX marker, and no note-taking. The Table exists for the cards
that do not fit a zone.

## Checking a mechanic

The checks are catalogued, with what each is for and how to run it, in
[diagnostics.md](diagnostics.md). The ones that assert a *rule* in this document are
worth knowing by name, because a change to a mechanic usually belongs in one of them:

| Mechanic | Where it is checked |
| --- | --- |
| The six prizes, the cascade past six, and the `Viewed prize card` line | `tools/prize-check.mjs` |
| Deck order: *Order Top X*, *Search & Order Deck*, placement on top and on the bottom | `tools/deck-order-check.mjs` |
| Reveal, Look and Reveal Hand, and acting on a window's card | `tools/reveal-check.mjs` |
| Solo: the far half's zones, and a card never crossing the table | `tools/solo-check.mjs`, `tools/solo-select-check.mjs` |
| The Stadium: two cards each, a replacement, and a play clearing the other player's | `tools/browser-check.mjs` |
| The clock: two real browsers counting, and a wall clock moved underneath one | `tools/clock-check.mjs` |
| The zones' names, and that the log can judge every zone it can name | `tools/zone-vocabulary-check.mjs` |
| A room's joins, waits, leaves and closed games | `tools/relay-check.mjs` |
| The room's opening: the gate, the toss, the order, and what starts the game | `tools/game-setup-check.mjs` (the rules, read from the source), `tools/game-setup-rule-check.mjs` (the same store, run) and `tools/game-setup-browser-check.mjs` (both boards, on screen) |

**What is not checked is most of what this document says.** Nothing asserts the damage
and status rules, evolution, the turn counter, the visibility rules, the mulligan
loop or the deck's legality — those are read from the code, and a change to one of
them is a change no check will notice. **The auto-mulligan has one check, and it is
about the feature being absent**: `tools/browser-check.mjs --only panel` asserts what
the settings menu holds, in solo and in a room, and *Mulligans* is not in either list.
`tools/render-check.mjs` is the guard of last resort: it renders the board in the
states a person reaches, so a component that throws on mount fails the build's own
check rather than only a browser.

`tools/docs-check.mjs`, which CI runs, keeps this document's own links resolving
including the ones between its sections.
