# Keyboard shortcuts

Every key the board answers, in one place. There is no shortcut-key settings screen
and no cheat sheet drawn inside the app: this file is the sheet, and the menus and
buttons are how a player finds a key on their own — each entry of the card menu
carries the shortcut it stands for (`shortcut="d"` in `CardMenu.svelte`), the deck's
menu the same, and the buttons that have one carry it as a `title`.

Two document-level listeners do the work, and the whole of the binding lives in
them:

| Listener | File | Keys |
| --- | --- | --- |
| the board | `src/lib/play/Board.svelte` | the digits, the letters, `Space`, `Esc` |
| the game actions | `src/lib/play/GameActions.svelte` | `Enter`, `C`, `F`, `Z` |

## Moving a selection

Most of these act on what is selected. The ones that are also a card menu entry are
the menu entry, key for key, which is what the menu prints beside each.

| Key | Does |
| --- | --- |
| `1`–`9` | draw that many cards |
| `Alt`+`1`–`9` | look at that many from the top of the deck (the deck menu's *View Top X*) |
| `D` | the selection to the discard |
| `H` | the selection to the hand |
| `L` | the selection to the lost zone — only where the board has one |
| `P` | the selection to the prizes |
| `B` | the selected Pokémon to the bench |
| `A` | the selected Pokémon to the active spot |
| `G` | the selection to the stadium — or, with nothing selected, what is in the stadium already |
| `S` | shuffle: the selection into the deck, or with nothing selected the deck itself |
| `T` | the selection to the top of the deck |
| `M` | the selection to the bottom of the deck |
| `Q` | attach with the selected card |
| `E` | evolve with the selected card |
| `U` | mark the selected Pokémon's ability used, or take that back |
| `X` | the selection to the table; with nothing selected, the whole table back into the hand |
| `Esc` | clear the selection |

**`L` goes wherever the Lost Zone goes**, which is a property of the room's format: a
Standard room draws no Lost Zone, so it has no *To Lost Zone* entry and the key does
nothing. Without that guard the key would be the one way left to send a card into a
zone nothing draws
([board.md](board.md#the-format-and-the-zones-it-can-take-away)).

**Nothing crosses the table.** A card moves to the other half only by being dragged
there, or by being put on the table first. In solo both halves are one person's, so
every key that moves a selection first asks which half the selection came from — the
same key moves the far half's own cards into the far half's own zones
([solo.md](solo.md)).

## Looking at cards

| Key | Does |
| --- | --- |
| `Space` | the selected card's details, and again to put them away |
| `V` | View All of the deck |
| `W` | View All of the table |
| `Alt`+`1`–`9` | the top *n* of the deck, above |

These are the menu entries they stand for, and that includes what those entries write
in the log. `Space` is exactly what clicking the card's name at the top of its menu
does: a face-down prize read this way is recorded as *Viewed prize card*, and one
already face up is not — it is readable across the table. `V` is *Viewed deck*, the
one pile the opponent cannot see. The keyboard reaching a look by another route is not
a reason for the look to go unrecorded; the version of `V` that opened the same panel
and wrote nothing is in [gotchas.md](gotchas.md) (search for *a shortcut that
re-implements a menu entry*).

## Game actions

A spectator gets none of these: the row is not rendered and the keys are not bound, so
End Turn and Flip Coin are not one keystroke away for somebody who is only watching
([board.md](board.md#spectating)).

| Key | Does |
| --- | --- |
| `Enter` | end the turn |
| `C` | start the next turn |
| `F` | flip a coin |
| `Z` | hide or show Pokémon |

**The deal has no key.** Setting the game up is *Setup* in solo, and **a room has no button
for it at all** — its opening finishes by itself and deals the game. The `N` key and its
*Start new game?* confirmation are gone. Starting again over a game in progress is *New Game*
in the settings menu, which asks the other player
([mechanics.md](mechanics.md#setup)).

In a **room**, `F` and `Z` have no button while the opening is under way: *Flip Coin* and
*End Turn* arrive under the log once the game starts, so a room has no *Flip Coin* button
until there is a game to flip for. **There is no *Game Setup* button at all**: the opening
starts by itself once both players have imported a deck
([mechanics.md](mechanics.md#opening-a-rooms-game)). `Z` never
gets a button in a room — hiding is a keyboard action there — and `C` is the turn row's `+`.
**Solo** keeps the whole row throughout — Setup, Flip Coin and End Turn — with `Z` and its
button both gone, because both halves are one person's and there is nobody to hide from.

**The row fills up once during a room's game**: *Flip Coin* and *End Turn* arrive under the
log when the game starts. The two controls of the opening — *Ready* and *Mulligan* — are
**not on this row at all**: they are a prompt in the middle of the window, over the hand they
are about, and they go when both players have pressed *Ready*
([mechanics.md](mechanics.md#opening-a-rooms-game)). Nothing in the opening is on a
key — it waits on the two decks rather than on a press, and a coin toss and an opening hand
are decisions rather than shortcuts, so the dialog takes the screen while it asks.

`Enter` is also how a focused button is pressed, so it ends the turn only when the
focus is not on one.

## With a modifier, and with the mouse

These are gestures rather than shortcuts of the board, and the difference matters: a
chord belongs to the browser and the clipboard, so no board shortcut is built on one.

| Gesture | Does |
| --- | --- |
| `Ctrl`/`Cmd`-click a card | add it to the selection instead of replacing it |
| `Ctrl`/`Cmd`+`A` | the whole pile the pointer is over |
| `Shift`-click a Pokémon in play | the slot's own details |
| `Alt`/`Option`-click a card or a Pokémon | its details, the same look as `Space` |
| `Alt`+click damage or heal in a slot's menu | 50 rather than 10 |
| double-click a card | its details, wherever the card is — the look `Space` gives a selected card |
| right-click a card | select it — replacing the selection, where a Ctrl-click adds — then open its menu |

The 50 is the player's **own** slot menu, which has the damage controls; the far half's
menu offers *Set Damage* instead, so there is no modifier to remember there.

A **card of the other player's** takes the same reads and not the same moves: it can be
double-clicked or Alt-clicked for its details wherever it can be read at all, and
right-clicked to *Ping Card*, but outside a Reveal or Look window it cannot be picked
up ([reveal.md](reveal.md)).

**`Ctrl+A` is not in the board's table, and it is not a board shortcut.** It is a
pile's own gesture, listened for on the zone itself (`ctrlA` in
`src/lib/actions/customEvents.js`), so the zone has to have the focus — a click on it
is enough — and it fills the selection with the whole pile. Every pile answers it and
the table does not, on either half, because the table's cards are picked up one at a
time (see
[selection.md](selection.md#select-all-and-the-one-zone-that-does-not-answer-it)).
The bench answers it too, and so does the grid of every panel that shows a pile — both
inspections, Reveal, Look, the selection window and Deck Order, where it takes
everything on show, top of the deck first. Adding to a selection inside one of those
panels is the same chord as on the board: `Ctrl`/`Cmd`-click.

## What does not reach the board

Both listeners refuse while somebody is typing. `isTyping`
(`src/lib/util/typing.js`) sees an `<input>`, a `<textarea>`, a `<select>` or anything
`contenteditable`, so a room code, an imported deck, a chat message and the timer's
minutes and seconds are all just text: the digits in a timer field do not draw cards as
they are typed ([timer.md](timer.md)).

On a **button** only `Enter` and `Space` belong to the button, since that is how it is
pressed. Clicking a button leaves it focused, so `Enter` right after a click presses
that button rather than ending the turn — every other key still reaches the board from
there, so `D` discards and `V` opens the deck anyway.

`Esc` is the one key with more than one job: on the board it clears the selection, and
it closes whichever panel is open — `Modal.svelte` and the `escape` action in
`customEvents.js` each listen for it, which is also why a panel closed by Escape or by
a click outside leaves its own flag set rather than going through its close button. It
is deliberately left alone while a selection is being dragged out of the deck: that
drag is cancelled with `V`, not `Esc`. The room and timer prompts take `Enter` to
confirm and `Esc` to cancel, and the room prompt refuses `Esc` while its request is in
flight.

No board shortcut takes a modifier, on purpose. `Ctrl+V` / `Cmd+V` pastes a room code
or a message, so View All is `V` and only `V` — a paste that opened the deck on top of
itself would be the one thing a paste must not do ([timer.md](timer.md)).

The digit keys are read from `e.code` rather than the character the key produced, so a
layout or a modifier that turns `1` into something else still draws one card.

One side effect is worth knowing: the relay counts **any** key as activity, on a
capture-phase listener in `src/lib/relay/client.js`. Pressing a key is somebody looking
at the board, so it keeps the room off the idle prompt on its own.

## If a shortcut goes missing

A key that re-implements a menu entry is a second copy of that entry's rule, and the
copy is the one that goes stale — `V` used to open the deck without writing the log
line its menu entry writes. The fix, and the tell to look for, is in
[gotchas.md](gotchas.md). A synthetic `keydown` with no `code` throws inside the
board's own handler, which is a trap for tests rather than players (also in
[gotchas.md](gotchas.md)).
