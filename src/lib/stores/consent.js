import { writable } from './custom/writable.js'
import { share, react, spectating, solo, room, myId } from './connection.js'
import { playerName } from './settings.js'
import { showMessage } from './message.js'

/*
   Asking the other player for permission.

   One player wants to do something to the *other* player's game - start a game again,
   read their deck, turn their hand face up - and it cannot happen until the other player
   agrees. That is one handshake, and this is it:

      consentAsked   one player asking          { requestId, from, fromName, kind, payload }
      consentVote    the other player's answer  { requestId, yes }

   **The ask is the asker's own consent**, which is why there is no vote from them: they
   are the one who wants it. So there is exactly one question and exactly one answer in
   the handshake, and the answer is the other player's.

   **A *No* changes nothing and is reported back.** The asker is told, on their own screen,
   that the other player said no - a request that quietly vanished would leave them
   wondering whether it was seen at all.

   ---------------------------------------------------------------------------
   Why a `kind` rather than one handshake per gesture
   ---------------------------------------------------------------------------
   Every one of these is the same exchange with different words and a different thing
   happening at the end, so it is one module keyed by `kind` rather than four copies of the
   same store. What varies per kind is exactly two things, and both are declared by the
   module that wants the consent (see `KINDS` below):

      the words      what the prompt says, to the player being asked
      the ending     what happens when the answer is yes, and what is said when it is no

   What does *not* vary is the part worth having in one place: who may ask, what is
   allowed to be pending at once, how an answer is matched to the ask it answers, and that
   the local player's own answer is applied by them because our own events are never handed
   back to us.

   ---------------------------------------------------------------------------
   One pending ask, and why
   ---------------------------------------------------------------------------
   A board has one opponent, and a second question put while one is outstanding would be a
   second prompt over the first with one answer to give between them. So a new ask replaces
   the pending one, which is the same thing the reveal batches do with each other.

   The relay knows nothing about any of this, and that is deliberate rather than an
   omission - the same reasoning as the new game's: what a consent *permits* is each
   client's own business (a board state, a window, a log line), so the rule is applied by
   the client that would act on it. The relay does what it does for every other action:
   refuses a spectator, and writes the two events into the room, where a client that
   reloads mid-ask replays into the question that is still outstanding.
*/

/*
   Every kind of consent this game asks for, and who answers for it.

   `question` and `hint` are what the prompt says to the player being asked, and they are
   written by the kind so that the wording lives next to the thing it is about rather than
   in the dialog. `actors` is the guard the *asker's* click has already passed: a spectator
   has no board to change and no opponent to ask, and solo has nobody to ask at all.

   `yes` and `no` are the endings, and they are registered rather than declared here because
   they act on modules this one must not import: `newGame.js` and `reveal.js` both need the
   handshake, and this module importing either of them would point the import graph back at
   itself - which is a 500 on every page load rather than a subtle bug (see the note in
   connection.js). So the kind is declared here and its ending is handed over by the module
   that owns it, through `onConsent`.
*/
export const KINDS = {
   newGame: {
      question: 'Start a new game?',
      hint: name => `${name} wants to start a new game. Both boards are cleared, you both import a deck again, and the game log starts empty.`,
      waiting: 'Waiting for opponent to accept new game',
      accepted: 'The other player accepted - starting a new game',
      declined: 'The other player did not want to start a new game'
   },
   look: {
      question: 'Look at your deck?',
      hint: name => `${name} wants to look at the top cards of your deck. You will not be told which cards they saw.`,
      waiting: 'Waiting for opponent to allow a look at their deck',
      accepted: 'Allowed - looking at their deck',
      declined: 'The other player did not allow a look at their deck'
   },
   revealHand: {
      question: 'Reveal your hand?',
      hint: name => `${name} wants to reveal your hand to you.`,
      waiting: 'Waiting for opponent to allow a reveal of their hand',
      accepted: 'Allowed - revealing their hand',
      declined: 'The other player did not allow their hand to be revealed'
   },
   reveal: {
      question: 'Reveal your cards?',
      hint: name => `${name} wants to reveal cards of yours.`,
      waiting: 'Waiting for opponent to allow a reveal',
      accepted: 'Allowed - revealing',
      declined: 'The other player did not allow the reveal'
   }
}

/* the ask that is outstanding on this board, or null: `{ id, kind, from, fromName, payload }` */
export const consent = writable(null)

/*
   What this player's side of the pending ask is.

   `true` for the player who asked - they are the one waiting on an answer - and `null` for
   everybody else, which is what puts the Yes/No in front of the other player and in front
   of nobody else. Set from who asked rather than kept as state of its own, so there is no
   second copy of "who asked" to drift from the first.
*/
export const myConsentVote = writable(null)

/* the endings, one per kind, registered by the modules that own what they act on */
const endings = new Map()

/*
   Register what a kind's answer does.

   `yes(payload)` runs on the **asker's** board with whatever the ask carried, and is where
   the gesture actually happens; `no()` is optional and is for anything the asker's own
   screen needs to undo or put away.
*/
export function onConsent (kind, { yes, no = null } = {}) {
   endings.set(kind, { yes, no })
   return () => endings.delete(kind)
}

/*
   Whether this player may ask for anything at all.

   A spectator has no board of their own to clear and no cards of their own to reveal, and
   the relay refuses a non-chat event from one - so this is the UI's half of a rule that is
   enforced on the other side too. Solo is not a room: there is nobody to ask.
*/
export function canAskConsent () {
   return Boolean(room.get()) && !solo.get() && !spectating.get()
}

/*
   Ask the other player, and answer whether the ask went out.

   `payload` is whatever the kind needs to finish the gesture on the asker's board when the
   answer is yes: the ids and pile a look was about, and nothing at all for a new game. It
   travels with the event so the *answerer's* client can describe what is being asked - and
   so a client that never had the gesture still knows what it was, which is what makes this
   survive a reload mid-ask.
*/
export function askConsent (kind, payload = null) {
   if (!KINDS[kind]) return false
   if (!canAskConsent()) return false

   const from = myId.get()
   const fromName = playerName.get() || null
   const id = `${kind}:${from}:${Date.now()}`

   /*
      Raised **here** as well as sent, because our own event is never delivered back to us
      (`emit` in relay/client.js). Without this the player who asked would see nothing at
      all while the other player was shown a question - which is the one thing a two-sided
      handshake cannot be.
   */
   put({ requestId: id, kind, from, fromName, payload })
   share('consentAsked', { requestId: id, kind, from, fromName, payload })

   return true
}

/*
   The other player's answer, from the prompt.

   A *Yes* runs the kind's ending on this board and on the asker's - the asker's through the
   event, this board's here (a board never receives its own events). A *No* changes nothing
   and is reported back to the asker, on their own screen, which is the only screen the
   answer is about.

   The asker is refused here, and this is the **enforcement** of "only the player who was
   asked answers": the prompt does not draw a Yes for them either, but a rule that lived only
   in the prompt would be a rule a second caller could ignore.
*/
export function answerConsent (yes) {
   const request = consent.get()
   if (!request || !canAskConsent()) return
   if (request.from === myId.get()) return

   share('consentVote', { requestId: request.id, yes: Boolean(yes) })
   answer(request.id, Boolean(yes))
}

/* one answer onto the pending ask */
function answer (requestId, yes) {
   const request = consent.get()
   if (!request || request.id !== requestId) return

   clear()
   run(request, yes)
}

/* run a kind's ending, on whichever board is running it */
function run (request, yes) {
   const ending = endings.get(request.kind)
   const kind = KINDS[request.kind]
   const mine = request.from === myId.get()

   /*
      The player who asked is the one waiting on this, and the one for whom the answer is
      news: the answerer already knows what they answered. So the message is said to the
      asker, on their own screen, and the ending runs where the gesture belongs.
   */
   if (yes) {
      if (ending?.yes) ending.yes(request.payload || null, { mine })
      if (mine) showMessage(kind.accepted)
      return
   }

   if (ending?.no) ending.no(request.payload || null, { mine })
   if (mine) showMessage(kind.declined)
}

/* the ask is over, however it ended */
function clear () {
   consent.set(null)
   myConsentVote.set(null)
}

/*
   A new ask, on this client: the question is put up, and this player has not answered.

   `myConsentVote` is set from who asked rather than from any vote: the asker is the one
   waiting (true), and everybody else in the room is the one being asked (null).
*/
function put ({ requestId, kind, from, fromName, payload }) {
   if (!requestId || !KINDS[kind]) return

   consent.set({
      id: String(requestId),
      kind,
      from: from || null,
      fromName: fromName || null,
      payload: payload ?? null
   })

   myConsentVote.set(from && from === myId.get() ? true : null)
}

/* the other player is asking: the question appears on this screen */
react('consentAsked', (data) => put(data))

/* the other player's answer to an ask of ours */
react('consentVote', ({ requestId, yes }) => answer(String(requestId), Boolean(yes)))

/*
   Out of the room, and the ask goes with it: nobody is left to answer, and an answer about
   a room this browser has walked out of must not act on a board it no longer has.
*/
react('leftRoom', () => clear())
