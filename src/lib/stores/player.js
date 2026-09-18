import { get, post } from '$lib/util/fetch-web.js'
import { board } from './custom/board.js'
import { pile, slot } from './custom/cards.js'
import { writable } from './custom/writable.js'
import { share, react, publishLog, spectating, socket, onBoardCleanup, chat } from './connection.js'
import { fixOld } from './oldCards.js'
import { s } from '$lib/util/strings.js'
import { statusById, statusesOn, normalizeStatus, toggleStatus, emptyStatus } from '$lib/util/status.js'
import { logStatus, logStatusCleared } from './logger.js'
import {
   logMove, logSlotMove, logPickup,
   logBenched, logPromoted, logStadium,
   logAttachment, logEvolve, logAbilityUsed
} from './logger.js'

export const {
   cards, deck, hand, prizes, discard, lz,
   bench, active, stadium, table, pickup,
   powerMarker, powerMarkerUsed,
   turn,
   timer,
   prizesFlipped, handRevealed, pokemonHidden,
   exportBoard, findSlot,
   reset: resetBoard
} = board()

/*
   Reset is used by the UI (Setup / Reset in Controls), so it is guarded like
   the rest of the board actions. The relay is the real authority: it refuses
   anything a spectator tries to send.
*/
export function reset () {
   if (isSpectator()) return
   return resetBoard()
}

/*
   Empty the board and the deck list behind it.

   This is what leaving a room needs, and it is deliberately not `reset()`: a
   board reset throws the board's state away and then rebuilds the deck from the
   imported list, which is right for Setup and wrong for leaving - a player who
   has walked away from a room should not still be holding that game's deck. It
   is not guarded against spectators because the guard exists to stop a spectator
   changing the *game*, and this only changes what is on their own screen, which
   is thrown away anyway.
*/
export function clearMyBoard () {
   cards.set([])
   resetBoard()
   resetSelection()
}

/*
   The board's own half of "the room is gone", handed to the transport rather
   than imported by it - see the note in connection.js. Everything on this
   client that belonged to the room goes: the cards, the selection, the log and
   the table's clock. The other halves (the opponent mirror, and a spectator's
   two) are cleared by their own listener for `leftRoom`.
*/
onBoardCleanup(() => {
   clearMyBoard()
   chat.set([])
   timer.set({ running: false, remaining: 0, at: 0 })
})

export function importDeck (txt, cb, rd = false) {
   if (isSpectator()) return

   const callback = (res) => {
      fixOld(res.cards)
      cards.set(res.cards)
      reset()

      cb(res)
      share('deckLoaded', { deck: res.cards })

      /*
         deckLoaded only carries the card list, not the board layout. A player
         who imports after joining would otherwise never publish their board:
         shareBoardstate() only ran on join and on opponentJoined, so a spectator
         (or an opponent reconnecting) would see their deck with an empty board.
      */
      shareBoardstate()

      publishLog(rd ? 'random deck ⚆ _ ⚆' : 'Imported deck')
   }

   if (rd) get('/api/dm/random', callback)
   else post(`/api/dm/import`, { input: txt }, callback)
}

export function draw (count = 1, setup = false) {
   if (isSpectator()) return

   const cards = []
   for (let i = 0; i < count; i++) {
      if (deck.get().length) {
         const card = deck.pop()
         hand.push(card)
         cards.push(card._id)
      }
   }

   if (!setup) {
      share('cardsMoved', { cards, from: 'deck', to: 'hand' })
      publishLog(`Drew ${count} ${s('card', count)}`)
   }
}

export function pick (source, count, options = {}) {
   if (isSpectator()) return

   const cards = []

   for (let i = 0; i < count; i++) {
      const card = options.bottom ? source.shift() : source.pop()
      if (card) {
         pickup.push(card)
         cards.push(card._id)
      }
   }

   share('cardsMoved', { cards, from: source.name, to: 'pickup' })
   logPickup(count, source.name, options)
}

export function shuffle () {
   if (isSpectator()) return

   deck.shuffle()
   publishLog('Shuffled Deck')
}

export let cardSelection = pile()
export let slotSelection = pile()

export let selectionPile = null

/*
   A spectator watches and nothing else. Every board mutation below is a
   function the UI calls, so refusing here keeps a spectator from changing the
   game; the relay also rejects writes from a member that holds no playing seat.
*/
const isSpectator = () => spectating.get()

export function selectCard (card, pile, push = false) {
   if (isSpectator()) return
   slotSelection.clear() // only have 1 of the two selections active at a time
   // allow multi select on the same pile only
   if (!push || selectionPile !== pile) cardSelection.clear()
   if (!cardSelection.get().includes(card)) cardSelection.push(card)
   else cardSelection.remove(card)
   selectionPile = pile
}

export function selectPile (pile) {
   if (isSpectator()) return

   resetSelection()
   for (const card of pile.get()) {
      cardSelection.push(card)
   }
   selectionPile = pile
}

export function selectSlot (slot, push = false) {
   if (isSpectator()) return
   cardSelection.clear()
   if (!push) slotSelection.clear()
   if (!slotSelection.get().includes(slot)) slotSelection.push(slot)
   else slotSelection.remove(slot)
}

/** move the selection to a "pile"  */

export function moveSelection (pile, options = {}) {

   if (cardSelection.get().length) {
      if (selectionPile === pile) return
      if (selectionPile.get && !selectionPile.get().length) return // user cleared the pile with a shortcut while dragging cards from there, which are now not in there anymore

      const ids = []
      const swapIds = []

      const from = selectionPile === 'stadium' ? 'stadium' : selectionPile.name

      let swap = []
      if (options.switch) {
         for (let i = 0; i < cardSelection.get().length; i++) {
            let card = options.bottom ? pile.shift() : pile.pop()
            if (card) swap.push(card)
         }
      }

      for (const card of cardSelection.get()) {
         ids.push(card._id)

         let replacement = null

         if (options.switch) {
            replacement = swap.pop()
            if (replacement) swapIds.push(replacement._id)
         }

         if (from === 'stadium') {
            if (replacement) stadium.set(replacement)
            else stadium.set(null)
         } else {
            if (replacement) selectionPile.swap(card, replacement)
            else selectionPile.remove(card)
         }

         if (options.bottom) pile.unshift(card)
         else pile.push(card)
      }

      share('cardsMoved', { cards: ids, from, to: pile.name })
      if (swapIds.length) {
         if (from === 'stadium') share('stadiumPlayed', { cardId: swapIds[0], from: pile.name })
         else share('cardsMoved', { cards: swapIds, from: pile.name, to: from })
      }

      logMove(cardSelection.get(), from, pile.name, options)

   } else if (slotSelection.get().length) {
      const ids = []

      for (const slot of slotSelection.get()) {
         if (active.get() === slot) active.set(null)
         else bench.remove(slot)

         ids.push(slot.id)

         pile.merge([
            ...slot.trainer.get(),
            ...slot.energy.get(),
            ...slot.pokemon.get()
         ])
      }

      share('slotsMoved', { slots: ids, to: pile.name })
      logSlotMove(slotSelection.get(), pile.name, options)
   }

   if (options.shuffle) pile.shuffle()
   resetSelection()
}

export function toBench () {
   if (isSpectator()) return

   if (cardSelection.get().length) {
      if (selectionPile.get && !selectionPile.get().length) return // see moveSelection

      const ids = []

      const from = selectionPile === 'stadium' ? 'stadium' : selectionPile.name

      for (const card of cardSelection.get()) {
         if (from === 'stadium') stadium.set(null)
         else selectionPile.remove(card)

         const s = slot(card)
         bench.add(s)
         ids.push({ cardId: card._id, slotId: s.id })
      }

      share('cardsBenched', { cards: ids, from })
      logBenched(cardSelection.get(), from)

   } else if (slotSelection.get().length) {

      for (const slot of slotSelection.get()) {
         if (active.get() === slot) {
            active.set(null)
            bench.add(slot)

            share('activeBenched')
         }
      }
   }

   resetSelection()
}

export function toActive () {
   const cs = cardSelection.get()
   if (cs.length) {
      if (cs.length !== 1) return
      if (selectionPile.get && !selectionPile.get().length) return // see moveSelection

      const card = cs[0]

      const from = selectionPile === 'stadium' ? 'stadium' : selectionPile.name

      if (from === 'stadium') stadium.set(null)
      else selectionPile.remove(card)

      if (active.get()) {
         // move the current active out of the way
         bench.add(active.get())
      }
      const s = slot(card)
      active.set(s)

      share('cardPromoted', { cardId: card._id, slotId: s.id, from })
      logPromoted(card, from)

   } else {
      if (slotSelection.get().length !== 1) return
      const slot = slotSelection.get()[0]
      const a = active.get()

      if (slot === a) return

      bench.remove(slot)
      if (a) bench.add(a)
      active.set(slot)

      share('slotPromoted', { slotId: slot.id })
      publishLog(`Moved {${slot.name}} into the Active Spot`)
   }

   resetSelection()
}

export function discardStadium () {
   if (isSpectator()) return

   const st = stadium.get()
   if (st) {
      discard.push(st)
      stadium.set(null)
      share('cardsMoved', { cards: [ st._id ], from: 'stadium', to: 'discard' })
   }
}

export function toStadium () {
   if (isSpectator()) return

   if (cardSelection.get().length !== 1 || selectionPile === 'stadium' || !selectionPile.get().length) return
   const card = cardSelection.get()[0]

   selectionPile.remove(card)

   discardStadium()
   stadium.set(card)

   share('stadiumPlayed', { cardId: card._id, from: selectionPile.name })
   logStadium(card, selectionPile.name)

   resetSelection()
}

export function removeSlot (slot) {
   if (active.get() === slot) active.set(null)
   else bench.remove(slot)
}

export let attaching = writable(false)
export let evolving = writable(false)

export function startAttachEvolve (evo = false) {
   if (isSpectator()) return

   // override the other if both were clicked
   // if clicked twice cancel the process
   attaching.set(!evo && !attaching.get())
   evolving.set(evo && !evolving.get())
}

export function attachSelection (slot) {
   if (isSpectator()) return
   if (!cardSelection.get().length) return

   const ids = []
   const from = selectionPile === 'stadium' ? 'stadium' : selectionPile.name

   for (const card of cardSelection.get()) {
      if (from === 'stadium') stadium.set(null)
      else selectionPile.remove(card)

      ids.push(card._id)

      if (evolving.get()) slot.pokemon.push(card)
      else if (card.card_type === 'trainer') slot.trainer.push(card)
      else slot.energy.push(card)
   }

   share(
      evolving.get() ? 'cardsEvolved' : 'cardsAttached',
      { slotId: slot.id, cards: ids, from }
   )

   if (evolving.get()) logEvolve(slot, cardSelection.get(), from)
   else logAttachment(slot, cardSelection.get(), from)

   resetSelection()
}

export function resetSelection () {
   cardSelection.clear()
   selectionPile = null

   slotSelection.clear()

   attaching.set(false)
   evolving.set(false)
}

/*
   Put a status effect on the selected Pokémon, or take it off again.

   Status effects only ever apply to the Active Pokémon. A card has two marked
   corners - confusion, paralysis and sleep share the left, poison and burn the
   right, where both can sit at once - and setting one never touches the other
   corner, so poisoning a sleeping Pokémon leaves it asleep.
*/
export function setStatus (id) {
   if (isSpectator()) return
   if (!slotSelection.get().length) return

   const effect = statusById(id)
   if (!effect) return

   for (const slot of slotSelection.get()) {
      const before = normalizeStatus(slot.status.get())
      const next = toggleStatus(before, effect.id)
      const applied = !statusesOn(before, effect.side).includes(effect.id)

      slot.status.set(next)
      share('statusUpdated', { slotId: slot.id, status: next })
      logStatus(slot.name, effect.label, applied)
   }
}

/*
   The VSTAR / GX marker this player shows on their side of the board - 'none',
   'vstar' or 'gx', never both. It is shared like any other board change, so the
   opponent and any spectator see it. Picking one is a setting, so it says nothing
   in the game log; the marker's used state does (see below).
*/
export function setPowerMarker (marker) {
   if (isSpectator()) return
   if (!['none', 'vstar', 'gx'].includes(marker)) return
   if (marker === powerMarker.get()) return

   powerMarker.set(marker)
   /* a different token starts unused */
   powerMarkerUsed.set(false)

   share('powerMarker', { marker })
   share('powerMarkerUsed', { used: false })
}

/*
   Clicking a marker says the power has been used (and clicking again takes that
   back). Using it is the thing worth logging, so that is where the log line goes.
*/
export function togglePowerMarkerUsed () {
   if (isSpectator()) return
   if (powerMarker.get() === 'none') return

   const used = !powerMarkerUsed.get()
   powerMarkerUsed.set(used)

   share('powerMarkerUsed', { used })
   if (used) publishLog(`Used ${powerMarker.get() === 'vstar' ? 'VStar' : 'GX'}`)
}

/* take every status effect off at once */
export function clearStatus () {   if (isSpectator()) return
   if (!slotSelection.get().length) return

   for (const slot of slotSelection.get()) {
      const before = normalizeStatus(slot.status.get())
      if (!statusesOn(before, 'left').length && !statusesOn(before, 'right').length) continue

      slot.status.set(emptyStatus())
      share('statusUpdated', { slotId: slot.id, status: emptyStatus() })
      logStatusCleared(slot.name)
   }
}

/*
   Mark one Pokémon's ability as used (or clear that again). The card wears a
   stripe while it is set, and each change is named in the game log. This is the
   one place that writes it, so the context menu's toggle and the ability button
   in the card's details behave the same way.
*/
export function markAbilityUsed (slot, used) {
   if (isSpectator()) return
   if (!slot || used === slot.abilityUsed.get()) return

   slot.abilityUsed.set(used)
   share('abilityUpdated', { slotId: slot.id, used })
   logAbilityUsed(slot.name, used)
}

/* the context menu's entry: on if it was off, off if it was on */
export function toggleAbilityUsed () {
   if (isSpectator()) return
   if (!slotSelection.get().length) return

   for (const slot of slotSelection.get()) {
      markAbilityUsed(slot, !slot.abilityUsed.get())
   }
}

/*
   Ending a turn takes the Ability Used stripe off every Pokémon of ours. It is
   deliberately silent: the turn itself is one line in the log, not one per
   Pokémon, and nobody wants a page of "ability reset" at the end of each turn.
*/
export function clearAbilities () {
   if (isSpectator()) return

   for (const slot of [active.get(), ...bench.get()]) {
      if (!slot || !slot.abilityUsed.get()) continue

      slot.abilityUsed.set(false)
      share('abilityUpdated', { slotId: slot.id, used: false })
   }
}

/* full board sharing */

export function shareBoardstate () {
   if (isSpectator()) return
   const deck = cards.get()
   if (deck) share('boardState', { cards: deck, board: exportBoard() })
}

react('joinedRoom', () => {
   shareBoardstate()
})

react('opponentJoined', () => {
   shareBoardstate()
})

/*
   Presence-based board sharing. Whichever player is already in the room when
   the other arrives never sees `opponentJoined` for that arrival in the other
   direction, so publishing on every presence change guarantees both boards end
   up in the room - which is what an opponent (or a spectator) needs to render
   the second side.
*/
react('opponentPresent', ({ present }) => {
   if (present) shareBoardstate()
})

/* functions that let the opponent manipulate our board */

/*
   The opponent can set the damage and the status effect on our Active Pokémon,
   and both arrive as their event. Our own board is the one that keeps the
   change, and we then publish it as our own: boards watching us - a spectator's
   mirror of us, for instance - only follow what we say, so without this the
   change would be visible to the opponent who made it and to nobody else.
   (Our own event never comes back to us, the relay skips the sender's echo.)
*/
react('oppDamageUpdated', ({ slotId, damage }) => {
   const slot = findSlot(slotId)
   if (!slot) return
   slot.damage.set(damage)
   share('damageUpdated', { slotId, damage })
})

react('statusUpdated', ({ slotId, status }) => {
   const slot = findSlot(slotId)
   if (!slot) return
   slot.status.set(normalizeStatus(status))
   share('statusUpdated', { slotId, status: normalizeStatus(status) })
})

/*
   The table's turn number. Whoever changes it says so, and the other player's
   board takes that number as its own - so the two counters cannot drift apart,
   and anyone watching follows the same events.
*/
export function setTurn (value) {
   if (isSpectator()) return

   const next = Math.max(0, Number(value) || 0)
   if (next === turn.get()) return

   turn.set(next)
   share('turnChanged', { turn: next })
}

/* the same for the turn number: take their number, then say it as our own */
react('turnChanged', ({ turn: value }) => {
   const next = Math.max(0, Number(value) || 0)
   /* already there means this is our own change coming back: do not re-share it,
      or the two boards would keep answering each other */
   if (next === turn.get()) return

   turn.set(next)
   share('turnChanged', { turn: next })
})

/*
   The game timer. It is shared as a value, not a tick: `remaining` milliseconds
   as of `at` (the relay's clock), and whether it is running. Each client counts
   down from that itself, so a running clock costs no traffic at all - starting,
   pausing and adding time are the only events, and both players may send them.

   On the wire `at` is the relay's clock, because the two players' own clocks may
   not agree. Locally it is this browser's clock, because a countdown has to be
   smooth: the relay's clock here is an estimate, re-measured on every poll, so a
   second that shrinks or stretches by a round trip makes the display stutter. A
   value is therefore converted once, on arrival, and everything after that is
   plain local time.
*/
function localTimer ({ running, remaining, at }) {
   const left = Math.max(0, Number(remaining) || 0)
   const setAt = Number(at) || socket.serverNow()
   const spent = running ? Math.max(0, socket.serverNow() - setAt) : 0

   return { running: Boolean(running), remaining: Math.max(0, left - spent), at: Date.now() }
}

export function setTimer ({ running, remaining }, at = null) {
   if (isSpectator()) return

   const left = Math.max(0, Number(remaining) || 0)

   /* ours to keep locally, in this browser's clock */
   timer.set({ running: Boolean(running), remaining: left, at: Date.now() })

   /* theirs to read, in the clock everyone shares */
   share('timerUpdated', { running: Boolean(running), remaining: left, at: at ?? socket.serverNow() })

   return { running: Boolean(running), remaining: left }
}


/*
   Somebody started watching. A spectator's board comes from the room's event log,
   and a replay can end at a state that is not what the table looks like now - an
   import's empty board, a reset, a whole game's worth of moves since the last
   full state. So when the watcher count changes, say what the board looks like.
   This only ever adds state, and a board state does not change the watcher count,
   so it cannot answer itself.
*/
react('spectatorChanged', () => shareBoardstate())

/* entering a room starts the clock at zero, with a board that can be read */react('joinedRoom', () => {
   timer.set({ running: false, remaining: 0, at: 0 })
   pokemonHidden.set(false)
})
react('createdRoom', () => {
   timer.set({ running: false, remaining: 0, at: 0 })
   pokemonHidden.set(false)
})

/*
   Their clock: keep it. It is deliberately not passed on again - the relay logs
   the event for everyone, so every client sees it first-hand, and a second-hand
   echo of an older value is how two clients ended up pausing and restarting the
   clock at each other.
*/
react('timerUpdated', (state) => timer.set(localTimer(state)))

/* the same for the ability stripe, which either player can mark */
react('abilityUpdated', ({ slotId, used }) => {
   const slot = findSlot(slotId)
   if (!slot) return
   slot.abilityUsed.set(Boolean(used))
   share('abilityUpdated', { slotId, used: Boolean(used) })
})