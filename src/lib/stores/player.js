import { get, post } from '$lib/util/fetch-web.js'
import { board, STADIUM_LIMIT } from './custom/board.js'
import { pile, slot } from './custom/cards.js'
import { writable } from './custom/writable.js'
import { share, react, publishLog, spectating, socket, onBoardCleanup, chat } from './connection.js'
import { changeTimer, fromRelay, holdSync, resetTimer, syncTimer, timer } from './timer.js'
import { fixOld } from './oldCards.js'
import { s } from '$lib/util/strings.js'
import { statusById, statusesOn, normalizeStatus, toggleStatus, emptyStatus } from '$lib/util/status.js'
import { normalizeMarkerUsed } from '$lib/util/markers.js'
import { registerOwnDeck, registerPiles } from './reveal.js'
import { logStatus, logStatusCleared } from './logger.js'
import {
   logMove, logSlotMove, logPickup, logPlacement,
   logBenched, logPromoted, logStadium,
   logAttachment, logEvolve, logAbilityUsed
} from './logger.js'

/*
   Re-exported because the clock is the table's rather than either board's, and
   most of the app reads it from here - it is the store a board component is
   already importing.
*/
export { timer }

/*
   The clock is not taken from the board: it is the table's, and it is owned by
   ./timer.js, which is imported above. Everything else here is this player's own
   half of the board.
*/
export const {
   cards, deck, hand, prizes, discard, lz,
   bench, active, stadium, table, pickup,
   powerMarker, powerMarkerUsed,
   turn,
   prizesFlipped, handRevealed, pokemonHidden,
   exportBoard, findSlot, piles,
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
   resetTimer()
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

/*
   The shuffle that comes with taking a card out of a deck: the deck is shuffled if
   the deck is one of the piles the cards left, and nothing happens otherwise.

   A card taken out of a deck is a card out of a deck, and what is left of it is
   unknown - which is the whole of why a search's move and a shuffle come together
   (the button beside the four is called Close & Shuffle). A discard and a lost zone
   are public and ordered, so shuffling one would be a pile rearranging itself for no
   reason at all.

   `sources` are the piles the cards came out of, because the answer is a fact about
   the cards and not about the screen: the four buttons of a pile's view and an entry
   of its card menu come through here with the pile the view is of, and an attach or
   an evolve comes through with the piles it actually took its cards from - which is
   what lets that one wait for the card to land (see `attachSelection`). It is stated
   once because two copies of "is it the deck" is two answers to one question, and
   the copy is the one that goes stale.

   It is also the one part of any of this that can be asked about without a browser:
   `tools/render-check.mjs` counts the log lines it writes.
*/
export function shuffleAfterLeavingDeck (sources) {
   if (sources.includes(deck)) shuffle()
}

/*
   Putting cards back on the deck in a chosen order - what a search that ends
   "then put those cards on top of it in any order" needs (Ciphermaniac's
   Codebreaking). `ordered[0]` becomes the top of the deck, or the last card if
   the placement is at the bottom.

   The chosen cards never leave the deck: the search is a look, and the placement
   is one move. So there is nothing to put back if the player closes the dialog
   without choosing, and the shuffle cannot carry a held card away - it is a
   shuffle of the deck the cards are still part of.

   Shuffle first, then place. The other order reaches the same deck, but only if
   the chosen cards were the whole deck: a shuffle of an empty rest is no shuffle
   at all, and the cards would go back in the order they were picked in.

   `shuffleFirst: false` is the same move without the shuffle, which is what
   reordering the cards already on top of the deck is: they are going back where
   they came from, so there is nothing to shuffle them into - and shuffling would
   destroy an order an earlier search put there.

   `search` is only what the log says: a placement that came out of a search says
   so, and one that did not is booked as the placement it is.
*/
export function lookAndPlace (ordered, { bottom = false, shuffleFirst = true, search = true } = {}) {
   if (isSpectator()) return
   if (!ordered?.length) return

   if (search) publishLog('Searched deck')

   if (shuffleFirst) deck.shuffle()

   deck.placeOrdered(ordered, { bottom })

   share('cardsMoved', {
      cards: ordered.map(card => card._id),
      from: 'deck',
      to: 'deck',
      position: bottom ? 'bottom' : 'top',
      ordered: true
   })

   logPlacement(ordered, { bottom, deckSize: deck.get().length })
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

/*
   Which pile a card is in, asked of the board's own lists (see `piles()` in
   custom/board.js). A selection can hold cards from more than one zone, so this
   is what a move has to ask to take each card out of the pile that actually
   holds it - the pile the last click was made in is not an answer for the rest.
   `lists` is the board to look in, which is this one unless a caller is asking
   about the far half (solo, where that half is played from the same keyboard).
*/
export function cardPile (card, lists = piles()) {
   return lists.find(p => p.get().includes(card)) || null
}

/*
   A selection gathered by the pile each card is in: the shape every move below
   works from. A card that is in none of the lists - something else has moved it
   on - is not this move's to carry, and is left out rather than removed from a
   pile that does not hold it (a pile's `remove` takes the last card when the one
   asked for is not in it).
*/
export function selectionByPile (lists = piles()) {
   const groups = new Map()

   for (const card of cardSelection.get()) {
      const source = cardPile(card, lists)
      if (!source) continue

      if (!groups.has(source)) groups.set(source, [])
      groups.get(source).push(card)
   }

   return groups
}

/*
   Whether a pile is on the same half of the board as the selection already is.

   A selection is the player's own cards on their side of the board, across the
   zones of that side: Ctrl-click adds a card from another zone just as it adds
   one from the same zone, and every move takes each card out of its own pile.
   The two *halves* are still separate boards even in solo, where both are played
   from this same selection - a move asks which half it was made on
   (`onOpponentSelection`) and then acts on that half alone - so a card of the
   other half's starts a new selection rather than joining this one. Online the
   far half's cards are not selectable at all, so this only ever answers no in
   solo; and a pile that is not one of this board's is by definition a far half
   one, which is how the two are told apart without this module having to know
   anything about the mirror.
*/
function sameHalf (pile) {
   if (!selectionPile) return true

   const mine = piles()
   return mine.includes(pile) === mine.includes(selectionPile)
}

/*
   A card is picked up on its own, and Ctrl/Cmd adds it to what is already
   picked up: the one selection is the player's own cards wherever they are on
   their side of the board, so adding does not ask which pile the card is in.
   Clicking a card that is already selected takes it back out again.
*/
export function selectCard (card, pile, push = false) {
   if (isSpectator()) return
   slotSelection.clear() // only have 1 of the two selections active at a time

   if (!push || !sameHalf(pile)) cardSelection.clear()

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

/*
   Narrow the selection to the cards that are in one pile.

   A pile's own view moves *out of that pile* - the four buttons of a search, a
   deck's view (see Inspection.svelte) - and a selection can hold cards from other
   zones as well, since one is allowed to span the player's side of the board. The
   panel is a view of one pile, so it moves the cards in it and leaves a card
   selected on the board behind it alone.
*/
export function keepInPile (pile) {
   for (const card of [ ...cardSelection.get() ]) {
      if (cardPile(card) !== pile) cardSelection.remove(card)
   }

   selectionPile = cardSelection.get().length ? pile : null
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
      /*
         The cards go over one pile at a time: the selection can hold cards from
         several zones of this half, and each of them has to come out of the pile it
         is in. A card already in the destination is not a card to move - it is the
         destination - so a group whose pile *is* the target is left alone, and a
         selection with nothing but those is a selection with nowhere to go (which
         is what pressing H with a hand card picked up has always done).

         Each zone's cards travel as their own `cardsMoved`, because that event
         names one `from` and one `to`: the opponent's mirror moves a card out of
         the pile the event names, and a list that came from two piles cannot be
         read that way. So a selection picked up across the board crosses the wire
         as one event per zone, which is also how the log reads - one line per
         zone, each naming where those cards came from.
      */
      const groups = [ ...selectionByPile() ].filter(([ source ]) => source !== pile)
      if (!groups.length) return

      let swap = []
      if (options.switch) {
         for (let i = 0; i < cardSelection.get().length; i++) {
            const card = options.bottom ? pile.shift() : pile.pop()
            if (card) swap.push(card)
         }
      }

      for (const [ source, cards ] of groups) {

         /*
            Where this group came from. The Stadium answers with its own name, the
            way every other pile does: it is a list of the cards this player has in
            play there, so taking one off it is the same `remove` any pile takes.
         */
         const from = source.name

         const ids = []
         const swapIds = []

         for (const card of cards) {
            ids.push(card._id)

            let replacement = null

            if (options.switch) {
               replacement = swap.pop()
               if (replacement) swapIds.push(replacement._id)
            }

            if (replacement) source.swap(card, replacement)
            else source.remove(card)

            if (options.bottom) pile.unshift(card)
            else pile.push(card)
         }

         share('cardsMoved', { cards: ids, from, to: pile.name })
         if (swapIds.length) {
            if (from === 'stadium') {
               /* the card swapped in is a card just played into the Stadium */
               share('stadiumPlayed', { cardId: swapIds[0], from: pile.name })
               answerStadiumPlay()
            } else {
               share('cardsMoved', { cards: swapIds, from: pile.name, to: from })
            }
         }

         logMove(cards, from, pile.name, options)
      }

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
      /*
         One zone's cards at a time, for the same reason `moveSelection` moves one
         pile at a time: `cardsBenched` names the pile its cards come out of, and
         the opponent's mirror takes them from that pile. A card already in play is
         not in any of these groups - it is a slot rather than a card in a list.
      */
      for (const [ source, cards ] of selectionByPile()) {

         const ids = []

         const from = source.name

         for (const card of cards) {
            source.remove(card)

            const s = slot(card)
            bench.add(s)
            ids.push({ cardId: card._id, slotId: s.id })
         }

         share('cardsBenched', { cards: ids, from })
         logBenched(cards, from)
      }

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

      const card = cs[0]

      /* the one card's own pile, which is what it is promoted out of */
      const source = cardPile(card)
      if (!source) return

      const from = source.name

      source.remove(card)

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

/*
   The whole of what this player has in play in the Stadium, to their discard. Used
   when they play a card while already at the limit, so the whole of their own is
   replaced by the card just played, and for the answer to the other player's play,
   which clears whatever this player held there however many that is.
*/
export function discardStadium () {
   if (isSpectator()) return 0

   const cards = stadium.get()
   if (!cards.length) return 0

   const ids = cards.map(card => card._id)
   discard.merge(cards)
   stadium.clear()

   share('cardsMoved', { cards: ids, from: 'stadium', to: 'discard' })
   return ids.length
}

/*
   Playing a card into this player's Stadium.

   A card of the other half's is never what this plays: a player may place two of
   their own in play there, and a card played while they are already at those two
   replaces the whole of what they had - the way playing a Stadium replaces the one
   already in play - so the card just played is the only one of theirs left in it.
   The *other* player's cards go to their discard, which is answered on their own
   client: the relay delivers `stadiumPlayed` to them, and the mirror there clears
   what its own player had in play (see opponent.js). In solo both halves are this
   board and nothing is relayed, so that answer is made here instead - solo.js
   registers it, rather than this module importing a board that imports it back.
*/
const stadiumAnswers = new Set()

export function onStadiumPlay (answer) {
   stadiumAnswers.add(answer)
   return () => stadiumAnswers.delete(answer)
}

function answerStadiumPlay () {
   for (const answer of [ ...stadiumAnswers ]) answer()
}

export function toStadium () {
   if (isSpectator()) return

   if (cardSelection.get().length !== 1) return

   const card = cardSelection.get()[0]

   /* the one card's own pile: a Stadium is played from anywhere but the Stadium */
   const source = cardPile(card)
   if (!source || source === stadium) return

   source.remove(card)

   /*
      A card played while this player is already at the limit is the stadium being
      replaced, and the whole of what they had in play there goes with it - not
      just the oldest of the two.

      Below the limit nothing is cleared and the card simply joins what is there -
      which is the one state the two-card Stadium is reached from, since playing
      onwards from it always replaces it (see STADIUM_LIMIT).
   */
   const replaced = stadium.get().length >= STADIUM_LIMIT
   const cleared = replaced ? discardStadium() : 0
   if (cleared) logMove(stadium.get(), 'stadium', 'discard')

   stadium.push(card)

   share('stadiumPlayed', { cardId: card._id, from: source.name })
   logStadium(card, source.name)

   /* the other half of the table answers a card played here */
   answerStadiumPlay()

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

   /*
      One zone's cards at a time, as the moves above: `cardsAttached` (and
      `cardsEvolved`) names the pile the cards come out of, and the log line names
      it too. A card of the player's may be attached from anywhere on their side
      of the board - the hand, the table, off another Pokemon - so the selection
      can hold cards from several zones at once.
   */
   const sources = []

   for (const [ source, cards ] of selectionByPile()) {
      sources.push(source)

      const ids = []
      const from = source.name

      for (const card of cards) {
         source.remove(card)

         ids.push(card._id)

         if (evolving.get()) slot.pokemon.push(card)
         else if (card.card_type === 'trainer') slot.trainer.push(card)
         else slot.energy.push(card)
      }

      share(
         evolving.get() ? 'cardsEvolved' : 'cardsAttached',
         { slotId: slot.id, cards: ids, from }
      )

      if (evolving.get()) logEvolve(slot, cards, from)
      else logAttachment(slot, cards, from)
   }

   /*
      And now the shuffle, because *now* a card has left a pile: this is the moment
      an attach or an evolve happened, and it is the only moment it did. A deck's
      view offers both entries, and the player picks one and then clicks the Pokemon
      - so the card is in hand between the two, and shuffling when the entry was
      picked would shuffle a deck that a change of mind leaves untouched.
      `sources.length` is the same question as "did anything move": the selection is
      known to be non-empty, and a card in none of the board's piles is not this
      move's to carry (see `selectionByPile`).
   */
   if (sources.length) shuffleAfterLeavingDeck(sources)

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
   'vstar', 'gx' or 'both'. It is shared like any other board change, so the
   opponent and any spectator see it. Picking one is a setting, so it says
   nothing in the game log; the marker's used state does (see below).

   'both' is for a deck that runs one of each: the two marks sit together on the
   board, so a player who has both powers available does not have to choose
   which of them the table can see.
*/
export function setPowerMarker (marker) {
   if (isSpectator()) return
   if (!['none', 'vstar', 'gx', 'both'].includes(marker)) return
   if (marker === powerMarker.get()) return

   powerMarker.set(marker)
   /* a different token starts unused - both of them */
   powerMarkerUsed.set({ vstar: false, gx: false })

   share('powerMarker', { marker })
   share('powerMarkerUsed', { used: false })
}

/* what to call a marker, for the log line */
const markerLabel = (marker) => (marker === 'vstar' ? 'VStar' : 'GX')

/*
   Clicking a marker says that power has been used (and clicking again takes that
   back). Which mark was clicked is passed in, because a board showing both has
   two of them: they are separate powers, so using one must not dim, log, or
   otherwise speak for the other.
*/
export function togglePowerMarkerUsed (which) {
   if (isSpectator()) return
   if (powerMarker.get() === 'none') return
   if (which !== 'vstar' && which !== 'gx') return
   /* a mark that is not on this board is not a mark anybody can click */
   if (powerMarker.get() !== 'both' && powerMarker.get() !== which) return

   const before = normalizeMarkerUsed(powerMarkerUsed.get())
   const used = { ...before, [which]: !before[which] }
   powerMarkerUsed.set(used)

   share('powerMarkerUsed', { used, marker: which })
   if (used[which]) publishLog(`Used ${markerLabel(which)}`)
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
   as of `at`, plus whether it runs. Each client counts down from that itself, so
   a running clock costs no traffic at all - starting, pausing and adding time
   are the only events, and both players may send them.

   The arithmetic lives in ./timer.js: one function converts a value from the
   relay's clock into this browser's as it arrives, and one ages it afterwards.
   What is here is the part that needs the relay - refusing a spectator, and
   publishing the change - so the clock cannot be set in two different ways.
*/
export function setTimer ({ running, remaining }) {
   if (isSpectator()) return

   const state = changeTimer({ running, remaining })

   /* ours until the relay has it: do not let a reply describe the clock we just changed */
   holdSync()

   /* theirs to read, in the clock everyone shares */
   share('timerUpdated', state)

   return { running: state.running, remaining: state.remaining }
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

/* entering a room starts the clock, with a board that can be read */
react('joinedRoom', () => {
   resetTimer()
   pokemonHidden.set(false)
})
react('createdRoom', () => {
   resetTimer()
   pokemonHidden.set(false)
})

/*
   Their clock: keep it. It is deliberately not passed on again - the relay logs
   the event for everyone, so every client sees it first-hand, and a second-hand
   echo of an older value is how two clients ended up pausing and restarting the
   clock at each other.
*/
react('timerUpdated', (state) => timer.set(fromRelay(state)))

/*
   The relay's own snapshot of the clock, which rides on every poll. It arrives
   as its own event rather than as a board action because it is not one - nobody
   did anything, the relay is simply saying what the table's clock reads.

   It is what keeps the two players and any watcher together over a long round:
   an event is converted once, when it lands, and from then on each browser is
   counting with its own crystal, which is not quite the same as anybody else's.
*/
react('timerSynced', ({ timer: snapshot }) => syncTimer(snapshot))

/* the same for the ability stripe, which either player can mark */
react('abilityUpdated', ({ slotId, used }) => {
   const slot = findSlot(slotId)
   if (!slot) return
   slot.abilityUsed.set(Boolean(used))
   share('abilityUpdated', { slotId, used: Boolean(used) })
})

/*
   Reveal and Look need this board's deck and cannot import it: `reveal.js` is
   imported by components on both halves, and importing player.js from it would
   point the import graph back at itself (see the note in connection.js). So the
   deck is handed over instead - the same direction `onStadiumPlay` uses for the
   answer a board gives another board.

   `piles` goes with it for the same reason and answers a different question: a
   window's card may not be dropped on this player's own side, and "is this pile one
   of mine" is this board's own answer (see `isWindowPile`).
*/
registerOwnDeck(deck)
registerPiles(piles)