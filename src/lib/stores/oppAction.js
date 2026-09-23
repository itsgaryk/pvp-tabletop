import { logMove } from './logger.js'
import { share, react, spectating } from './connection.js'
import {
   selectCard, resetSelection, moveSelection, toBench, toActive, toStadium,
   findSlot, cardSelection,
   hand as myHand, discard as myDiscard, deck as myDeck, lz as myLz,
   prizes as myPrizes, table as myTable, stadium as myStadium,
   active as myActive
} from './player.js'
import { defaultOpponent } from './opponent.js'
import { slot } from './custom/cards.js'
import { isActionable } from './reveal.js'

/*
   Acting on the *other* player's card.

   A Reveal or a Look hands a player cards that belong to the opponent, and the
   whole point of both is that those cards can then be acted on - moved to that
   player's discard, put into play as one of their Pokemon, sent to their hand.
   The property that allows it is the batch (see reveal.js); this module is what
   the property is *for*.

   It is for a room and a room only. In solo both halves are the same person, so
   there is no "the other player's card" to be shown one - and the menus that
   offer these actions are not rendered there (see opponent/Deck.svelte and
   opponent/Card.svelte). A spectator is refused here as well as at the relay:
   `share()` is the enforcement, and this is the same rule at the other end.

   -------------------------------------------------------------------------
   Why an action is a request and not a move
   -------------------------------------------------------------------------

   A board is authoritative for its own half: a player moves their own cards and
   tells the room, and the other client's mirror follows the event. A card of the
   opponent's is the one thing that breaks that rule, because the player acting on
   it does not own the pile it is in. So the two halves are split deliberately:

      1. the player's client sends `oppCardAction` - which card, and where to
      2. the *owner's* client performs the move on its own board, and reports it
         with the ordinary events (`cardsMoved`, `cardsBenched`, `cardsAttached`,
         …), exactly as if its owner had done it
      3. the acting player's board follows those events through its mirror, so the
         card lands there the same way every other move does

   The alternative - the acting player mutating its own mirror and telling the
   owner to catch up - is the shape that rots. A mirror is a copy, and a copy that
   is authoritative for one gesture is a second source of truth for the board: it
   would need an event per zone, a rule for the card having gone by the time the
   owner looks, and a way to tell "my mirror is behind" from "my mirror is wrong".
   None of that exists here and none of it is needed, because the owner's own
   events are already the whole protocol for a card moving.

   -------------------------------------------------------------------------
   What the acting player does while it waits
   -------------------------------------------------------------------------

   It takes the card out of the pile it was in, so the action reads as done at
   once rather than as a card that sits there for a round trip. That is the one
   local mutation here, it is a removal from a pile the player was just shown, and
   it is guarded: `pile.remove` takes the *last* card when the one asked for is
   not in it (see the note over `slots().remove` in custom/cards.js), so a card
   that has already gone must never be passed to it.

   The card is therefore briefly absent from the acting board and not yet in its
   destination. The owner's events - the next thing to arrive - put it where it
   went. If the owner never answers (they closed the tab between the two), the
   card is missing from the acting board's view until the next full board state,
   which is what any lost event is anyway.
*/

/*
   Where an opponent's card can be sent.

   The values are the store's own zone names wherever a zone is what is meant, so
   a target is the same string a `cardsMoved` event carries and the two boards
   cannot disagree about what a zone is called (see docs/terminology.md). The four
   entries that are not a zone name - a deck end, a shuffle, and the two that put
   a card into play - are the four gestures a zone name cannot express.
*/
export const OPP_ACTIONS = {
   HAND: 'hand',
   DISCARD: 'discard',
   STADIUM: 'stadium',
   LZ: 'lz',
   PRIZES: 'prizes',
   TABLE: 'table',
   DECK_TOP: 'deckTop',
   DECK_BOTTOM: 'deckBottom',
   DECK_SHUFFLE: 'deckShuffle',
   BENCH: 'bench',
   ACTIVE: 'active',
   ATTACH: 'attach',
   /*
      The top of the owner's deck, discarded without naming a card. It is the one entry
      with no card behind it: *Discard Top Card* is one card and *Discard Top X* is a
      specified number of them, and both are gestures about a *deck* rather than about a
      card - the acting board cannot name what is on top of a deck it cannot read - so the
      request carries a count instead of ids. See `discardTopOfTheirDeck`.
   */
   DISCARD_TOP: 'discardTop'
}

/*
   The zone an action reads as in the log line the *acting* player writes.

   The owner writes the line that names the card, from its own board's move - so
   this is the acting side's copy, and it is what makes "Moved [Pikachu] from Deck
   to Discard" appear on both boards for the same gesture. The two entries that
   put a card into play read as the zone it lands in rather than as a slot.
*/
function targetZone (action) {
   switch (action) {
      case OPP_ACTIONS.DECK_TOP:
      case OPP_ACTIONS.DECK_BOTTOM:
      case OPP_ACTIONS.DECK_SHUFFLE:
         return 'deck'
      case OPP_ACTIONS.BENCH:
      case OPP_ACTIONS.ATTACH:
         return 'bench'
      default:
         return action
   }
}

/*
   A pile of the **other half** by the name the wire uses, which is the table the
   acting player reads: their mirror of the other board. The values are the mirror's
   own stores, so a card is taken out of the copy this board can see.
*/
function oppPile (name) {
   const piles = {
      hand: defaultOpponent.hand,
      deck: defaultOpponent.deck,
      discard: defaultOpponent.discard,
      lz: defaultOpponent.lz,
      prizes: defaultOpponent.prizes,
      table: defaultOpponent.table,
      stadium: defaultOpponent.stadium
   }

   return piles[name] || null
}

/*
   A pile of the **owner's own board**, by the same name.

   This is the other half of `oppPile` and it is not the same table: a request arrives
   at the card's *owner*, whose own zones are this board's, not the mirror's. One
   function for both ends was the bug this pair exists to fix - the owner looked the
   card up in its mirror of the *other* player's deck, found a card with the same id,
   removed it from the wrong board (or from none), and the log still said the move had
   happened. Nothing threw, and the card landed nowhere.

   The two boards are two tables of stores, and a name on the wire means a different
   store depending on which end is reading it - the same trap as `mine`/`theirs` in
   reveal.js, one layer down.
*/
function ownPile (name) {
   const piles = {
      hand: myHand,
      deck: myDeck,
      discard: myDiscard,
      lz: myLz,
      prizes: myPrizes,
      table: myTable,
      stadium: myStadium
   }

   return piles[name] || null
}

/*
   The pile a card is in, on a given board. A board's `piles()` is the same list
   for either half (`board()` builds it), so this is the one answer to "which pile
   holds this card" - asked of the board rather than remembered, for the reason
   docs/selection.md gives.
*/
function pileOf (card, lists) {
   return lists.find((p) => p.get().includes(card)) || null
}

/*
   Whether a card may be acted on as the other player's, which is the whole of the
   rule: it is one of the cards a Reveal or a Look is showing. `reveal.js` owns
   that answer, and this is the one place a board gesture asks for it.
*/
export function canActOn (card) {
   return isActionable(card)
}

/*
   The action a drop onto one of the far half's zones means, by the pile it landed on.

   The reverse of `optimisticTarget`, and the two are written out separately on purpose:
   one answers "where does this action put the card", the other "what does dropping it
   here mean", and a single table read in both directions is how a zone ends up mapped
   to the wrong entry. The names compared are the stores' own, so a drop needs no
   translation - the `2` suffix on a class is the only difference between the halves
   (see board.md).
*/
export function actionForPile (pile) {
   const o = defaultOpponent

   if (pile === o.bench) return OPP_ACTIONS.BENCH
   if (pile === o.discard) return OPP_ACTIONS.DISCARD
   if (pile === o.lz) return OPP_ACTIONS.LZ
   if (pile === o.prizes) return OPP_ACTIONS.PRIZES
   if (pile === o.hand) return OPP_ACTIONS.HAND
   if (pile === o.table) return OPP_ACTIONS.TABLE
   if (pile === o.stadium) return OPP_ACTIONS.STADIUM
   if (pile === o.deck) return OPP_ACTIONS.DECK_TOP

   return null
}

/*
   Whether a drag of a card out of a Reveal or a Look window is what is being dropped.

   `$source` for one of those cards is the *batch* it was picked up from - the window
   hands its cards a batch rather than a pile (see reveal.js) - and a batch is not one of
   the board's own lists, which is the same test `board/Card.svelte` uses to tell a card
   in a window from a card on the board.
*/
export function isDraggingRevealed (dragged, source) {
   if (!dragged || !source || typeof source !== 'object') return false
   if (defaultOpponent.piles().includes(source)) return false
   return canActOn(dragged)
}

/*
   A card dragged out of a Reveal or a Look window and dropped on one of the far half's
   zones: the same request a menu entry makes, taken with the mouse instead.

   The drag is the gesture a player already reaches for - a card of their own, onto the
   place it goes - and a window's cards are the one kind of card that is not on the
   board, so dropping one is how a player expects to place it. What it does *not* do
   differently from the menu is move the card: the same `opponentCardAction`, the same
   request to the owner, the same optimistic move, and the same refusal when the card is
   not this player's to act on.

   Returns whether the drop was this gesture's, so a caller can fall through to its own
   handling - the far half's normal drop, or solo's - rather than swallowing it.
*/
export function dropRevealedCard (target, dragged, source) {
   if (!isDraggingRevealed(dragged, source)) return false

   const action = actionForPile(target)
   if (!action) return false

   opponentCardAction(dragged, action, { pile: source })
   return true
}

/*
   *Discard Top Card* and *Discard Top X* on the **other** player's deck: the top card, or
   a chosen number of them, off the top of a deck this board cannot read, into its
   owner's discard.

   It is the one request that names no cards, and that is not a shortcut: the cards on top
   of the owner's deck are the one thing here this board is not entitled to know, and a
   mirror's copy of a deck is not the authority for what is on top of it. A request that
   named ids would be guessing at cards it was never shown.

   ---------------------------------------------------------------------------
   Why nothing is moved here, unlike every other entry
   ---------------------------------------------------------------------------
   Every other action in this module takes the card off the acting board's mirror at once,
   so the gesture reads as done rather than as a card that sits still for a round trip.
   This one deliberately does not, and the reason is a race that the others cannot have:
   the *owner's* events for this action and this board's own optimistic move are removals
   from the same pile, and the mirror is not authoritative for what is on top of it.

   Whenever an earlier event is still in flight - a discard one click ago, a card drawn on
   the other board - the mirror's top n are not the owner's top n. Moving the mirror's
   then leaves the two boards permanently short of each other: the owner removes its own n,
   this board has already removed n different cards, and nothing reconciles the difference
   because the deck's order is private and a full board state is the only thing that
   restores it. `tools/reveal-check.mjs` caught exactly that, one card past the end.

   So the deck gets shorter when the owner's own event says so, which is what a mirror is
   for. The cost is the length of one round trip on a number in the corner of a pile
   nobody is reading, against a board that can end up disagreeing about how many cards are
   in a deck. The other entries take that trade the other way because the card they move is
   one this board was *shown* - it is in a batch, and the batch is the permission.
*/
export function discardTopOfTheirDeck (count = 1) {
   if (spectating.get()) return false

   const n = Math.min(Math.max(1, Math.floor(count) || 1), defaultOpponent.deck.get().length)
   if (!n) return false

   share('oppCardAction', { from: 'deck', action: OPP_ACTIONS.DISCARD_TOP, count: n })

   trace.sent += n
   trace.sentTo = { count: n, action: OPP_ACTIONS.DISCARD_TOP, from: 'deck' }

   return true
}

/*
   Take a card out of the pile it is in, and leave the pile alone when it does not
   hold it.

   This is a function rather than a bare `remove` because `pile.remove` is not a
   no-op on a card that is not there: it is `v.splice(v.indexOf(card), 1)`, and
   `indexOf` on a missing card is `-1`, which removes the *last* card instead. A
   mirror can legitimately be missing the card, so the guard is the difference
   between "nothing happens" and "a card the player did not touch disappears".
*/
function takeFrom (pile, card) {
   if (!pile || !pile.get().includes(card)) return false
   pile.remove(card)
   return true
}

/*
   A trace of the last request one board sent and the last one it answered, for
   `tools/reveal-check.mjs` through `$lib/util/dev-debug.js`.

   This flow leaves a mark everywhere it *succeeds* - a log line, a card that moved,
   a window that shrank - and nothing at all where it is refused, which is what makes
   a refusal the expensive half to find: the acting board has already written its line
   and moved on, so everything on that screen says the move happened.
*/
export const trace = { sent: 0, answered: 0, sentTo: null, last: null }

/* --------------------------------------------------------------- the player -- */

/*
   The player's move: a request to the owner *per card*, and an optimistic move here so
   the cards do not sit still for a round trip.

   `cards` is one card or a list of them - the selection a Reveal or a Look window is
   holding - `action` is one of OPP_ACTIONS, and `pile` is what the cards were handed
   with: the batch a window gave them, or one of the far half's own lists where they are
   on the board.

   ---------------------------------------------------------------------------
   Why one event per card
   ---------------------------------------------------------------------------

   A selection can hold cards from more than one pile - the window's batch and, on the
   board behind it, any of the far half's zones - and a `cardsMoved`-style event names
   **one** `from` and one `to` (see docs/selection.md). Same reasoning here: the request
   names the pile the card is in, so a selection that came from two of them has to travel
   as two requests. It is also what the log reads as - one line per pile, naming what
   left it - which is the shape the board's own moves have.

   ---------------------------------------------------------------------------
   Why it moves here at all, and how that is safe now
   ---------------------------------------------------------------------------

   The relay's round trip is the whole of what a player sees as "the action is slow":
   measured on this host, a plain `cardsMoved` between two boards takes about 1.7s and
   an `oppCardAction` about 1.9s, so the delay is the transport rather than anything
   this module does. Waiting for it means the card sits where it was for two seconds
   after the player pressed the button.

   So the move is applied here at once, on the acting board's **mirror**, and the
   owner's own events replace it when they arrive - which is the same end state by the
   same path a plain move takes.

   This is the second attempt at that, and the first one is worth remembering: it moved
   the card *out* of the source and never into the destination, on the theory that the
   owner's reply would place it. When the owner could not find the card - because this
   board is a mirror and the card it removed was not the one the owner held - **the card
   landed nowhere at all** while both logs said it had moved. The difference now is that
   this is a *complete* move: it lands where the owner's event will land it, so the
   owner's event is a confirmation rather than the other half of one.

   `optimisticMove` is where that is done, and it says which actions it refuses to guess
   at and why.
*/
export function opponentCardAction (cards, action, options = {}) {
   if (spectating.get()) return false
   if (!Object.values(OPP_ACTIONS).includes(action)) return false

   const list = (Array.isArray(cards) ? cards : [ cards ]).filter(Boolean)
   if (!list.length || !list.every(canActOn)) return false

   /*
      Where the cards are *said* to be. The batch's own pile name is preferred when a
      window handed one over, because that is the deck the player was shown - so the
      request names the pile the owner's board will recognise even if this board's mirror
      has drifted. The list is grouped by that name, because each request carries one.
   */
   const named = options.pile?.name || null
   const groups = new Map()

   for (const card of list) {
      const pile = (named && oppPile(named)) || pileOf(card, defaultOpponent.piles())
      if (!pile) continue
      if (!groups.has(pile)) groups.set(pile, [])
      groups.get(pile).push(card)
   }

   if (!groups.size) return false

   let sent = 0

   for (const [ pile, group] of groups) {
      /*
         The cards as *this* board holds them: an object rather than the id, because the
         optimistic move needs the reference the pile actually holds, and a batch's cards
         are the same objects the mirror's deck holds only by id (`gather` in
         reveal.js says why).
      */
      const held = group
         .map((card) => pile.get().find((c) => c._id === card._id))
         .filter(Boolean)

      if (!held.length) continue

      optimisticMove(held, pile, action)

      const ids = held.map((card) => card._id)

      share('oppCardAction', {
         cards: ids,
         from: pile.name,
         action,
         slotId: options.slotId || null
      })

      logMove(held, pile.name, targetZone(action), { bottom: action === OPP_ACTIONS.DECK_BOTTOM })

      sent += held.length
   }

   if (!sent) return false

   trace.sent += sent
   trace.sentTo = { count: sent, action, from: [ ...groups.keys() ].map((p) => p.name).join('+') }

   resetSelection()
   return true
}

/*
   Move the cards on this board's mirror at once, the way the owner's events will.

   It is deliberately the *same* shape as what `opponent.js` does with an incoming
   event - take the card out of the source pile and put it in the destination - so that
   the owner's event, when it lands, is confirmation rather than a second move.

   ---------------------------------------------------------------------------
   Into play is the hard half, and it is done here too
   ---------------------------------------------------------------------------

   The first version of this left Bench, Active, Attach and Stadium to the round trip,
   on the theory that the acting board could not invent the *slot* a Pokemon in play
   becomes. That is true, and it is not a reason to wait: the player who sent a card to
   their opponent's Bench watched it sit in place for two seconds while *To Discard* and
   *To Hand*, one line away in the same menu, were instant. The complaint was exact -
   "To Bench, To Active and To Stadium still take a couple of seconds".

   What it does now is the same move the owner will make, with a slot id of this
   board's own. That leaves one seam, and it is handled rather than hoped about: the
   owner's event arrives carrying **its** slot id, and `opponent.js`'s handler adds a
   slot for it without looking for the card - so an optimistic slot would become a
   second Pokemon holding the same card. `dedupeSlot` is what closes it: the mirror's
   copy of the card is taken out before the owner's slot is added, and the owner's own
   events stay the authority for what is on the board.

   *Attach* is still left to the round trip, and it is the one that has to be: the card
   goes *under* a Pokemon of theirs which this board can see but whose attachments are
   the owner's to order, and "put this under your Active" has no shape on this side that
   the owner's `cardsAttached` would confirm rather than duplicate.
*/
function optimisticMove (cards, source, action) {
   let moved = false

   for (const card of cards) {
      if (!takeFrom(source, card)) continue

      /*
         Nowhere this board can put it yet - *Attach*. The card has still left the pile
         it was in, because the owner is about to move it and the window should not go on
         offering a card that has been sent somewhere. If the owner never answers it is
         missing from the mirror until the next full board state, which is what every
         lost event costs here (see the note above).
      */
      if (!placeOptimistically(card, action, source)) {
         moved = true
         continue
      }

      moved = true
   }

   return moved
}

/*
   Put one card where the owner's event will put it, on this board's mirror.

   Returns whether it landed anywhere. The two into-play zones get a *slot* rather than
   a pile entry, because that is what a Pokemon in play is, and the slot is made with
   the same `slot()` helper the mirror's own event handler uses - so the card drawn here
   is the shape every other card in play has, down to the piles its energy and tools
   live in.
*/
function placeOptimistically (card, action, source) {
   switch (action) {
      case OPP_ACTIONS.BENCH: {
         dedupeSlot(card)
         defaultOpponent.bench.add(slot(card))
         return true
      }

      case OPP_ACTIONS.ACTIVE: {
         dedupeSlot(card)
         const current = defaultOpponent.active.get()
         defaultOpponent.active.set(slot(card))
         /* the owner's own move sends the outgoing Active to the Bench - `toActive` */
         if (current) defaultOpponent.bench.add(current)
         return true
      }

      default: {
         const target = optimisticTarget(action)
         if (!target || target === source) return false

         if (action === OPP_ACTIONS.DECK_BOTTOM) target.unshift(card)
         else target.push(card)
         return true
      }
   }
}

/*
   Take a mirror's copy of a card out of play, if it is in play.

   The seam the optimistic move opens, and the whole of what closes it: this board put
   the card on the Bench with an id of its own, and the owner's `cardsBenched` then
   arrives carrying a *different* id for the same card. `opponent.js`'s handler adds
   that slot without looking for the card first, so without this the board ends up with
   two Pokemon holding one card - a phantom sitting beside the real one until the next
   full board state. Called with `(card)` it clears the way for a placement; called with
   `(card, id)` it does nothing when the slot already there is the owner's own, which is
   what makes a replayed event a no-op rather than a second removal.
*/
function dedupeSlot (card, keepId = null) {
   const bench = defaultOpponent.bench
   for (const s of [ ...bench.get() ]) {
      if (s.id !== keepId && holdsCard(s, card)) bench.remove(s)
   }

   const active = defaultOpponent.active.get()
   if (active && active.id !== keepId && holdsCard(active, card)) defaultOpponent.active.set(null)
}

function holdsCard (s, card) {
   return s.pokemon.get().some((c) => c._id === card._id)
}

/* the pile of the far half an action lands in, for the ones that are a pile at all */
function optimisticTarget (action) {
   switch (action) {
      case OPP_ACTIONS.HAND:
      case OPP_ACTIONS.DISCARD:
      case OPP_ACTIONS.LZ:
      case OPP_ACTIONS.PRIZES:
      case OPP_ACTIONS.TABLE:
      case OPP_ACTIONS.STADIUM:
      case OPP_ACTIONS.DECK_TOP:
      case OPP_ACTIONS.DECK_BOTTOM:
      case OPP_ACTIONS.DECK_SHUFFLE:
         return oppPile(action === OPP_ACTIONS.DECK_TOP || action === OPP_ACTIONS.DECK_BOTTOM || action === OPP_ACTIONS.DECK_SHUFFLE ? 'deck' : action)
      default:
         /* Bench, Active, Attach and anything new - see `placeOptimistically` */
         return null
   }
}

/* ---------------------------------------------------------------- the owner -- */

/*
   The move the owner performs, on its own board.

   Everything here is the owner's own board and the owner's own cards, so it uses
   the ordinary functions - `moveSelection`, `toBench`, `toActive`, `toStadium` -
   with the board's one selection pointed at the one card. That is deliberate: the
   events, the log line and what the opponent's mirror does with them are then
   *the same* as if the owner had made the move, because it is the same code.

   `from` is the pile the request names and the cards are looked for *there*, not in
   "wherever they are now": a request for a card that has since left that pile is
   stale news - the owner drew it, or moved it - and the right answer is to do
   nothing rather than move whatever holds that id now.

   One request carries one pile's cards, and the cards it names that are still there are
   moved together: the board's own move takes the whole selection, so a multi-card
   request lands as one move and one log line, exactly as a multi-card selection does on
   the owner's own board (`docs/selection.md`). Cards the request names that are not in
   `from` any more are left out rather than refusing the request, for the reason above.
*/
export function respondToOpponentCardAction ({ card, cards, from, action, slotId = null, count = 0 }) {
   const ids = cards || (card !== undefined ? [ card ] : [])

   trace.answered += 1
   trace.last = { ids, from, action, stage: 'received' }

   if (spectating.get()) {
      trace.last.stage = 'refused: spectating'
      return false
   }

   /*
      *Discard Top X* names no cards, so it is answered before there is anything to look
      up: the count is the whole request, and the cards it means are read off this board's
      own deck - which is the only board that has them. See `discardTopOfTheirDeck` for why
      the ids never travel.
   */
   if (action === OPP_ACTIONS.DISCARD_TOP) {
      return discardOwnTop(count)
   }

   /*
      The owner's *own* zones: this is the board the cards belong to, so the name on
      the wire is read against this table and not the mirror's (see `ownPile`).
   */
   const source = ownPile(from) || slotPile(from)
   if (!source) {
      trace.last.stage = `refused: no pile "${from}"`
      return false
   }

   const found = ids.map((id) => source.get().find((c) => c._id === id)).filter(Boolean)
   if (!found.length) {
      trace.last.stage = `refused: none of ${ids.join(',')} are in ${source.name}`
      return false
   }

   trace.last.stage = `found ${found.length} of ${ids.length}`

   /* the board's one selection is what its own moves work from */
   resetSelection()
   selectCard(found[0], source, false)
   for (const extra of found.slice(1)) selectCard(extra, source, true)

   /*
      The two entries that act on *one* card are the ones that name a place for it - a
      Pokemon in play, and the attachment under one - so they take the first of the
      cards and no more: "put these three cards under your Active" is not a move either
      board has. Everything else is a move to a zone, which is the same for one card as
      for three.
   */
   const card0 = found[0]

   switch (action) {
      case OPP_ACTIONS.BENCH:
         if (slotId) return intoSlot(card0, source, slotId)
         toBench()
         return true

      case OPP_ACTIONS.ACTIVE:
         if (slotId) return intoSlot(card0, source, slotId)
         toActive()
         return true

      case OPP_ACTIONS.ATTACH:
         return attachToActive(card0, source)

      case OPP_ACTIONS.STADIUM:
         toStadium()
         return true

      case OPP_ACTIONS.DECK_SHUFFLE:
         return shuffleIntoDeck(found, source)

      default:
         return plainMove(source, action)
   }
}

/* the stage an answer reached, so a refusal says which line refused it */
function mark (stage) {
   if (trace.last) trace.last.stage = stage
}

/*
   A request's cards sent to one of the owner's own zones, with the event that zone's
   own move writes.

   `moveSelection` is the board's own move and it does all of this for every zone it
   knows - for the whole selection, which is how a multi-card request lands as one move
   - so the only thing written out here is the deck, the one destination
   `moveSelection` refuses when it is also the source.
*/
function plainMove (source, action) {
   const bottom = action === OPP_ACTIONS.DECK_BOTTOM
   /*
      The owner's *own* destination, for the same reason its source is (see
      `ownPile`): this runs on the board that holds the cards, so "discard" here is
      that board's own discard.
   */
   const target = ownPile(action === OPP_ACTIONS.DECK_BOTTOM ? 'deck' : action)
   mark('plainMove:' + (target ? target.name : 'no target'))
   if (!target) return false

   /*
      Cards going back onto the deck they came off are not a move `moveSelection` will
      make: it skips a group whose source *is* the destination, which is right for a
      card already where it was asked to go and wrong for the deck's own top, where the
      cards really do change place. So they are placed directly, in the one order the
      store defines (`ordered[0]` is drawn first - see `placeOrdered` in
      custom/cards.js).
   */
   if (target === myDeck) {
      const cards = cardSelection.get()
         .map((card) => (takeFrom(source, card) ? card : null))
         .filter(Boolean)

      if (!cards.length) return false

      target.placeOrdered(cards, { bottom })
      share('cardsMoved', {
         cards: cards.map((card) => card._id),
         from: source.name,
         to: 'deck',
         position: bottom ? 'bottom' : 'top',
         ordered: true
      })
      logMove(cards, source.name, 'deck', { bottom })

      resetSelection()
      return true
   }

   moveSelection(target)
   return true
}

/*
   "Shuffle Into Deck", which is a move *and* a shuffle, for the same reason: cards
   replaced into the deck they were already in have to be taken out and put back before
   the deck is shuffled, or nothing is shuffled into anything.
*/
function shuffleIntoDeck (cards, source) {
   const moved = cards
      .map((card) => (takeFrom(source, card) ? card : null))
      .filter(Boolean)

   if (!moved.length) return false

   myDeck.merge(moved)
   myDeck.shuffle()

   share('cardsMoved', { cards: moved.map((card) => card._id), from: source.name, to: 'deck' })
   logMove(moved, source.name, 'deck', { shuffle: true })

   resetSelection()
   return true
}

/*
   The slot a request names, when the pile it names is one of the lists inside a
   Pokemon in play (`${slotId}.energy`, and so on - see `slot()` in
   custom/cards.js). A revealed card is a card out of a deck, so this is not
   reached by the two entries that offer one today; it is here because the request
   names a pile the way every event does, and reading the name is what keeps one
   vocabulary for piles across the wire.

   The owner's own Pokemon: `findSlot` on this board, for the reason `ownPile` is
   this board's zones.
*/
function slotPile (name) {
   const match = /^([0-9a-z-]{36})\.(pokemon|trainer|energy)$/i.exec(name || '')
   if (!match) return null

   const s = findSlot(match[1])
   return s ? s[match[2]] : null
}

/*
   The top `count` cards of the **owner's own** deck, discarded: the answer to a *Discard
   Top Card* / *Discard Top X* request, performed with this board's own piles.

   It is deliberately the same move the player's own deck menu makes for the same two
   entries (`moveTop` in `board/Deck.svelte`) - take them off the end of the deck, push
   them onto the discard, and say so with one `cardsMoved` - so a card discarded by the
   *other* player lands with the line, the event and the mirror update of a card this
   player discarded themselves. That is the whole design of this module: the owner
   performs the move, and the acting board's copy follows the events.

   Nothing here is `optimistic` on the acting side beyond the deck getting shorter: the
   owner is the authority for what was under those cards, and the acting board was never
   shown them.
*/
function discardOwnTop (count) {
   const n = Math.min(Math.max(1, Math.floor(count) || 1), myDeck.get().length)
   if (!n) {
      mark('refused: the deck is empty')
      return false
   }

   const cards = []
   for (let i = 0; i < n; i++) {
      const card = myDeck.pop()
      if (!card) break
      cards.push(card)
      myDiscard.push(card)
   }

   if (!cards.length) {
      mark('refused: the deck is empty')
      return false
   }

   share('cardsMoved', { cards: cards.map((c) => c._id), from: 'deck', to: 'discard' })
   logMove(cards, 'deck', 'discard', { top: true })

   mark(`discarded the top ${cards.length}`)
   return true
}

/*
   A card put under one of the owner's Pokemon in play, in the slot the request
   named: the shape `attachSelection` writes for the owner's own board.
*/
function intoSlot (card, source, slotId) {
   const target = findSlot(slotId)
   if (!target) return false

   if (!takeFrom(source, card)) return false

   const energy = String(card.supertype || '').toLowerCase() === 'energy'
   if (energy) target.energy.push(card)
   else target.trainer.push(card)

   share('cardsAttached', { slotId: target.id, cards: [ card._id ], from: source.name })
   resetSelection()
   return true
}

/* the entry the owner's own menu calls Attach: a card under the Active Pokemon */
function attachToActive (card, source) {
   const active = myActive.get()
   if (!active) return false

   if (!takeFrom(source, card)) return false

   const energy = String(card.supertype || '').toLowerCase() === 'energy'
   if (energy) active.energy.push(card)
   else active.trainer.push(card)

   share('cardsAttached', { slotId: active.id, cards: [ card._id ], from: source.name })
   resetSelection()
   return true
}

/* ------------------------------------------------------------------ wiring -- */

/*
   The owner's side of the request.

   A spectator never answers: the board it would answer for is somebody else's,
   and `share()` already refuses a spectator's own events - this is the same rule
   at the other end of the wire.
*/
react('oppCardAction', (data) => {
   respondToOpponentCardAction(data)
})