import { writable } from '$lib/stores/custom/writable.js'
import { shuffle } from '$lib/util/array.js'

/**
 * Writable array store with some useful methods
 */
export function pile (name = null) {
   const { get, set, subscribe, update } = writable([])

   return {
      name,
      get, set, subscribe, update,
      push: (val) => {
         update(v => {
            v.push(val)
            return v
         })
      },
      pop: () => {
         let card = null
         update(v => {
            card = v.pop()
            return v
         })
         return card
      },
      shuffle: () => {
         update(v => {
            shuffle(v)
            return v
         })
      },
      clear: () => {
         set([])
      },
      remove: (card) => {
         update(v => {
            v.splice(v.indexOf(card), 1)
            return v
         })
      },
      unshift: (val) => {
         update(v => {
            v.unshift(val)
            return v
         })
      },
      shift: () => {
         let card = null
         update(v => {
            card = v.shift()
            return v
         })
         return card
      },
      merge: (array) => {
         update(v => {
            v.push(...array)
            return v
         })
      },
      /*
         Put a list of cards at one end of the pile as one move, in the order
         given: `ordered[0]` is the topmost, or the last card if the placement is
         at the bottom.

         Which end of the array is the top is the one convention this store does
         not state anywhere, and it is the *end* of it: a deck is drawn from with
         `pop`, a card taken off the top of a pile is a `pop`, and a pile's own
         view reads a pile from that same end. So `ordered` is the sequence top
         first, which is the *reverse* of how it has to sit in the array - the
         last card of the deck is the first one drawn - and the two ends are
         mirror images of each other:

            on top     ordered, reversed, at the end   (ordered[0] drawn first)
            on bottom  ordered, as it is, at the front (ordered[0] deepest)

         Getting the top backwards is the bug this note exists for: the dialog
         reads perfectly, because it shows the order that was chosen, and the deck
         is face down, so nothing shows that the cards went on upside down until
         somebody draws one.

         The cards are taken out before they are put back, so a card already in
         the pile is relocated rather than duplicated and the move can be repeated
         without changing anything - which is what a relay replay and a duplicated
         call both need.

         Cards that are in `ordered` but not in the pile are simply added, so a
         caller working from a stale read of the deck still lands the list it says
         it landed.
      */
      placeOrdered: (ordered, { bottom = false } = {}) => {
         const ids = new Set(ordered.map(card => card._id))

         update(v => {
            const kept = v.filter(card => !ids.has(card._id))
            const next = bottom
               ? [ ...ordered, ...kept ]
               : [ ...kept, ...ordered.slice().reverse() ]
            v.splice(0, v.length, ...next)
            return v
         })
      },
      swap: (rem, add) => {
         update(v => {
            v.splice(v.indexOf(rem), 1, add)
            return v
         })
      }
   }
}

export function slots () {
   const { get, set, subscribe, update } = writable([])

   const add = (slot) => {
      update(v => {
         v.push(slot)
         return v
      })
   }

   const remove = (slot) => {
      update(v => {
         /*
            A slot that is not in the list is left alone: splice(-1, 1) is the
            last one, so an absent slot used to take a different Pokemon off the
            board - which is what a selection made on the far half in solo could
            do to the player's own Bench.
         */
         const i = v.indexOf(slot)
         if (i >= 0) v.splice(i, 1)
         return v
      })
   }

   const clear = () => {
      set([])
   }

   return {
      get, set, subscribe, update,
      add, remove, clear
   }
}

export function slot (card = null, id = null) {
   const sid = id || crypto.randomUUID()
   const pokemon = pile(`${sid}.pokemon`)
   if (card) pokemon.push(card)

   return {
      id: sid,
      pokemon,
      energy: pile(`${sid}.energy`),
      trainer: pile(`${sid}.trainer`),
      damage: writable(0),
      /*
         status effects, per corner of the card: { left: [id], right: [id] } (see
         $lib/util/status.js)
      */
      status: writable({ left: [], right: [] }),
      /*
         whether this Pokémon's ability has been used this game; the card shows a
         stripe across it and the game log records it
      */
      abilityUsed: writable(false),
      get name() {
         return pokemon.get().at(-1)?.name
      }
   }
}