import { s } from '$lib/util/strings.js'
import { publishLog } from './connection.js'
import { prizesFlipped, handRevealed, pokemonHidden, findSlot } from './player.js'

const slotRegex = /^([0-9a-z-]{36}).(pokemon|trainer|energy)$/i

function isPublicMove (from, to) {
   /*
      What the log can *name*, it must also be able to *judge* - every key of
      `piles` below has an entry here, `bench` and `active` included even though no
      caller passes either today (a benched or promoted Pokemon goes through
      `logBenched` / `logPromoted`, which write their own line). A key in one map
      and not the other is a zone the log can name but treats as private: the
      lookup misses, the move falls through to `slotRegex`, and a line that was
      meant to count cards starts naming them, in front of the player whose board
      it is. `tools/zone-vocabulary-check.mjs` holds the two maps together.
   */
   const zones = {
      hand: handRevealed.val,
      deck: false,
      discard: true,
      lz: true,
      prizes: prizesFlipped.val,
      stadium: true,
      table: true,
      pickup: false,
      bench: !pokemonHidden.val,
      active: !pokemonHidden.val,
      play: !pokemonHidden.val
   }

   const fromPublic = zones[from] || slotRegex.test(from)
   const toPublic = zones[to] || slotRegex.test(to)

   return fromPublic || toPublic
}

const piles = {
   hand: 'Hand',
   deck: 'Deck',
   discard: 'Discard',
   lz: 'Lost Zone',
   prizes: 'Prizes',
   bench: 'Bench',
   active: 'Active',
   stadium: 'Stadium',
   table: 'Table',
   pickup: 'Picked Up',
   play: 'Play'
}

function pileName (key) {
   let regexRes = null

   if (key in piles) return piles[key]
   else if (regexRes = slotRegex.exec(key)) {
      const slot = findSlot(regexRes[1])
      return slot.pokemon.get().at(-1)?.name || 'Play'
   }

   return key
}

function names (array) {
   return array.map(el => el.name).join(', ')
}

export function logMove (cards, from, to, options = {}) {
   const fromName = pileName(from)
   const toName = pileName(to)

   if (isPublicMove(from, to)) {
      if (options.switch) publishLog(`Switched [${names(cards)}] from ${fromName} with ${s('card', cards.length)} from ${toName}`)
      else if (options.shuffle) publishLog(`Shuffled [${names(cards)}] from ${fromName} into ${toName}`)
      else publishLog(`Moved [${names(cards)}] from ${options.top ? 'top of ' : ''}${fromName} to ${options.bottom ? 'bottom of ' : ''}${toName}`)
   } else {
      const a = `${cards.length} ${s('card', cards.length)}`
      if (options.switch) publishLog(`Switched ${a} from ${fromName} with ${s('card', cards.length)} from ${toName}`)
      else if (options.shuffle) publishLog(`Shuffled ${a} from ${fromName} into ${toName}`)
      else publishLog(`Moved ${a} from ${options.top ? 'top of ' : ''}${fromName} to ${options.bottom ? 'bottom of ' : ''}${toName}`)
   }
}

export function logSlotMove (slots, to, options) {
   if (isPublicMove('play', to)) {
      if (options.shuffle) publishLog(`Shuffled {${names(slots)}} from Play into ${pileName(to)}`)
      else publishLog(`Moved {${names(slots)}} from Play to ${options.bottom ? 'bottom of ' : ''}${pileName(to)}`)
   } else {
      if (options.shuffle) publishLog(`Shuffled ${slots.length} Pokémon from Play into ${pileName(to)}`)
      else publishLog(`Moved ${slots.length} Pokémon from Play to ${options.bottom ? 'bottom of ' : ''}${pileName(to)}`)
   }
}

/*
   Cards put back on a deck in a chosen order - the last step of a search, and
   the one place a player decides what the top of their deck is.

   The names are said only when the cards are *named*, which no caller does yet:
   a search is private however it ends, and naming the cards would tell the
   opponent what the player went and got, which is exactly the information a
   face-down deck withholds. So a placement is counted, the way a picked-up card
   is (see logPickup), and the wording still says which end of the deck the cards
   went to - that part is not information the deck hides, since the opponent sees
   the deck get shorter and sees it shuffled.

   `declared` is there for a card whose own text reveals what it searched for:
   the search itself is public then, and naming the cards is the card's doing
   rather than the board leaking.
*/
export function logPlacement (cards, { bottom = false, deckSize = 0, declared = false } = {}) {
   const count = cards.length
   const end = bottom ? `bottom of Deck (${deckSize})` : 'top of Deck'

   if (declared && cards.every(card => card.name)) {
      publishLog(`Put [${names(cards)}] on ${end} in order`)
      return
   }

   publishLog(`Put ${count} ${s('card', count)} on ${end} in order`)
}

export function logPickup (count, from, options) {
   publishLog(`Picked up ${count} ${s('card', count)} from ${options.bottom ? 'bottom of ' : ''}${pileName(from)}`)
}

export function logBenched (cards, from) {
   if (isPublicMove(from, 'play')) {
      publishLog(`Moved [${names(cards)}] from ${pileName(from)} to Bench`)
   } else {
      publishLog(`Moved ${cards.length} ${s('card', cards.length)} from ${pileName(from)} to Bench`)
   }
}

export function logPromoted (card, from) {
   if (isPublicMove(from, 'play')) {
      publishLog(`Moved [${card.name}] from ${pileName(from)} to Active`)
   } else {
      publishLog(`Moved 1 card from ${pileName(from)} to Active`)
   }
}

export function logAttachment (slot, cards, from) {
   publishLog(`Attached [${names(cards)}] from ${pileName(from)} to {${slot.name}}`)
}

export function logEvolve (slot, cards, from) {
   publishLog(`Evolved {${slot.pokemon.get().at(-(cards.length+1)).name}} into [${names(cards)}] from ${pileName(from)}`)
}

export function logStadium (card, from) {
   publishLog(`Moved [${card.name}] from ${pileName(from)} to Stadium`)
}

/* status effects, logged where they are applied so each change appears once */
export function logStatus (name, label, applied) {
   publishLog(`${applied ? 'Applied' : 'Removed'} [${label}] ${applied ? 'to' : 'from'} {${name}}`)
}

export function logStatusCleared (name) {
   publishLog(`Cleared status effects from {${name}}`)
}

/* an ability being used (or cleared) is worth a line of its own */
export function logAbilityUsed (name, used) {
   publishLog(`[${name}] ability ${used ? 'used' : 'reset'}`)
}