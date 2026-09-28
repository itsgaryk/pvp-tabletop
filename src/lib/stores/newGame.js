import { writable } from './custom/writable.js'
import { share, react, spectating, solo, room, myId, seatedPlayers } from './connection.js'
import { showMessage } from './message.js'
import { askConsent, canAskConsent, onConsent } from './consent.js'

/*
   Starting a game again, which the other player has to accept.

   The settings menu's **New Game** is how it begins, and the click *is* this player's
   consent: they are the one who asked for it. So there is one question and one answer -
   the other player's - and nothing is cleared until that answer is a yes.

   The handshake itself is `stores/consent.js`, which is the same exchange every other
   gesture that touches the opponent's game asks for; this module is the `newGame` kind:
   the words, the guard that it takes two players, and what a yes does. **A *No* changes
   nothing and is reported back**, which the consent module says for every kind.

   **It also takes two players, and the option says so before it is taken.** A room with one
   player in it has nobody to ask, so the entry is greyed out rather than raising a question
   that can only go unanswered (see `canStartNewGame`).

   What a yes does, on the board that asked and on the board that answered:

      the board      empty, with no decklist behind it - not a fresh deal of the game just
                     played. Each board clears *its own*, and publishes that it has (see
                     the note over `onNewGameStart` in player.js): a mirror is a copy that
                     only its owner can correct
      the log        the log and the chat go with the game they describe
      the clock      back to the room's default, as entering a room sets it
      the window     the Import Deck window is up again on both, because that is the first
                     thing a player meets in a room and it is where the next deck comes from
*/

/*
   Bumped every time the game starts again. It is what the Import Deck window watches to put
   itself back up (see routes/DeckInput.svelte) - a counter rather than a flag because the
   interesting thing is that it happened, and it may happen more than once in a room.
*/
export const newGameCount = writable(0)

/*
   Whether the other playing seat is **occupied and here**.

   It is the relay's own answer, arriving on every poll, and two things about it matter:

      the seat        `seatedPlayers` is the relay's list of seat-holders, so one entry is a
                      room nobody has sat down opposite in yet. A seat that is *held* for
                      somebody who vanished is still in it, which is why this is not the
                      whole answer
      the presence    `opponentPresent` is whether that player's own poll has refreshed them
                      recently, and a held seat is deliberately not present (see
                      `opponentState` in the relay's poll). Somebody who closed their laptop
                      has not agreed to anything

   So both are asked, and the answer is no unless there is a second seat *and* somebody in
   it.
*/
export const opponentHere = writable(false)

react('opponentPresent', ({ present }) => opponentHere.set(Boolean(present)))
react('seated', ({ players }) => {
   /*
      The seats, not the presence: a room whose second player has just sat down has two
      seats and, for the second or so before their first poll lands, no presence. The click
      below asks for both, so being early here only means the option is greyed out for a
      moment - where clearing on a seat alone would enable it for a player who walked away.
   */
   if ((players || []).filter(Boolean).length < 2) opponentHere.set(false)
})
react('leftRoom', () => opponentHere.set(false))

/*
   Whether this player is **in a room with a board of their own** - which is what makes the
   New Game entry part of the menu at all.

   It is a different question from `canStartNewGame`, and the difference is the whole of why
   there are two: this one decides whether the entry is *there*, and the other decides
   whether it can be pressed. A spectator has no board of their own to clear and no question
   to put to anybody, so the entry is not theirs and is not drawn - while a player sitting
   alone in a room has the entry, greyed out, because there is somebody missing rather than
   something the game cannot do.

   The menu does not call this: it reads the stores itself in a `$:` statement, because a
   plain function call in a template is evaluated once when the panel is built (see
   Settings.svelte). This is the store's own statement of the rule, and what `askNewGame`
   leans on.
*/
export function inRoom () {
   return Boolean(room.get()) && !solo.get() && !spectating.get()
}

/*
   Whether this player can start a game again.

   Three things have to be true, and each is a different reason it can be no: a room, a
   playing seat (a spectator has no board of their own to clear and the relay refuses a
   non-chat event from one), and **somebody to ask** - the other seat taken and its player
   present. A room with one player in it has nobody to put the question to, which is why the
   entry is greyed out rather than raising a prompt that can only go unanswered.
*/
export function canStartNewGame () {
   if (!inRoom()) return false
   if ((seatedPlayers.get() || []).filter(Boolean).length < 2) return false
   return opponentHere.get()
}

/*
   What the settings menu's entry does: propose it, which is this player's own consent.

   Nothing to carry: a new game is not *about* a card, so the ask has no payload and both
   boards know what a yes means without being told.
*/
export function askNewGame () {
   if (!canStartNewGame()) return false
   return askConsent('newGame')
}

/*
   The board's half of "start again", registered by the module that owns the board rather
   than imported from here. Same direction, and for the same reason, as `onBoardCleanup` in
   connection.js: gameplay may import this module, never the reverse, or the two evaluate
   while each other is half-built.
*/
export function onNewGameStart (start) {
   starters.add(start)
   return () => starters.delete(start)
}

const starters = new Set()

/*
   **Starting the game again.**

   `mine` says whether this board is the one that asked, and it is not used to divide the
   work: **both** boards clear their own, which is the whole point - a board speaks for
   itself and a mirror is corrected by its owner publishing what it now is (see the note
   over `onNewGameStart` in player.js).

   The board is cleared through the hook that module registers, and everything else on a
   board - the turn counter, the markers, the hidden and flipped flags, the selection -
   comes back with the board's own reset.
*/
onConsent('newGame', {
   yes: () => restart()
})

function restart () {
   for (const start of starters) {
      try {
         start()
      } catch (err) {
         console.error('[pvp-tabletop] could not clear the board for a new game', err)
      }
   }

   newGameCount.update((count) => count + 1)
}
