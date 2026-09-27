/*
   Pinging a card.

   A ping is a player pointing at one of the other player's cards - *this one* - and
   it is what the menu entry *Declare Target* became. Two things come of it, and they
   are deliberately different in kind:

      - a line in the game log, which is the room's: `Ping: <card>` for a card this
        player can read, and `Ping: Hidden card` for one they cannot. The name is the
        **pinger's** knowledge rather than the card's, which is why a hand or a
        face-down prize is not named: the log is read by the whole table - spectators
        included - and the pinger was never shown the card.
      - a two-second glow on the card itself, on **both players' boards** - the pinger's
        and the owner's. A ping moves nothing and nobody answers it, so the glow is the
        whole of how it reaches the other player, who is the person a ping is for. A
        spectator is told by the log line and draws no glow (see `pingedCard`).

   It travels as its own relay event (`cardPinged`, carrying the card's id) rather
   than riding the log line, because a log line is a string and a glow is about
   *which card*: an id lets each board find the card where it holds it - the pinger's
   mirror, the owner's own zone, a watcher's mirror - instead of the two ends having
   to agree on a name, which for a hidden card is exactly what must not be said.

   Only a player sends one, and only in a room: `share` refuses a spectator (see
   connection.js) and drops an event with no room to send it to, and in solo both halves
   are one person's, so there is nobody to ping. The checks are here rather than at each
   menu entry, so every caller - the two menus and the veiled Pokemon's own path -
   inherits them.
*/

import { writable } from 'svelte/store'
import { share, react, spectating, solo, publishLog } from './connection.js'

/*
   How long a pinged card is lit for, which is the same two seconds `.pinged` animates
   over in global.css: the store is the clock and the class is the drawing, and one of them
   changed without the other is a card that wears the ring for a different length of time
   than it glows for.
*/
const PING_MS = 2000

/*
   The card this board is showing a glow on, or null.

   One card at a time, because a ping is "the card being pointed at" and a second ping is a
   newer answer than the first.

   **The half travels with the id, and that is not decoration.** Ids are handed out per
   board load - both boards number their cards `1..n` from their own decklist (`loadDeck` in
   custom/board.js) - so the same id names a card of the player's *and* a card of the
   other player's, and a ping that carried only the id would light two cards on one screen:
   the one that was pinged and the player's own card with that id, on the other half. So the
   store keeps which half the card is on **in the terms of the board holding it** - see
   `pingedCard`, which is the one place that is asked - and it is `'far'` for a ping this
   board sent (a card of the opponent's, which this board draws as its far half) and
   `'near'` for one that arrived (a card of the player's own, which is the half the owner
   drew it on).
*/
export const pinged = writable(null)

let start = null
let end = null

/*
   Show a ping, and put it away again.

   The card is set on the **next task** rather than at once, and the one line that matters
   is the `null` before it: Svelte only rewrites the class when the store's value changes,
   so pinging the same card twice in a row - the ordinary way to insist on something - would
   otherwise leave the glow that is already running to finish, and the second ping would
   light the card for the remainder of the first one's two seconds rather than for two
   seconds of its own.

   One timer each for the start and the end, both cleared first: a ping that arrives while
   another is being shown replaces it whole, rather than leaving a stray timeout to blank a
   card that is not the one it was set for.
*/
function glow (id, half) {
   clearTimeout(start)
   clearTimeout(end)

   pinged.set(null)

   start = setTimeout(() => {
      pinged.set({ id, half })
      end = setTimeout(() => pinged.set(null), PING_MS)
   }, 0)
}

/*
   Whether this card is the one a ping is lighting.

   `half` is which half of **this board** the caller draws its card on: `'far'` for a
   mirror (`opponent/*`), `'near'` for the player's own zones (`board/*`). Both are part of
   the question - see the note over `pinged` for what asking only the id costs - and this
   is a function rather than a `===` in the six components so that the rule is stated once,
   with its reason, and can be asked directly.

   **A spectator's board lights nothing**, and it is this rule that does it: while
   spectating, both halves of the screen are drawn by the far half's components
   (`Board.svelte` shows two mirrors), so every card asks for `'far'` and an arrived ping
   says `'near'`. The log line is the spectator's half of a ping; the glow is the two
   players'.
*/
export function pingedCard (ping, card, half) {
   if (!ping || !card) return false
   return ping.half === half && ping.id === card._id
}

/*
   What a ping says in the game log, which is the one line of this that is a *rule* rather
   than a mechanism: the name is the pinger's knowledge and never the card's.

   `revealed` is whether **this player** may read the card, which is the flag the card is
   drawn from - the hand and prize zones pass it, and a Pokemon whose owner has hidden
   their board is pinged with it false (see opponent/Slot.svelte). A card's own `name` is
   not what decides it: a mirror is handed the names of the opponent's hidden cards as part
   of the board state, so every hidden card on this board *has* a name and printing it
   would be the leak the whole rule is about. A card with no name at all is a placeholder
   (see `missingCard` in opponent.js) and reads as hidden for the same reason.
*/
export function pingLine (card, revealed = true) {
   const named = revealed && card?.name ? card.name : 'Hidden card'
   return `Ping: ${named}`
}

/*
   Ping a card: the log line, the event, and this board's own glow.

   The card is one of the *other player's* - that is the only thing a ping is offered on -
   so it lies on this board's far half, and the glow says so (`glow(card._id, 'far')`).

   It is refused by a spectator and in solo at the source rather than at each menu entry,
   so every caller inherits the rule - the two menus that offer the entry and the veiled
   Pokemon's own path all ask this one function.
*/
export function pingCard (card, revealed = true) {
   if (spectating.get() || solo.get()) return false
   if (!card || card._id === undefined || card._id === null) return false

   publishLog(pingLine(card, revealed))
   share('cardPinged', { card: card._id })
   glow(card._id, 'far')

   return true
}

/*
   A ping from the other player, which is the half of this that no local call makes.

   It is a card of **the player's own** - one player points at the other's cards, so the
   card that arrives here is one this board holds on its near half - and that is what the
   glow says, which is also what keeps a spectator's board dark (see `pingedCard`).
*/
react('cardPinged', (data) => {
   if (!data || data.card === undefined || data.card === null) return
   glow(data.card, 'near')
})
