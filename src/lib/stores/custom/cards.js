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