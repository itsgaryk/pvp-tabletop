# Solo mode

**Play Solo** on the main menu starts a game against yourself: no room, no code
and no relay, so it costs **no store commands at all** — the browser's socket is
never connected. Leaving goes back to the main menu.

The game log stays, writing locally instead of relaying, and without the Game /
Chat tabs or the message box above it — there is nobody to talk to. The timer and
Hide Pokémon are hidden too: one is a clock against yourself, the other is about
what the other player can see. The spectator-style **flip** is available, and
swaps your own board with the other side's.

Both halves of the board are yours, so the second one is playable the same way
the first is:

- **Edit Deck 2**, beside **Edit Deck**, gives the opponent's half its own deck
  through the same panel, the same import. Both panels start closed; the button is
  how you ask for one.
- **Setup** sets up both sides — shuffle, seven cards, six prizes each.
- The opponent's hand is face up, and its piles have menus: draw from their deck
  (Draw, Draw X, Draw 7, Shuffle), put the top card of their hand into their
  Active or onto their Bench, attach it to their Active, discard it or shuffle it
  back in.
- Their Pokémon keep the usual menu (damage, status, target) plus, in solo, move
  it to the Bench or the Active spot, or send it and everything under it to their
  discard.

The opponent's half is laid out with the same `upright` class a spectator's top
half uses — same bar and count placement, cards turned back up.

## The two halves are separate boards

Both halves are played by one person, and everything on the far half is draggable
there — which is why the rule that keeps them apart has to be said twice. **A card
does not cross the table**: whatever the player cannot do to the opponent's half,
the opponent cannot do to the player's, and the limitation is the same on both
sides. A card dragged out of the opponent's hand used to go into the player's own
hand, discard, deck, prizes or Stadium, and one of their Pokémon in play could be
dropped onto the player's Active and be promoted into it with everything under it.

Each half's own zones refuse the other half's cards, and the check has to be the
right one for what is being dragged: a *card* carries the pile it came from as its
source and is answered by `onOpponentHalf(source)`, while a *Pokémon in play*
carries the word `'slot'` and is only ever identified by the slot itself, through
`onOpponentSlot(draggedCard)`. Asking the first about `'slot'` answers "not a pile
of the far half's", which is exactly how a far Pokémon got into the player's
Active whenever the drop landed on the zone rather than on the Pokémon in it.

**The two shared zones are where that needs care**, because both halves play into
the same cell. The table and the Stadium each accept *their own* half's cards:

- A card played into the shared cell lands on the half that played it. In solo the
  player's table is drawn over the far half's while anything is being dragged, so
  the player's card lands on the player's table; the far half's Stadium lies under
  the player's and takes the far half's cards when the player's is empty, which is
  the mirror of the near one. **And the near one stands aside for a card of the far
  half's** (`.play.far-drag`, and the same class on the Stadium): the two shared cells
  are the only place it matters, because a half's own table or Stadium lies under the
  other's in the one cell, and a drop that stopped at the wrong one was the far half
  unable to play into its own while the player had anything in theirs.
- Nor can either half take the other's card out of a shared zone: a card on the
  player's table stays there when the opponent's table is the drop target, and the
  other way round.
- Each half still moves its own out — by dragging it, by its own menu, or by the
  board's keys, which ask `farSelected()` before anything else.

`node tools/solo-select-check.mjs` reads all of this: eighteen checks that drag a
card of one half at every zone of the other and assert that nothing on either board
moved, plus the shared-zone cases and a control that the far half can still move
its own card out of the table.
