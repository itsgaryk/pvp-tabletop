import { writable } from './custom/writable.js'
import { share, react, spectating, solo, room, myId } from './connection.js'
import { playerName } from './settings.js'
import { showMessage } from './message.js'

/*
   Starting a game again, which the other player has to accept.

   The settings menu's **New Game** is how it begins, and the click *is* this player's
   consent: they are the one who asked for it. So there is exactly one question in the
   handshake and exactly one answer to it - the other player's - and nothing is cleared
   until that answer is a yes.

      newGameAsked   one player proposing it   { requestId, from, fromName }
      newGameVote    the other player's answer { requestId, yes }

   **A *No* changes nothing and is reported back.** The asker is told, on their own
   screen, that the other player did not want to start a new game - a request that
   quietly vanished would leave them wondering whether it was seen at all.

   Nothing about the handshake is enforced by the relay, and that is deliberate rather
   than an omission. The board a new game clears is each player's **own** - its cards,
   its decklist, its log - so the rule can be applied by the client looking at them. What
   the relay does is what it does for every other action: it refuses a spectator, and it
   writes the two events into the room, where a client that reloads mid-ask replays into
   the question that is still outstanding.

   `requestId` is made by the client that asked, and it is what ties an answer to the ask
   it answers: a vote that names no pending ask is ignored, so a replayed vote from a game
   ago cannot clear a board.
*/

export const newGame = writable({ request: null })

/*
   What this player's side of the pending ask is.

   It is `true` for the player who asked - they are the one waiting on an answer - and
   `null` for everybody else, which is what puts the Yes/No in front of the other player
   and in front of nobody else. It is set from who asked rather than kept as state of its
   own, so there is no second copy of "who asked" to drift from the first.
*/
export const myNewGameVote = writable(null)

/*
   Bumped every time the game starts again. It is what the Edit Deck panel watches to put
   itself back up (see routes/DeckInput.svelte) - a counter rather than a flag because the
   interesting thing is that it happened, and it may happen more than once in a room.
*/
export const newGameCount = writable(0)

/*
   Whether this player has a game to start again.

   A spectator has no board of their own to clear, so the option is not theirs to take -
   and neither is it solo's, where there is nobody to ask. The relay is the authority
   either way: it refuses a non-chat event from a spectator, so this is the UI's half of a
   rule that is enforced on the other side too.

   It is asked by the menu so the menu raises a question rather than holding an opinion,
   the same way the marker setting asks `$solo`.
*/
export function canStartNewGame () {
   return Boolean(room.get()) && !solo.get() && !spectating.get()
}

/*
   **Neither the ask nor the answer writes a line in the game log, and that is
   deliberate.** The log is the thing a new game clears, and a line written by the ask
   arrives over the room's own poll - so the other player's copy of it can land *after*
   their board was cleared, leaving a just-emptied log with "wants to start a new game"
   in it. What a player is told is told on screen instead: the prompt for the one being
   asked, the wait for the one who asked, and a message for the answer either way.
*/

/* what the settings menu's entry does: propose it, which is this player's own consent */
export function askNewGame () {
   if (!canStartNewGame()) return

   const from = myId.get()
   const fromName = playerName.get() || null
   const id = `${from}:${Date.now()}`

   /*
      Raised **here** as well as sent, because our own event is never delivered back to us
      (`emit` in relay/client.js). Without this the player who asked sat looking at a menu
      while the other player was shown a question - which is the one thing a two-sided
      handshake cannot be.
   */
   put(id, from, fromName)
   share('newGameAsked', { requestId: id, from, fromName })
}

/*
   The other player's answer, from the prompt.

   A *Yes* is the whole of it and starts the game again; a *No* ends the ask for both
   players and tells the one who asked, on their own screen, which is the only screen the
   answer is about.
*/
export function voteNewGame (yes) {
   const request = newGame.get().request
   if (!request || !canStartNewGame()) return

   share('newGameVote', { requestId: request.id, yes: Boolean(yes) })

   /*
      Our own answer has to be applied here, because our own event is never delivered back
      to us. The other player's arrives through the handler at the bottom of this module.
   */
   answer(request.id, Boolean(yes))
}

/* one answer onto the pending ask */
function answer (requestId, yes) {
   const state = newGame.get()
   if (!state.request || state.request.id !== requestId) return

   const asker = state.request.from

   if (yes) {
      clear()
      restart()

      /*
         The player who asked is the one waiting on this, and they are the one for whom it
         is news: the answerer already knows what they answered. Their prompt goes away
         with the game rather than staying up over a board that has just been cleared.
      */
      if (asker && asker === myId.get()) showMessage('The other player accepted - starting a new game')
      return
   }

   clear()
   if (asker && asker === myId.get()) showMessage('The other player did not want to start a new game')
}

/* the ask is over, however it ended */
function clear () {
   newGame.set({ request: null })
   myNewGameVote.set(null)
}

/*
   **Starting the game again.**

   What it is is a room that has just been created, without the room being new: the same
   code, the same two seats, the same format, the same watchers - and a table nobody has
   touched yet. So the whole of "start again" is the state a freshly created room has:

      the board      empty, with no decklist behind it - not a fresh deal of the game just
                     played
      the log        the log and the chat go with the game they describe
      the clock      back to the room's default, as entering a room sets it

   and then the **Edit Deck** panel is up again, because that is the first thing a player
   meets in a room and it is where the next deck comes from.

   The board is cleared through the hook `stores/player.js` registers - the board belongs to
   that module, and this one deliberately does not import it (see the note on the board's
   own half of "the room is gone" in connection.js). Everything else on a board - the turn
   counter, the markers, hidden and flipped flags, the selection - comes back with the
   board's own reset.
*/
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

const starters = new Set()

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

/*
   A new ask on this client.

   `myNewGameVote` is set from who asked rather than from any vote: the player who asked is
   the one waiting (true), and everybody else in the room is the one being asked (null).

   `fromName` is what the player who asked is called, and it travels in the event because
   only they know their own display name - the same reason `chatMessage` carries one. It is
   optional: an ask that arrived without it is shown as "the other player" rather than as
   nobody.
*/
function put (requestId, from, fromName) {
   if (!requestId) return

   newGame.set({
      request: {
         id: String(requestId),
         from: from || null,
         fromName: fromName || null
      }
   })

   myNewGameVote.set(from && from === myId.get() ? true : null)
}

/* the other player is asking: the prompt appears on this screen */
react('newGameAsked', ({ requestId, from, fromName }) => put(requestId, from, fromName))

/* the other player's answer to an ask of ours */
react('newGameVote', ({ requestId, yes }) => answer(String(requestId), Boolean(yes)))

/*
   Out of the room, and the ask goes with it: nobody is left to answer, and an answer about
   a room this browser has walked out of must not clear a board it no longer has.
*/
react('leftRoom', () => clear())



