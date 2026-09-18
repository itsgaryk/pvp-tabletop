import { get, post } from '$lib/util/fetch-web.js'
import { writable } from './custom/writable.js'
import { solo } from './soloState.js'
import {
   resetBoard, timer,
   cardSelection, slotSelection, resetSelection, selectionPile
} from './player.js'
import { defaultOpponent, spectatorFlipped } from './opponent.js'
import { slot } from './custom/cards.js'
import { fixOld } from './oldCards.js'
import { publishToChat } from './connection.js'

/* re-exported so the rest of the app can ask in one import */
export { solo }

/*
   Solo mode: playing both sides yourself.

   There is no room and no relay, so nothing here touches Redis - the two boards
   are local, one for each half of the screen, and the same person moves the
   cards on both. The opponent's half is the usual mirror, which is why "Edit
   Deck 2" can give it a deck and why its menus can be used as freely as your own
   in this mode.

   Rooms, chat and the relay all belong to a room, so in solo they never start:
   the browser's socket is never connected. The game log still records what
   happens on the board, locally, because it is the same board either way.
*/

export function startSolo () {
   /* both halves start empty, ready for their own deck, and unflipped */
   resetBoard()
   defaultOpponent.reset()
   spectatorFlipped.set(false)
   timer.set({ running: false, remaining: 0, at: 0 })
   solo.set(true)
}

export function exitSolo () {
   resetBoard()
   defaultOpponent.reset()
   spectatorFlipped.set(false)
   timer.set({ running: false, remaining: 0, at: 0 })
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
   directly and there is nothing to share - but they are logged, as Player 2, so
   the log reads like a game rather than a monologue.
*/

const OPPONENT = 'Player 2'

function logForOpponent (message) {
   publishToChat(message, 'log', OPPONENT)
}

/*
   Which half a zone belongs to. Cards do not cross between the halves in solo -
   each side plays its own board - with two exceptions, the Stadium and the table,
   which are the shared zones on the table.

   The Stadium is a single card rather than a list of them, but it is a zone of
   that half all the same, so it answers yes here: that is what lets a card be
   taken off it, and what keeps a card from the other side from landing on it.

   This is asked on every drag while the pointer is moving, so it answers false
   rather than throwing at anything it does not recognise: a drag that cannot be
   judged is a drag that is not allowed.
*/
export function onOpponentHalf (pile) {
   if (!pile || typeof pile !== 'object') return false

   const o = defaultOpponent
   if (!o) return false

   return [ o.hand, o.deck, o.discard, o.lz, o.prizes, o.table, o.pickup, o.stadium ]
      .some((own) => own && own === pile)
}

/* whether a Pokemon in play is one of the far half's */
export function onOpponentSlot (s) {
   const o = defaultOpponent
   if (!s || !o) return false

   return o.active.get() === s || o.bench.get().includes(s)
}

/*
   Whether what is selected right now was selected on the far half. Both halves
   share one selection, so this is how the board asks which board a keypress or a
   menu entry is meant for.
*/
export function onOpponentSelection () {
   return onOpponentHalf(selectionPile) || slotSelection.get().some(onOpponentSlot)
}

/*
   Taking a card off one of the far half's zones, and putting one into another.
   Every zone here is a list except the Stadium, which holds the single card that
   is in play: that one is set and cleared rather than pushed and removed, and
   playing a second card on it discards the first, the way it does on your own.
*/
function takeFrom (source, card) {
   if (source === defaultOpponent.stadium) defaultOpponent.stadium.set(null)
   else source.remove(card)
}

function putInto (target, card, bottom = false) {
   if (target === defaultOpponent.stadium) {
      const current = defaultOpponent.stadium.get()
      if (current) defaultOpponent.discard.push(current)
      defaultOpponent.stadium.set(card)
   } else if (bottom) target.unshift(card)
   else target.push(card)
}

/*
   Moving one particular card on the other half, which is what a right click on a
   card there offers. The card knows which pile it is in; the target is one of the
   other half's own zones.
*/
export function soloMoveCard (pile, card, target, label = null, options = {}) {
   if (!pile || !card || !target) return

   takeFrom(pile, card)
   if (options.shuffle) {
      target.push(card)
      target.shuffle()
   } else {
      putInto(target, card, options.bottom)
   }

   logForOpponent(`${label || 'Moved'} ${card.name || 'a card'}`)
}

/* the same, but the card goes into play as one of their Pokemon */
export function soloCardToPlay (pile, card, where = 'bench') {
   if (!pile || !card) return

   takeFrom(pile, card)
   const s = slot(card)

   if (where === 'active') {
      const current = defaultOpponent.active.get()
      if (current) defaultOpponent.bench.add(current)
      defaultOpponent.active.set(s)
      logForOpponent(`Moved ${card.name} to the Active spot`)
   } else {
      defaultOpponent.bench.add(s)
      logForOpponent(`Put ${card.name} on the Bench`)
   }
}

/* and the same for attaching it under their Active */
export function soloCardAttach (pile, card) {
   const active = defaultOpponent.active.get()
   if (!pile || !card || !active) return

   takeFrom(pile, card)
   const energy = String(card.supertype || '').toLowerCase() === 'energy'
   if (energy) active.energy.push(card)
   else active.trainer.push(card)

   logForOpponent(`Attached ${card.name} to ${active.name || 'their Active'}`)
}

/* a card off that half goes onto that half's Stadium, replacing what is there */
export function soloCardToStadium (pile, card) {
   if (!pile || !card) return

   takeFrom(pile, card)
   putInto(defaultOpponent.stadium, card)

   logForOpponent(`Played ${card.name || 'a card'} to the Stadium`)
}

/*
   Attaching (or evolving) the selected cards onto one of that half's Pokemon:
   the click or drop that the Attach / Evolve action asks for. Everything is the
   far half's own, so the cards come off the pile they were selected in and go
   under that Pokemon.
*/
export function soloSlotAttach (s, evolve = false) {
   if (!s) return false

   const cards = [ ...cardSelection.get() ]
   if (!cards.length || !onOpponentHalf(selectionPile)) return false

   const from = selectionPile.name

   for (const card of cards) {
      takeFrom(selectionPile, card)
      if (evolve) s.pokemon.push(card)
      else if (card.card_type === 'trainer') s.trainer.push(card)
      else s.energy.push(card)
   }

   const what = cards.map((card) => card.name).join(', ')
   logForOpponent(evolve
      ? `Evolved {${s.name || 'a Pokemon'}} into [${what}] from the ${from}`
      : `Attached [${what}] from the ${from} to {${s.name || 'a Pokemon'}}`)

   resetSelection()
   return true
}

/*
   The names the far half's zones go by in its log lines, so a move reads the way
   the same move on your own half reads.
*/
const ZONE_LABEL = {
   hand: 'Hand',
   deck: 'Deck',
   discard: 'Discard',
   lz: 'Lost Zone',
   prizes: 'Prizes',
   table: 'Table',
   bench: 'Bench',
   active: 'Active',
   stadium: 'Stadium'
}

/*
   Moving whatever is selected on the far half into one of that half's own zones:
   the keyboard's moves, which on your own board are `moveSelection`, `toBench`,
   `toActive` and `toStadium`. Both halves share one selection, so when the
   selection was made over there these are what its keys have to call - otherwise
   a card selected on the far half would be carried across the table into yours.

   A Pokemon in play goes over with everything under it, as it does on your own
   half. Each card is logged as it lands, in Player 2's name.
*/
export function soloSelectedTo (zone, options = {}) {
   const o = defaultOpponent
   const cards = [ ...cardSelection.get() ]
   const slots = [ ...slotSelection.get() ]

   if (!cards.length && !slots.length) return false

   if (cards.length) {
      if (!onOpponentHalf(selectionPile)) return false

      for (const card of cards) {
         if (zone === 'bench' || zone === 'active') soloCardToPlay(selectionPile, card, zone)
         else if (zone === 'stadium') soloCardToStadium(selectionPile, card)
         else if (zone === 'deck') soloMoveCard(selectionPile, card, o.deck, options.bottom ? 'Put on the bottom of their deck' : 'Put on top of their deck', options)
         else soloMoveCard(selectionPile, card, o[zone], `Moved to their ${ZONE_LABEL[zone] || 'board'}`)
      }
   } else {
      /*
         Only the far half's own Pokemon: both halves share the selection, so a
         near-half slot can be in it too, and that must not be carried over here.
      */
      const own = slots.filter(onOpponentSlot)
      if (!own.length) return false

      for (const s of own) {
         if (zone === 'active') soloSlotToActive(s)
         else if (zone === 'bench') soloSlotToBench(s)
         else if (zone === 'discard') soloSlotToDiscard(s)
         else if (o[zone]) soloSlotToPile(s, o[zone], ZONE_LABEL[zone] || 'board')
      }
   }

   resetSelection()
   return true
}

export function soloDraw (count = 1) {
   let drawn = 0
   for (let i = 0; i < count; i++) {
      const card = defaultOpponent.deck.pop()
      if (card) {
         defaultOpponent.hand.push(card)
         drawn++
      }
   }
   if (drawn) logForOpponent(`Drew ${drawn} ${drawn === 1 ? 'card' : 'cards'}`)
}

export function soloShuffleDeck () {
   defaultOpponent.deck.shuffle()
   logForOpponent('Shuffled their deck')
}

export function soloShuffleHandIntoDeck () {
   defaultOpponent.deck.merge(defaultOpponent.hand.get())
   defaultOpponent.hand.clear()
   defaultOpponent.deck.shuffle()
   logForOpponent('Shuffled their hand into their deck')
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
      logForOpponent(`Moved ${card.name} to the Active spot`)
   } else {
      defaultOpponent.bench.add(s)
      logForOpponent(`Put ${card.name} on the Bench`)
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

   logForOpponent(`Attached ${card.name} to ${active.name || 'their Active'}`)
}

/* off the board, with everything under it, into their discard */
export function soloSlotToDiscard (s) {
   const name = s.name
   const cards = [ ...s.pokemon.get(), ...s.energy.get(), ...s.trainer.get() ]
   defaultOpponent.discard.merge(cards)
   s.pokemon.clear()
   s.energy.clear()
   s.trainer.clear()
   s.damage.set(0)

   if (defaultOpponent.active.get() === s) defaultOpponent.active.set(null)
   else defaultOpponent.bench.remove(s)

   logForOpponent(`Discarded ${name || 'a Pokemon'}`)
}

export function soloSlotToActive (s) {
   const current = defaultOpponent.active.get()
   if (current === s) return

   defaultOpponent.bench.remove(s)
   if (current) defaultOpponent.bench.add(current)
   defaultOpponent.active.set(s)

   logForOpponent(`Moved ${s.name || 'a Pokemon'} to the Active spot`)
}

export function soloSlotToBench (s) {
   if (defaultOpponent.active.get() !== s) return

   defaultOpponent.active.set(null)
   defaultOpponent.bench.add(s)

   logForOpponent(`Moved ${s.name || 'a Pokemon'} to the Bench`)
}

/*
   A Pokemon in play into one of that half's piles, with everything under it: the
   whole slot goes, and the Pokemon is named in the line. `where` is what the
   pile is called in the log.
*/
export function soloSlotToPile (s, target, where = 'pile') {
   if (!s || !target) return

   const under = [ ...s.trainer.get(), ...s.energy.get(), ...s.pokemon.get() ]
   target.merge(under)

   s.pokemon.clear()
   s.energy.clear()
   s.trainer.clear()
   s.damage.set(0)

   if (defaultOpponent.active.get() === s) defaultOpponent.active.set(null)
   else defaultOpponent.bench.remove(s)

   logForOpponent(`Moved {${s.name || 'a Pokemon'}} and everything under it to their ${where}`)
}

/*
   The same split the player's own "Return Pokemon, Discard Rest" makes: the
   Pokemon (and anything evolved under it) to that half's hand, the energy and
   tools that were attached to it to that half's discard.
*/
export function soloSlotReturn (s) {
   if (!s) return

   const pokemon = [ ...s.pokemon.get() ]
   const rest = [ ...s.energy.get(), ...s.trainer.get() ]

   defaultOpponent.hand.merge(pokemon)
   defaultOpponent.discard.merge(rest)

   s.pokemon.clear()
   s.energy.clear()
   s.trainer.clear()
   s.damage.set(0)

   if (defaultOpponent.active.get() === s) defaultOpponent.active.set(null)
   else defaultOpponent.bench.remove(s)

   logForOpponent(`Returned {${s.name || 'a Pokemon'}} to their hand and discarded the rest`)
}

/* everything attached to one of that half's Pokemon, to that half's discard */
export function soloSlotDiscardEnergy (s) {
   if (!s) return

   const count = s.energy.get().length
   if (!count) return

   defaultOpponent.discard.merge(s.energy.get())
   s.energy.clear()

   logForOpponent(`Discarded ${count} energy from {${s.name || 'a Pokemon'}}`)
}

/*
   The far half's own pile menus. They are the piles' housekeeping - shuffling a
   discard or the prizes back in, showing the prizes - which online the pile's
   owner does for themselves and in solo is done for the other side too.
*/

export function soloShuffleDiscardIntoDeck () {
   const count = defaultOpponent.discard.get().length
   if (!count) return

   defaultOpponent.deck.merge(defaultOpponent.discard.get())
   defaultOpponent.discard.clear()
   defaultOpponent.deck.shuffle()

   logForOpponent(`Shuffled their discard (${count}) into their deck`)
}

/* showing the prizes is the far half's own view state, the way it is on yours */
export function soloTogglePrizes () {
   defaultOpponent.prizesFlipped.update((flipped) => !flipped)
}

export function soloShufflePrizes () {
   if (!defaultOpponent.prizes.get().length) return

   defaultOpponent.prizes.shuffle()
   logForOpponent('Shuffled their prizes')
}

export function soloShufflePrizesIntoDeck () {
   const count = defaultOpponent.prizes.get().length
   if (!count) return

   defaultOpponent.deck.merge(defaultOpponent.prizes.get())
   defaultOpponent.prizes.clear()
   defaultOpponent.deck.shuffle()

   logForOpponent(`Shuffled their prizes (${count}) into their deck`)
}

export function soloShufflePrizesToBottom () {
   const count = defaultOpponent.prizes.get().length
   if (!count) return

   /* shuffle first, then place them under the deck - index 0 is the bottom */
   defaultOpponent.prizes.shuffle()
   while (defaultOpponent.prizes.get().length) {
      defaultOpponent.deck.unshift(defaultOpponent.prizes.pop())
   }

   logForOpponent(`Shuffled their prizes (${count}) to the bottom of their deck`)
}
