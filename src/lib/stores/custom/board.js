import { copy } from '$lib/util/object.js'
import { writable } from './writable.js'
import { pile, slots } from './cards.js'

/*
   The clock a room starts with: fifty minutes, paused. It is exported because
   entering a room sets it back to this, and the timer's own prompt opens on it
   when there is no time left to carry over.
*/
export const DEFAULT_TIMER_MS = 50 * 60 * 1000

export function board () {

   const cards = writable([])

   const deck = pile('deck')
   const hand = pile('hand')
   const prizes = pile('prizes')
   const discard = pile('discard')
   const lz = pile('lz')
   const bench = slots()
   const active = writable(null)
   const stadium = writable(null)
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

   /*
      The game timer, kept as a value rather than a tick: `remaining`
      milliseconds as of `at` (a relay-clock timestamp), plus whether it runs.
      Every client counts down from that itself, so a running clock costs nothing
      to share - only starting, pausing and setting it are events.

      A room's clock starts at fifty minutes, paused. A round of this game is
      played to a time limit rather than to a stopwatch, so the useful default is
      the limit itself - and because every client computes the same starting
      value, an untouched clock never has to be sent.
   */
   const timer = writable({ running: false, remaining: DEFAULT_TIMER_MS, at: 0 })

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
      stadium.set(null)
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
         stadium: stadium.get()?._id,
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
