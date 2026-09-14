import { writable } from 'svelte/store'

import { board } from './custom/board.js'
import { slot } from './custom/cards.js'
import { socket } from './connection.js'
import { discardStadium } from './player.js'
import { normalizeStatus } from '$lib/util/status.js'

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
      powerMarker, powerMarkerUsed,
      prizesFlipped, handRevealed, pokemonHidden,
      reset, findSlot } = b

   /* which player this mirror belongs to; null means "whoever is not me" */
   let clientId = null

   /*
      Whether relayed events may land in this mirror at all. A spectator builds
      two mirrors for the players it watches but also leaves the normal
      two-player mirror alive (it is created at module level and never unmounts);
      that idle mirror would collect both players' cards into the same slots.
      Switching it off keeps the state on screen the only state in play.
   */
   let enabled = true

   const reload = (deckList) => {
      cards.set(deckList)
      reset()
   }

   /*
      A mirror can legitimately be missing a card (events applied out of order,
      or a mirror that is not the one on screen). `pile.remove` does
      `splice(indexOf(card), 1)`, which with an absent card becomes
      `splice(-1, 1)` and silently deletes the last entry - so never call it
      with nothing, and never push a missing card into a pile.
   */
   const removeCard = (id, pile) => {
      if (!pile) return null

      if (pile === stadium) {
         const card = stadium.get()
         stadium.set(null)
         return card
      }

      const card = pile.get().find(c => c._id === id)
      if (!card) return null
      pile.remove(card)
      return card
   }

   const moveCards = (ids, source, target) => {
      if (!target) return
      for (const id of ids) {
         const card = removeCard(id, source)
         if (card) target.push(card)
      }
   }

   const removeSlot = (s) => {
      if (!s) return
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
         /* a slot we do not have yet - return nothing rather than throwing */
         return s ? s[type] : null
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
         p.status.set(normalizeStatus(data.status))
         p.abilityUsed.set(Boolean(data.abilityUsed))
         return p
      }

      for (const e of state.bench) bench.add(importSlot(e))
      if (state.active) active.set(importSlot(state.active))

      if (state.stadium) {
         const card = removeCard(state.stadium, deck)
         stadium.set(card)
      }

      if (state.powerMarker) powerMarker.set(state.powerMarker)
      powerMarkerUsed.set(Boolean(state.powerMarkerUsed))
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
         if (!pile2) return
         for (const id of ids) {
            const card = removeCard(id, pile1)
            if (card) pile2.push(card)
         }
      },
      slotsMoved: ({ slots: ids, to }) => {
         const pile = getPile(to)
         if (!pile) return
         for (const id of ids) {
            const s = findSlot(id)
            if (!s) continue
            removeSlot(s)
            pile.merge([...s.trainer.get(), ...s.energy.get(), ...s.pokemon.get()])
         }
      },
      cardsBenched: ({ cards: items, from }) => {
         const pile = getPile(from)
         for (const { cardId, slotId } of items) {
            const card = removeCard(cardId, pile)
            if (!card) continue
            bench.add(slot(card, slotId))
         }
      },
      activeBenched: () => {
         const s = active.get()
         if (!s) return
         active.set(null)
         bench.add(s)
      },
      cardPromoted: ({ cardId, slotId, from }) => {
         const card = removeCard(cardId, getPile(from))
         if (!card) return
         if (active.get()) bench.add(active.get())
         active.set(slot(card, slotId))
      },
      slotPromoted: ({ slotId }) => {
         const pokemon = bench.get().find(s => s.id === slotId)
         if (!pokemon) return
         bench.remove(pokemon)
         if (active.get()) bench.add(active.get())
         active.set(pokemon)
      },
      cardsEvolved: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         if (!s) return
         const pile = getPile(from)
         for (const id of ids) {
            const card = removeCard(id, pile)
            if (card) s.pokemon.push(card)
         }
      },
      cardsAttached: ({ slotId, cards: ids, from }) => {
         const s = findSlot(slotId)
         if (!s) return
         const pile = getPile(from)
         for (const id of ids) {
            const card = removeCard(id, pile)
            if (!card) continue
            if (card.card_type === 'trainer') s.trainer.push(card)
            else s.energy.push(card)
         }
      },
      damageUpdated: ({ slotId, damage }) => {
         const s = findSlot(slotId)
         if (s) s.damage.set(damage)
      },
      statusUpdated: ({ slotId, status }) => {
         const s = findSlot(slotId)
         if (s) s.status.set(normalizeStatus(status))
      },
      abilityUpdated: ({ slotId, used }) => {
         const s = findSlot(slotId)
         if (s) s.abilityUsed.set(Boolean(used))
      },
      slotDiscarded: ({ slotId }) => {
         const s = findSlot(slotId)
         if (s) removeSlot(s)
      },
      stadiumPlayed: ({ cardId, from }) => {
         const card = removeCard(cardId, getPile(from))
         if (!card) return
         stadium.set(card)
         // discard your own stadium (if applicable) as a response
         discardStadium()
      },
      pokemonToggle: ({ hidden }) => pokemonHidden.set(hidden),
      powerMarker: ({ marker }) => powerMarker.set(marker || 'none'),
      powerMarkerUsed: ({ used }) => powerMarkerUsed.set(Boolean(used)),
      prizeToggle: ({ flipped }) => prizesFlipped.set(flipped),
      handToggle: ({ revealed }) => handRevealed.set(revealed)
   }

   return {
      ...b,
      get clientId () { return clientId },
      set clientId (id) { clientId = id },

      get enabled () { return enabled },
      set enabled (value) { enabled = !!value },

      apply (name, data, from) {
         if (!enabled) return
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
   powerMarker,
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
/*
   Point one spectator mirror at a player.

   An empty seat switches the mirror off rather than leaving it with
   `clientId === null`, which would mean "accept every player" and mirror the
   other player a second time.
*/
function seat (mirror, id) {
   if (!id) {
      mirror.enabled = false
      mirror.clientId = null
      mirror.clear()
      return
   }

   if (mirror.clientId !== id) {
      mirror.clear()
      mirror.clientId = id
   }
   mirror.enabled = true
}

export function createSpectatorOpponents () {
   const top = createOpponent()
   const bottom = createOpponent()
   register(top)
   register(bottom)
   seat(top, null)
   seat(bottom, null)

   return {
      top,
      bottom,

      /*
         Seat the two players on the two halves of the screen. The relay tells
         us who they are - as { id, name } since the seats carry names now - so
         this is decided up front rather than guessed from whichever board state
         happens to arrive first.
      */
      setPlayers (players) {
         const [first, second] = (players || [])
            .map((player) => player?.id ?? player)
            .filter(Boolean)
         seat(top, first)
         seat(bottom, second)
      },

      clear () {
         seat(top, null)
         seat(bottom, null)
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

/*
   Which half of a spectator's screen shows which player. Flipping is a local
   view change: it swaps the two mirrors on screen and tells the relay nothing,
   so neither player's own view moves.
*/
export const spectatorFlipped = writable(false)

const RELAY_EVENTS = [
   'boardState', 'deckLoaded', 'boardReset', 'cardsMoved', 'slotsMoved',
   'cardsBenched', 'activeBenched', 'cardPromoted', 'slotPromoted',
   'cardsEvolved', 'cardsAttached', 'damageUpdated', 'statusUpdated',
   'slotDiscarded', 'stadiumPlayed', 'pokemonToggle', 'powerMarker', 'powerMarkerUsed', 'prizeToggle', 'handToggle', 'abilityUpdated'
]

for (const name of RELAY_EVENTS) {
   socket.on(name, (data, meta) => {
      /*
         Every mirror is offered every event, and each one decides whether it
         applies. One mirror failing must not stop the others: a spectator keeps
         an unrendered "default" mirror alongside its two real ones, and that
         default accumulates both players' state, so slot lookups fail there
         first. Without this guard its exception starved the mirrors that are
         actually on screen - a trainer attached to a Pokemon in play, for
         example, never reached the spectator's board.
      */
      for (const instance of instances) {
         try {
            instance.apply(name, data, meta?.from)
         } catch (err) {
            console.error(`[opponent] mirror failed to apply "${name}"`, err)
         }
      }
   })
}

socket.on('leftRoom', () => {
   spectatorOpponents.clear()
   spectatorFlipped.set(false)
   /* back to the normal two-player mirror for the next room */
   defaultOpponent.enabled = true
   for (const instance of instances) instance.clear()
})

/* the relay tells us who holds the playing seats; seat them on the two halves */
socket.on('seated', ({ players }) => {
   spectatorOpponents.setPlayers(players)

   /*
      A spectator does not render the normal two-player mirror, but it is never
      unmounted either, so it would quietly collect both players' cards into the
      same slots while the two real mirrors are on screen. Switch it off.
   */
   defaultOpponent.enabled = !socket.spectating
})
