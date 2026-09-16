import { get, post } from '$lib/util/fetch-web.js'
import { writable } from './custom/writable.js'
import { resetBoard } from './player.js'
import { defaultOpponent } from './opponent.js'
import { slot } from './custom/cards.js'
import { fixOld } from './oldCards.js'

/*
   Solo mode: playing both sides yourself.

   There is no room and no relay, so nothing here touches Redis - the two boards
   are local, one for each half of the screen, and the same person moves the
   cards on both. The opponent's half is the usual mirror, which is why "Edit
   Deck 2" can give it a deck and why its menus can be used as freely as your own
   in this mode.

   Rooms, chat and the game log all belong to a relay, so in solo they simply
   never start: the browser's socket is never connected.
*/
export const solo = writable(false)

export function startSolo () {
   /* both halves start empty, ready for their own deck */
   resetBoard()
   defaultOpponent.reset()
   solo.set(true)
}

export function exitSolo () {
   resetBoard()
   defaultOpponent.reset()
   solo.set(false)
}

/*
   "Edit Deck 2": the same decklist the player's own panel takes, landed on the
   opponent's half instead. Shared events are no-ops here, since there is no room
   to tell.
*/
export function importOpponentDeck (txt, cb, rd = false) {
   const callback = (res) => {
      fixOld(res.cards)
      defaultOpponent.cards.set(res.cards)
      /* the board's own reset reloads its deck from that list */
      defaultOpponent.reset()
      cb(res)
   }

   if (rd) get('/api/dm/random', callback)
   else post('/api/dm/import', { input: txt }, callback)
}

/*
   Playing for the other half. Online these things happen by their owner, over
   the relay; in solo the same person does them, so they are done to that board
   directly and there is nothing to share.
*/

export function soloDraw (count = 1) {
   for (let i = 0; i < count; i++) {
      const card = defaultOpponent.deck.pop()
      if (card) defaultOpponent.hand.push(card)
   }
}

export function soloShuffleDeck () {
   defaultOpponent.deck.shuffle()
}

export function soloShuffleHandIntoDeck () {
   defaultOpponent.deck.merge(defaultOpponent.hand.get())
   defaultOpponent.hand.clear()
   defaultOpponent.deck.shuffle()
}

/* the top card of their hand goes into play, as their Active or onto the Bench */
export function soloHandIntoPlay (where = 'bench') {
   const card = defaultOpponent.hand.pop()
   if (!card) return

   const s = slot(card)
   if (where === 'active') {
      const current = defaultOpponent.active.get()
      if (current) defaultOpponent.bench.add(current)
      defaultOpponent.active.set(s)
   } else {
      defaultOpponent.bench.add(s)
   }
}

/* the top card of their hand goes under their Active: energy as energy, else a tool */
export function soloHandAttachToActive () {
   const active = defaultOpponent.active.get()
   const card = defaultOpponent.hand.pop()
   if (!card) return
   if (!active) {
      defaultOpponent.hand.push(card)
      return
   }

   const energy = String(card.supertype || '').toLowerCase() === 'energy'
   if (energy) active.energy.push(card)
   else active.trainer.push(card)
}

/* off the board, with everything under it, into their discard */
export function soloSlotToDiscard (s) {
   const cards = [ ...s.pokemon.get(), ...s.energy.get(), ...s.trainer.get() ]
   defaultOpponent.discard.merge(cards)
   s.pokemon.clear()
   s.energy.clear()
   s.trainer.clear()
   s.damage.set(0)

   if (defaultOpponent.active.get() === s) defaultOpponent.active.set(null)
   else defaultOpponent.bench.remove(s)
}

export function soloSlotToActive (s) {
   const current = defaultOpponent.active.get()
   if (current === s) return

   defaultOpponent.bench.remove(s)
   if (current) defaultOpponent.bench.add(current)
   defaultOpponent.active.set(s)
}

export function soloSlotToBench (s) {
   if (defaultOpponent.active.get() !== s) return

   defaultOpponent.active.set(null)
   defaultOpponent.bench.add(s)
}
