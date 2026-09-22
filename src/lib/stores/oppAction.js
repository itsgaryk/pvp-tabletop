import { logMove } from './logger.js'
import { share, react, spectating } from './connection.js'
import {
   selectCard, resetSelection, moveSelection, toBench, toActive, toStadium
} from './player.js'
import { defaultOpponent } from './opponent.js'
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
   ATTACH: 'attach'
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
   A pile of the far half by the name the wire uses. This is `getPile` in
   opponent.js read the other way - the same table of names - and it is
   deliberately written out rather than derived, because a name that is not in it
   is a name this module must refuse rather than guess at.
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

/* --------------------------------------------------------------- the player -- */

/*
   The player's move, as a request.

   `card` is one of the cards a Reveal or a Look is showing, `action` is one of
   OPP_ACTIONS, and `pile` is what the card was handed with - the batch the window
   gave it, or one of the far half's own lists where the card is on the board.

   The card is taken out of the pile it is in, in *this* mirror, so the action
   reads as done here at once - and `pile` is how that pile is found rather than
   guessed at: a batch differs from a real pile only in that it is not in the
   board's own `piles()`, which is the one thing that decides whether this board
   has a copy to take it out of. A card that this board holds is removed; one it
   does not (a batch, whose card the mirror *does* hold - the batch and the deck
   share the card objects) is removed from the mirror's own list by looking the
   card up in it.
*/
export function opponentCardAction (card, action, options = {}) {
   if (spectating.get()) return false
   if (!card || !canActOn(card)) return false
   if (!Object.values(OPP_ACTIONS).includes(action)) return false

   const source = sourcePile(card, options.pile)
   if (!source) return false
   if (!takeFrom(source, card)) return false

   share('oppCardAction', {
      card: card._id,
      from: source.name,
      action,
      slotId: options.slotId || null
   })

   logMove([ card ], source.name, targetZone(action), { bottom: action === OPP_ACTIONS.DECK_BOTTOM })

   resetSelection()
   return true
}

/*
   The pile to take the card out of on this board.

   A batch is a view of the far half's deck, so the pile behind it is that deck -
   the card objects are the mirror's own, and taking the card out of the deck is
   the same removal the batch is a view of. So the batch is mapped to the deck it
   names, and anything else is used as it is when the board holds it.

   `pile` is looked up in the board's own lists rather than trusted, because a
   caller can hand over anything: a window's batch, a pile of the near half's, a
   stale object. A pile this board does not hold is not a pile this board can take
   a card out of.
*/
function sourcePile (card, pile) {
   const lists = defaultOpponent.piles()

   if (pile && lists.includes(pile)) return pile
   if (pile?.name === 'deck' && pile !== defaultOpponent.deck) return defaultOpponent.deck

   /* nothing was handed over, or it was not a pile: fall back to where the card is */
   return pileOf(card, lists)
}

/* ---------------------------------------------------------------- the owner -- */

/*
   The move the owner performs, on its own board.

   Everything here is the owner's own board and the owner's own cards, so it uses
   the ordinary functions - `moveSelection`, `toBench`, `toActive`, `toStadium` -
   with the board's one selection pointed at the one card. That is deliberate: the
   events, the log line and what the opponent's mirror does with them are then
   *the same* as if the owner had made the move, because it is the same code.

   `from` is the pile the request names and the card is looked for *there*, not in
   "wherever it is now": a request for a card that has since left that pile is
   stale news - the owner drew it, or moved it - and the right answer is to do
   nothing rather than move whatever holds that id now.
*/
export function respondToOpponentCardAction ({ card: id, from, action, slotId = null }) {
   if (spectating.get()) return false

   const source = oppPile(from) || slotPile(from)
   if (!source) return false

   const card = source.get().find((c) => c._id === id)
   if (!card) return false

   /* the board's one selection is what its own moves work from */
   resetSelection()
   selectCard(card, source, false)

   switch (action) {
      case OPP_ACTIONS.BENCH:
         if (slotId) return intoSlot(card, source, slotId)
         toBench()
         return true

      case OPP_ACTIONS.ACTIVE:
         if (slotId) return intoSlot(card, source, slotId)
         toActive()
         return true

      case OPP_ACTIONS.ATTACH:
         return attachToActive(card, source)

      case OPP_ACTIONS.STADIUM:
         toStadium()
         return true

      case OPP_ACTIONS.DECK_SHUFFLE:
         return shuffleIntoDeck(card, source)

      default:
         return plainMove(card, source, action)
   }
}

/*
   A card sent to one of the owner's own zones, with the event that zone's own
   move writes.

   `moveSelection` is the board's own move and it does all of this for every zone
   it knows, so the only thing written out here is which pile an action names - and
   the deck, which is the one destination `moveSelection` refuses when it is also
   the source. A zone this does not know is a request that does nothing, rather
   than a card dropped on the floor.
*/
function plainMove (card, source, action) {
   const bottom = action === OPP_ACTIONS.DECK_BOTTOM
   const target = oppPile(action === OPP_ACTIONS.DECK_BOTTOM ? 'deck' : action)
   if (!target) return false

   /*
      A card going back onto the deck it came off is not a move `moveSelection`
      will make: it skips a group whose source *is* the destination, which is
      right for a card already where it was asked to go and wrong for the deck's
      own top, where the card really does change place. So the deck is placed
      directly, in the one order the store defines (`ordered[0]` is drawn first -
      see `placeOrdered` in custom/cards.js).
   */
   if (target === defaultOpponent.deck) {
      if (!takeFrom(source, card)) return false

      target.placeOrdered([ card ], { bottom })
      share('cardsMoved', {
         cards: [ card._id ],
         from: source.name,
         to: 'deck',
         position: bottom ? 'bottom' : 'top',
         ordered: true
      })
      logMove([ card ], source.name, 'deck', { bottom })

      resetSelection()
      return true
   }

   moveSelection(target)
   return true
}

/*
   "Shuffle Into Deck", which is a move *and* a shuffle, for the same reason: a
   card replaced into the deck it was already in has to be taken out and put back
   before the deck is shuffled, or nothing is shuffled into anything.
*/
function shuffleIntoDeck (card, source) {
   if (!takeFrom(source, card)) return false

   const pile = defaultOpponent.deck
   pile.push(card)
   pile.shuffle()

   share('cardsMoved', { cards: [ card._id ], from: source.name, to: 'deck' })
   logMove([ card ], source.name, 'deck', { shuffle: true })

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
*/
function slotPile (name) {
   const match = /^([0-9a-z-]{36})\.(pokemon|trainer|energy)$/i.exec(name || '')
   if (!match) return null

   const s = defaultOpponent.findSlot(match[1])
   return s ? s[match[2]] : null
}

/*
   A card put under one of the owner's Pokemon in play, in the slot the request
   named: the shape `attachSelection` writes for the owner's own board.
*/
function intoSlot (card, source, slotId) {
   const target = defaultOpponent.findSlot(slotId)
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
   const active = defaultOpponent.active.get()
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
