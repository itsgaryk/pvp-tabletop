import { copy } from '$lib/util/object.js'
import { writable } from './writable.js'
import { pile, slots } from './cards.js'
import { DEFAULT_TIMER_MS, timer } from '../timer.js'

/*
   The table's clock lives in ../timer.js, which is the one place it is
   understood, and is re-exported here because the board is where components look
   for it. Its default is re-exported too: entering a room sets the clock back to
   it. See that module for why the countdown is not simply `remaining - elapsed`.
*/
export { DEFAULT_TIMER_MS, timer }

/*
   How many cards one player may hold in the Stadium before playing there replaces
   what they have. The Stadium is the one cell both players play into, and a player
   may place up to two of their own cards in play there one at a time; a card played
   while they are already at the limit is the stadium being replaced, so the whole
   of their own is discarded and the new card is the only one left in play - not the
   oldest of the two (see toStadium in ../player.js).
*/
export const STADIUM_LIMIT = 2

export function board () {

   const cards = writable([])

   const deck = pile('deck')
   const hand = pile('hand')
   const prizes = pile('prizes')
   const discard = pile('discard')
   const lz = pile('lz')
   const bench = slots()
   const active = writable(null)
   /*
      The Stadium is a list rather than the single card it used to be: a player
      may place two cards in play in it one at a time (see STADIUM_LIMIT), and they
      are drawn side by side. A card played while they are already at that limit
      replaces the whole of their own there rather than joining it.

      It is still one zone per player - the opponent's cards in it are their own,
      on the same board's other half - so a card played by either player kicks the
      *other* player's cards out of it and into that player's discard. That answer
      is made by the client of whoever is being kicked, which is why the event
      that plays a card is what carries it (see opponent.js and solo.js).
   */
   const stadium = pile('stadium')
   const table = pile('table')
   const pickup = pile('pickup')

   /*
      The VSTAR / GX marker this board shows on its side of the board: 'none',
      'vstar', 'gx', or 'both' for a deck that has one of each. Off by default.

      `powerMarkerUsed` says which of the marks have been used, one flag each
      rather than a single yes/no. The two marks are separate powers and separate
      buttons on the board - showing both must not make clicking either of them
      mean the same thing, and using one must not dim the other.
   */
   const powerMarker = writable('none')
   const powerMarkerUsed = writable({ vstar: false, gx: false })

   /*
      The table's turn number. It lives with the board so it travels with the rest
      of the state, and whoever changes it says so, which keeps both players (and
      any spectator) on the same number.
   */
   const turn = writable(0)

   const prizesFlipped = writable(false)
   const handRevealed = writable(false)
   const pokemonHidden = writable(false)

   function loadDeck () {
      let j = 1
      deck.clear()
      for (const card of cards.get()) {
         for (let i = 1; i <= card.count; i++) {
            const c = copy(card, [ 'count' ])
            c._id = j++ // the cards individual "id" for the playtest session
            deck.push(c)
         }
      }
   }

   function reset () {
      deck.clear()
      loadDeck()

      powerMarker.set('none')
      powerMarkerUsed.set({ vstar: false, gx: false })
      turn.set(0)
      /*
         The timer is deliberately not touched here. It is the table's clock
         rather than this board's state, and resetting a board - setting up,
         importing a deck, adopting an opponent's board state - must not stop the
         clock or wipe the time left on it. It is cleared when a room is entered.
      */
      prizesFlipped.set(false)
      /* a fresh board is a board you can read; Setup hides it again afterwards */
      pokemonHidden.set(false)

      hand.clear()
      prizes.clear()
      discard.clear()
      lz.clear()
      bench.clear()
      active.set(null)
      stadium.clear()
      table.clear()
      pickup.clear()
   }

   function exportBoard () {
      const expPile = (p) => p.get().map(card => card._id)
      const expSlot = (s) => ({
         id: s.id,
         pokemon: expPile(s.pokemon),
         energy: expPile(s.energy),
         trainer: expPile(s.trainer),
         damage: s.damage.get(),
         status: s.status.get(),
         abilityUsed: s.abilityUsed.get()
      })

      return {
         deck: expPile(deck),
         hand: expPile(hand),
         prizes: expPile(prizes),
         discard: expPile(discard),
         lz: expPile(lz),
         active: active.get() ? expSlot(active.get()) : null,
         bench: bench.get().map(slot => expSlot(slot)),
         stadium: expPile(stadium),
         table: expPile(table),
         pickup: expPile(pickup),
         powerMarker: powerMarker.get(),
         powerMarkerUsed: powerMarkerUsed.get(),
         turn: turn.get(),
         prizesFlipped: prizesFlipped.get(),
         handRevealed: handRevealed.get(),
         pokemonHidden: pokemonHidden.get()
      }
   }

   return {
      cards, deck, hand, prizes, discard, lz,
      bench, active, stadium, table, pickup,
      powerMarker, powerMarkerUsed,
      turn,
      timer,
      prizesFlipped, handRevealed, pokemonHidden,
      exportBoard, reset,
      // utility function used in multiple files
      findSlot: (slotId) => {
         if (active.get()?.id === slotId) return active.get()
         else return bench.get().find(s => s.id === slotId)
      }
   }
}
