import { board } from './custom/board.js'
import { slot } from './custom/cards.js'
import { socket } from './connection.js'
import { discardStadium } from './player.js'

/* every mirror ever created, so relay events can reach the right ones */
const instances = new Set()

/*
   A read-only mirror of one player's board.

   Most clients only mirror one player, but a spectator mirrors two, so the
   store is a factory rather than a single module-level board: each instance
   tracks the player it belongs to and ignores events aimed at anyone else.
   The instance matching "the other player" is exported at the bottom for the
   normal two-player view.
*/
export function createOpponent () {
   const b = board()

   const { cards, deck, hand, prizes, discard, lz,
      bench, active, stadium, table, pickup,
      vstarUsed, gxUsed,
      prizesFlipped, handRevealed, pokemonHidden,
      reset, findSlot } = b

   /* which player this mirror belongs to; null means "whoever is not me" */
   let clientId = null

   const reload = (deckList) => {
      cards.set(deckList)
      reset()
   }

   const removeCard = (id, pile) => {
      if (pile === stadium) {
         const card = stadium.get()
         stadium.set(null)
         return card
      } else {
         const card = pile.get().find(c => c._id === id)
         pile.remove(card)
         return card
      }
   }

   const moveCards = (ids, source, target) => {
      for (const id of ids) {
         const card = removeCard(id, source)
         target.push(card)
      }
   }

   const removeSlot = (s) => {
      if (active.get() === s) active.set(null)
      else bench.remove(s)
   }

   /* helper */

   const slotRegex = /^([0-9a-z-]{36}).(pokemon|trainer|energy)$/i

   function getPile (name) {
      let regexRes = null

      if (name === 'hand') return hand
      else if (name === 'deck') return deck
      else if (name === 'prizes') return prizes
      else if (name === 'discard') return discard
      else if (name === 'lz') return lz
      else if (name === 'table') return table
      else if (name === 'pickup') return pickup

      else if (regexRes = slotRegex.exec(name)) {
         const id = regexRes[1]
         const type = regexRes[2]
         const s = findSlot(id)
         return s[type]
      }

      else if (name === 'stadium') return stadium
   }

   function applyBoardState ({ cards: list, board: state }) {
      reload(list)
      // all cards are in deck now, move them to where they should be

      moveCards(state.hand, deck, hand)
      moveCards(state.prizes, deck, prizes)
      moveCards(state.discard, deck, discard)
      moveCards(state.lz, deck, lz)
      moveCards(state.table, deck, table)

      const importSlot = (data) => {
         const p = slot(null, data.id)
         moveCards(data.pokemon, deck, p.pokemon)
         moveCards(data.energy, deck, p.energy)
         moveCards(data.trainer, deck, p.trainer)
         p.damage.set(data.damage)
         p.marker.set(data.marker)
         return p
      }

      for (const e of state.bench) bench.add(importSlot(e))
      if (state.active) active.set(importSlot(state.active))

      if (state.stadium) {
         const card = removeCard(state.stadium, deck)
         stadium.set(card)
      }

      if (state.vstarUsed) vstarUsed.set(true)
      if (state.gxUsed) gxUsed.set(true)
      if (state.pokemonHidden) pokemonHidden.set(true)
      if (state.prizesFlipped) prizesFlipped.set(true)
      if (state.handRevealed) handRevealed.set(true)
   }

   /*
      `from` identifies the player an event came from. An instance with no
      assigned player (the normal two-player view, which mirrors exactly one
      opponent) accepts everything; a spectator's instances each take only their
      own player.
   */
   function accepts (from) {
      if (clientId === null) return true
      return from === clientId
   }

   /* Every relay event for this board, already filtered to this player. */
   const handlers = {
      boardState: (data) => applyBoardState(data),
      deckLoaded: ({ deck: list }) => reload(list),
      boardReset: () => reset(),
      cardsMoved: ({ cards: ids, from, to }) => {
         const pile1 = getPile(from)
         const pile2 = getPile(to)
         for (const id of ids) pile2.push(removeCard(id, pile1))
      },
      slotsMoved: ({ slots: ids, to }) => {
         const pile = getPile(to)
         for (const id of ids) {
            const s = findSlot(id)
            removeSlot(s)
            pile.merge([...s.trainer.get(), ...s.energy.get(), ...s.pokemon.get()])
         }
      },
      cardsBenched: ({ cards: items, from }) => {
         const pile = getPile(from)
         for (const { cardId, slotId } of items) {
            const card = removeCard(cardId, pile)
            bench.add(slot(card, slotId))
         }
      },
      activeBenched: () => {
         const s = active.get()
         active.set(null)
         bench.add(s)
      },
      cardPromoted: ({ cardId, slotId, from }) => {
         const card = removeCard(cardId, getPile(from))
         if (active.get()) bench.add(active.get())
         active.set(slot(card, slotId))
      },
      slotPromoted: ({ slotId }) => {
         const pokemon = bench.get().find(s => s.id === slotId)
         bench.remove(pokemon)
         if (active.get()) bench.add(active.get())
         active.set(pokemon)
      },
      cardsEvolved: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         const pile = getPile(from)
         for (const id of ids) s.pokemon.push(removeCard(id, pile))
      },
      cardsAttached: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         const pile = getPile(from)
         for (const id of ids) {
            const card = removeCard(id, pile)
            if (card.card_type === 'trainer') s.trainer.push(card)
            else s.energy.push(card)
         }
      },
      damageUpdated: ({ slotId, damage }) => {
         const s = findSlot(slotId)
         if (s) s.damage.set(damage)
      },
      markerUpdated: ({ slotId, state }) => {
         const s = findSlot(slotId)
         if (s) s.marker.set(state)
      },
      slotDiscarded: ({ slotId }) => {
         const s = findSlot(slotId)
         if (s) removeSlot(s)
      },
      stadiumPlayed: ({ cardId, from }) => {
         const card = removeCard(cardId, getPile(from))
         stadium.set(card)
         // discard your own stadium (if applicable) as a response
         discardStadium()
      },
      pokemonToggle: ({ hidden }) => pokemonHidden.set(hidden),
      prizeToggle: ({ flipped }) => prizesFlipped.set(flipped),
      handToggle: ({ revealed }) => handRevealed.set(revealed)
   }

   return {
      ...b,
      get clientId () { return clientId },
      set clientId (id) { clientId = id },

      apply (name, data, from) {
         if (!accepts(from)) return
         const handler = handlers[name]
         if (handler) handler(data)
      },

      /* the whole board is gone (left the room, opponent retired) */
      clear () {
         reload([])
      },

      /* the board is thrown away entirely, e.g. a spectator leaving */
      dispose () {
         clientId = null
         reload([])
      }
   }
}

/*
   The single mirror used by the normal two-player view. A spectator creates its
   own instances and assigns each one a player.
*/
export const defaultOpponent = createOpponent()

/* the default mirror must receive relay events like every other instance */
register(defaultOpponent)

export const {
   cards, deck, hand, prizes, discard, lz,
   bench, active, stadium, table, pickup,
   vstarUsed, gxUsed,
   prizesFlipped, handRevealed, pokemonHidden,
   reset, findSlot
} = defaultOpponent

/*
   Which mirror a board component shows is passed down as a `store` prop, so a
   spectator can point each half of the screen at a different player.
*/

function register (instance) {
   instances.add(instance)
   return () => instances.delete(instance)
}

/*
   Spectator mirrors, one per player. Each is registered so relay events reach
   it, and it only accepts events from the player it was given.
*/
export function createSpectatorOpponents () {
   const top = createOpponent()
   const bottom = createOpponent()
   register(top)
   register(bottom)

   return {
      top,
      bottom,

      /*
         Seat the two players on the two halves of the screen. The relay tells
         us who they are, so this is decided up front rather than guessed from
         whichever board state happens to arrive first.
      */
      setPlayers (playerIds) {
         const [first, second] = (playerIds || []).filter(Boolean)
         if (top.clientId !== first) {
            top.clear()
            top.clientId = first || null
         }
         if (bottom.clientId !== second) {
            bottom.clear()
            bottom.clientId = second || null
         }
      },

      clear () {
         top.clientId = null
         bottom.clientId = null
         top.clear()
         bottom.clear()
      }
   }
}

export function registerOpponent (instance) {
   return register(instance)
}

/*
   The two mirrors a spectator uses, one per player, created once at module
   level so they are not tied to a component's lifetime.
*/
export const spectatorOpponents = createSpectatorOpponents()

const RELAY_EVENTS = [
   'boardState', 'deckLoaded', 'boardReset', 'cardsMoved', 'slotsMoved',
   'cardsBenched', 'activeBenched', 'cardPromoted', 'slotPromoted',
   'cardsEvolved', 'cardsAttached', 'damageUpdated', 'markerUpdated',
   'slotDiscarded', 'stadiumPlayed', 'pokemonToggle', 'prizeToggle', 'handToggle'
]

for (const name of RELAY_EVENTS) {
   socket.on(name, (data, meta) => {
      for (const instance of instances) instance.apply(name, data, meta?.from)
   })
}

socket.on('leftRoom', () => {
   spectatorOpponents.clear()
   for (const instance of instances) instance.clear()
})

/* the relay tells us who holds the playing seats; seat them on the two halves */
socket.on('seated', ({ players }) => {
   spectatorOpponents.setPlayers(players)
})
