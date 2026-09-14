import { copy } from '$lib/util/object.js'
import { writable } from './writable.js'
import { pile, slots } from './cards.js'

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
      'vstar' or 'gx'. Only ever one at a time, and off by default. `powerMarkerUsed`
      is the marker's own state: a player clicks their marker to say the power has
      been used, which dims it.
   */
   const powerMarker = writable('none')
   const powerMarkerUsed = writable(false)

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
      powerMarkerUsed.set(false)
      prizesFlipped.set(false)

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
         status: s.status.get()
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
         prizesFlipped: prizesFlipped.get(),
         handRevealed: handRevealed.get(),
         pokemonHidden: pokemonHidden.get()
      }
   }

   return {
      cards, deck, hand, prizes, discard, lz,
      bench, active, stadium, table, pickup,
      powerMarker, powerMarkerUsed,
      prizesFlipped, handRevealed, pokemonHidden,
      exportBoard, reset,
      // utility function used in multiple files
      findSlot: (slotId) => {
         if (active.get()?.id === slotId) return active.get()
         else return bench.get().find(s => s.id === slotId)
      }
   }
}
