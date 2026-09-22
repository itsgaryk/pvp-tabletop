import { writable } from '$lib/stores/custom/writable.js'
import { shuffle } from '$lib/util/array.js'

/**
 * Writable array store with some useful methods
 *
 * Every method that changes the pile **hands the store a new array**, and that is
 * load-bearing rather than tidiness. These used to mutate the array in place and
 * `return v`, and Svelte's `writable` does not notify when the value it is handed
 * equals the one it holds - which for an array is the same reference. So a pile
 * changed silently: `push` never told a subscriber anything, and the only
 * notifications a deck ever produced were the `clear()` at each end of a load, both
 * of them while it was *empty*.
 *
 * Nothing on the board minds (it re-renders because something else in the same click
 * changed), and that is what made this expensive to find: the one thing that reads a
 * pile through a subscription - the view a Reveal or a Look keeps of the deck it is
 * showing - was short by whatever arrived after it looked, and no amount of waiting
 * fixed it. A store that does not notify is not a store; `tools/reveal-check.mjs` is
 * what caught it, two browsers apart.
 */
export function pile (name = null) {
   const { get, set, subscribe, update } = writable([])

   /* every change goes through here, so no method can forget to be seen */
   const change = (fn) => {
      update(v => {
         const next = [ ...v ]
         fn(next)
         return next
      })
   }

   return {
      name,
      get, set, subscribe, update,
      push: (val) => change(v => v.push(val)),
      pop: () => {
         let card = null
         change(v => {
            card = v.pop()
         })
         return card
      },
      shuffle: () => change(v => shuffle(v)),
      clear: () => {
         set([])
      },
      remove: (card) => change(v => {
         const i = v.indexOf(card)
         if (i >= 0) v.splice(i, 1)
      }),
      unshift: (val) => change(v => v.unshift(val)),
      shift: () => {
         let card = null
         change(v => {
            card = v.shift()
         })
         return card
      },
      merge: (array) => change(v => v.push(...array)),
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
            /* a new array, so the change is seen - see the note over `pile` */
            return bottom
               ? [ ...ordered, ...kept ]
               : [ ...kept, ...ordered.slice().reverse() ]
         })
      },
      swap: (rem, add) => change(v => {
         const i = v.indexOf(rem)
         if (i >= 0) v.splice(i, 1, add)
      })
   }
}

export function slots () {
   const { get, set, subscribe, update } = writable([])

   /* new arrays, so a change is seen - the same reason the `pile` note gives */
   const add = (slot) => {
      update(v => [ ...v, slot ])
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
         if (i < 0) return v
         return [ ...v.slice(0, i), ...v.slice(i + 1) ]
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