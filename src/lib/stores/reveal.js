import { writable } from './custom/writable.js'
import { share, react, publishLog, spectating, onBoardCleanup } from './connection.js'
import { solo } from './soloState.js'
import { defaultOpponent } from './opponent.js'

/*
   Reveal and Look: the two ways a player is shown cards out of a deck.

   They are the same gesture with two different audiences, which is the whole of
   the difference between them:

      Reveal   both players are shown the cards. The window appears on both
               boards, and either player may act on the cards afterwards.
      Look     only the player who looked is shown them. Nothing is sent, so the
               other player does not know it happened and sees no window.

   The two are deliberately one module: they share the permission rule below, and
   a second copy of "these cards may be acted on" is the copy that goes stale.

   -------------------------------------------------------------------------
   What travels for a Reveal, and why the cards are not in the event
   -------------------------------------------------------------------------

   A `cardsRevealed` event carries card *ids* and the name of the pile they are
   in - never the card objects. Both clients already hold the cards (the far half
   of a board is a mirror of it, and a mirror is handed every card its owner's
   board holds), so an id is enough, and a payload of full cards would be a second
   copy of something the wire already carries.

   The event *states* the batch rather than announcing it, so one handler serves
   the player who revealed, the opponent who was shown and a spectator: the batch
   is derived from the cards the event names, found in the pile it names. A card
   that is not there any more - drawn, moved, discarded - is simply not one of
   the cards on show.

   -------------------------------------------------------------------------
   The permission: the "allowed to take action on this opponent card" property
   -------------------------------------------------------------------------

   A card shown by a Reveal or a Look is a card the player may act on *on the
   other player's side*: move it to that player's discard, put it into play as one
   of their Pokemon, and so on. The permission is not a field written onto the
   card object. It is answered by the batch - a card is actionable exactly when it
   is one of the cards of an open batch - and that is deliberate, because it is
   the only shape of the rule that cannot leak:

      - it cannot outlive the board it was about: this store is reset with the
        board, and a batch is replaced wholesale by the next one
      - it must not be a property of the card: a card object is shared between a
        board and its mirror within one client, and a flag on it would follow the
        card onto the owner's own board, where it would offer the opponent's menu
        for their own card
      - it needs no second source of truth, which is the failure mode of a set of
        ids kept beside the cards: it drifts the moment a move forgets to write it

   Both halves of a Reveal carry the same batch, because both were told the same
   event - so both players may act, which is what a reveal means: the cards are
   known to the table. A Look's batch is local, so only the player who looked has
   it, and only they may act.

   A Look's permission is deliberately *kept* when its window is closed
   (`lookOpen` goes false, the batch stays): the card said "look at the top X
   cards", so those cards are what the player is looking at whether or not the
   panel is on screen. Close is a view being dismissed, not an undo.
*/

/*
   The Reveal batch on this board, or null.

   `{ owner, pileName, cards, pile }`, where `owner` is the half the deck belongs to
   in *this* board's words ('mine' is this player's deck), `cards` is the record of
   what the gesture showed, and `pile` is the live view of it that the window and
   the permission both read (see `asPile`).
*/
export const reveal = writable(null)

/*
   The Look batch on this board, or null: what the player was shown privately.
   The same shape as a Reveal batch, and a Look is only ever about the far half's
   deck - so `owner` is always 'theirs' and is not stored.
*/
export const look = writable(null)

/*
   Whether a window is on screen. A batch outlives its window (see the note
   above), so "what was shown" and "what is on screen" are two questions and two
   stores: one boolean could not say "closed, and still the cards in hand".
*/
export const revealOpen = writable(false)
export const lookOpen = writable(false)

/* the player's own deck, registered rather than imported (see below) */
let myDeckStore = null

/*
   `player.js` registers its deck here. Importing it would be a cycle - player.js
   imports connection.js, this module imports connection.js and opponent.js, and
   opponent.js imports player.js - and the note in connection.js is the long
   account of why a cycle here is a 500 on every page load rather than a subtlety.
*/
export function registerOwnDeck (deck) {
   myDeckStore = deck
}

/*
   The pile a batch names, on the board that owns it.

   `owner` is the word the *reader* of the batch uses: 'mine' is this board's own
   deck (`myDeckStore`, registered by player.js) and 'theirs' is the mirror's. That
   is the convention everywhere below, and it is the one the two windows are
   written in - "Your deck" / "Your opponent's deck" - so the batch's own field
   means the same thing as the heading it draws.

   The *wire* word is the other way round, and the two are flipped in exactly one
   place: the `owner` an event carries is written by the player who acted, so their
   'mine' is this board's mirror. `localOwner` below is that flip, and it is applied
   where the batch is built (`applyReveal`) and where an event is sent
   (`backToDeck`). Getting it wrong is quiet in the worst way - the batch would be
   gathered off the wrong deck, none of the ids would be found in it, and the window
   would never open on the other player's screen, which reads as the event not being
   relayed at all.
*/
function pileFor (owner, pileName) {
   if (pileName !== 'deck') return null
   return (owner === 'mine' ? myDeckStore : defaultOpponent.deck) || null
}

/* the sender's word for a half, said in this board's words */
function localOwner (senderOwner) {
   return senderOwner === 'mine' ? 'theirs' : 'mine'
}

/*
   The cards of a batch, read off the pile it names.

   `ids` is the event's own list and it is what fixes the *order*: a deck is read
   from its end (the card drawn next is the array's last - see the note over
   `placeOrdered` in custom/cards.js), so the ids arrive top-of-deck first and the
   cards are gathered in that order rather than in whatever order the pile happens
   to hold them.
*/
function gather (pile, ids) {
   if (!pile || !Array.isArray(ids)) return []

   const cards = pile.get()
   return ids
      .map((id) => cards.find((card) => card._id === id))
      .filter(Boolean)
}

/*
   The batch in the shape a pile has, which is what the two windows hand a card.

   It is a *view of the deck it was taken from* rather than a frozen list, and that
   is the whole of why it is built this way: a reveal says "these are the top cards
   of that deck", so the moment one of them moves - to a discard, into play, back
   into the deck - it is no longer one of the cards on show, and it should go from
   the window and stop answering clicks. A copy of the list taken at reveal time
   would keep offering a card that has already been sent somewhere, and the click
   would do nothing at all, silently.

   So `get()` is the batch's cards that are *still in the deck*: the window reads
   what is really there, and everything that asks "may this card be acted on" asks
   the same thing (`isActionable`). The `cards` array itself is kept because it is
   the record of the gesture - what was revealed - and it is what a card is
   recognized by.

   `name` is the deck's own name, so the menu and any log line that asks about the
   card's pile read the same string a pile would give them. What makes this
   recognizable as *not* one of the board's piles is the object: it is not in
   `piles()` (custom/board.js), and `board/Card.svelte` reads exactly that to pick
   the menu for somebody else's card. A flag beside the name would be a second
   answer to a question the board can already answer.
*/
function asPile (batch) {
   return {
      name: batch.pileName,
      source: batch.source,
      get: () => batch.cards.filter((card) => batch.source.get().includes(card)),
      subscribe: (fn) => { fn(asPile(batch).get()); return () => {} }
   }
}

/*
   Apply a Reveal batch, from either side.

   One function for the revealer and for everyone told about it, so the two boards
   cannot disagree about what was shown. What is kept is the whole batch - every id
   the event named that the deck still holds - rather than only the cards present
   at this instant: the batch is the record of the gesture, and a card that leaves
   the deck afterwards is filtered out of the *view* of it rather than out of the
   record (see `asPile`). A batch with nothing in it at all - every card named has
   already gone - closes the window rather than opening an empty one.
*/
function applyReveal ({ owner, pileName, cards }) {
   const mine = localOwner(owner)
   const source = pileFor(mine, pileName)
   const found = gather(source, cards)

   if (!source || !found.length) {
      reveal.set(null)
      revealOpen.set(false)
      return
   }

   reveal.set({ owner: mine, pileName, cards: found, pile: asPile({ pileName, cards: found, source }) })
}

/*
   Reveal the top of a deck, to both players.

   `owner` is 'mine' when the player revealed their own deck and 'theirs' when
   they revealed the opponent's; `pile` is that deck and `ids` are its top cards,
   top first - the order both windows read in.

   The batch is applied here *first*, so the player who revealed sees their own
   window at once: a player's own events are never handed back to them (see
   `emit` in relay/client.js), so nothing else would show it.
*/
export function shareReveal (owner, pile, ids) {
   if (!ids?.length) return

   applyReveal({ owner, pileName: pile.name, cards: ids })
   revealOpen.set(true)

   share('cardsRevealed', { owner, pileName: pile.name, cards: ids })
   publishLog(revealLine(owner, ids.length))
}

/*
   The line a reveal writes.

   It is written by the player who revealed, and the words are the table's: "the
   top N cards of their deck" is the deck they revealed, and the possessive is
   read from that player's chair - which is how every other line in the log is
   written (see `logPickup`, `logPlacement`).
*/
function revealLine (owner, count) {
   const cards = `${count} ${count === 1 ? 'card' : 'cards'}`

   return owner === 'mine'
      ? `Revealed the top ${cards} of their deck`
      : `Revealed the top ${cards} of the opponent's deck`
}

export function closeReveal () {
   revealOpen.set(false)
}

/*
   Close a Reveal and shuffle the deck it was about - the button beside Close.

   A reveal shows the top of a deck to the table, and the deck it showed is the
   one that is now unknown: the *whole* point of the ending is that the order the
   cards were read in does not survive it. So the shuffle is shared, and the
   window is closed here whatever the other player does with theirs - the two
   windows are each player's own reading of the same batch.
*/
export function revealCloseAndShuffle () {
   const batch = reveal.get()
   const owner = batch ? batch.owner : null
   const pile = owner ? pileFor(owner, batch.pileName) : null

   revealOpen.set(false)
   if (!pile) return

   pile.shuffle()
   /*
      The event carries the *sender's* word for the half - this board's 'mine' is
      the other board's 'theirs' - which is the same flip the batch's own field goes
      through when it arrives (see `localOwner`).
   */
   share('backToDeck', { owner: localOwner(owner) })
   publishLog('Shuffled Deck')
}

/*
   The look, written in the game log.

   A look through a deck is the one private look worth a line of its own (see
   `logDeckView` in logger.js, and the same reasoning): the opponent cannot see
   the cards, so a line that names nothing is what they are entitled to know
   happened.
*/
function lookLine (count) {
   const cards = `${count} ${count === 1 ? 'card' : 'cards'}`
   return `Looked at the top ${cards} of the opponent's deck`
}

export function closeLook () {
   lookOpen.set(false)
}

/*
   Close a Look and shuffle the deck it was about.

   The shuffle is shared, and it *has* to be: the deck belongs to the other
   player, and a shuffle is state of theirs. What is not shared is the window -
   the cards the player looked at stay in their own hand, and nothing tells the
   opponent that any of this happened beyond the deck rearranging itself, which
   is exactly what a card that says "shuffle that deck" looks like from their
   side too.
*/
export function lookCloseAndShuffle () {
   lookOpen.set(false)

   const pile = pileFor('theirs', 'deck')
   if (!pile) return

   pile.shuffle()
   share('backToDeck', { owner: 'theirs' })
   publishLog('Shuffled Deck')
}

/*
   Whether a card may be acted on as one of the *other* player's.

   Both batches answer it the same way, so it is one question and one function: the
   card is one of the cards currently *on show* in either of them. It asks the
   batch's live view rather than its record of ids, and that is the whole of why
   this is a function rather than a set membership test at the call site - a card
   that has already been moved is no longer on show, so it stops answering, and
   `oppAction.js` refuses it a second time (see the note over `asPile`).

   `opponent/Card.svelte` is what draws the answer: the cards that reply are the
   ones wearing the pulse.
*/
export function isActionable (card) {
   if (!card) return false

   return [ reveal.get(), look.get() ]
      .filter(Boolean)
      .some((batch) => batch.pile.get().includes(card))
}

/*
   Whether this board has anybody to reveal *to*.

   A Reveal is a shared act, so it belongs to a room with two players in it: solo
   has nobody to reveal to (both halves are one person), and a spectator does not
   own a board to reveal from. The rule is written here rather than only in the
   menus that offer the entries, so a new caller cannot miss it.
*/
export function canReveal () {
   return !solo.get() && !spectating.get()
}

/* --------------------------------------------------------------- the two acts -- */

/*
   How many cards off the top of a deck a gesture is about: what was asked for, or
   what the deck has - whichever is fewer. A number larger than the deck is the
   same gesture as the whole deck rather than an error, which is what "reveal your
   deck" means.
*/
export function topCount (pile, asked) {
   const x = Number(asked)
   if (!pile || !Number.isInteger(x) || x < 1) return 0
   return Math.min(x, pile.get().length)
}

/*
   Reveal the top X cards of a deck, to both players.

   The cards are read off the deck top-first - the order a deck is read in, which
   is what both windows show and what the log's "top N" means - and they never
   leave it. The batch is the *view*: a card is on show until the next reveal
   replaces the batch, which is why the deck's own order and its contents are
   untouched by this.

   `pile` is the deck to reveal, and which deck it is fixes the owner: the
   player's own is 'mine', the far half's is 'theirs'. That one fact is what the
   Close &amp; Shuffle action and both windows are about, so it is derived from the
   pile rather than passed in beside it - two arguments that have to agree are two
   arguments that can disagree.
*/
export function revealTop (pile, asked) {
   if (!pile || !canReveal()) return false

   const count = topCount(pile, asked)
   if (!count) return false

   shareReveal(pile === myDeckStore ? 'mine' : 'theirs', pile, topIds(pile, count))
   return true
}

/* the top `count` cards of a deck, as ids, top of the deck first */
function topIds (pile, count) {
   return pile.get().slice(-count).reverse().map((card) => card._id)
}

/*
   Look at the top X cards of the far half's deck, privately.

   The mirror of `revealTop` for the audience, and nothing else: the same cards in
   the same order, held in this client's own state instead of shared. It is a
   function here rather than in the menu so that the reading of the deck - which
   end is the top, and what "top X" means - is stated once for both gestures.
*/
export function lookTop (asked) {
   const pile = pileFor('theirs', 'deck')
   if (!pile || !canReveal()) return false

   const count = topCount(pile, asked)
   if (!count) return false

   const cards = pile.get().slice(-count).reverse()

   look.set({ pileName: 'deck', cards, pile: asPile({ pileName: 'deck', cards, source: pile }) })
   lookOpen.set(true)

   publishLog(lookLine(cards.length))
   return true
}

/* ------------------------------------------------------------------ wiring -- */

/*
   Their Reveal, arriving.

   Applied through the same function the revealer used, so the two boards cannot
   disagree about what was shown, and - for the two players - the window opens,
   because that is what a Reveal is: the opponent is meant to see it.

   A **spectator gets no window**, and that is a rule of the feature rather than a
   property of the event. Reveal and Look are the two players' own verbs: they are
   offered only in a room (see `canReveal`), and a watcher who is shown every
   reveal would be shown a tool it cannot use and was not meant to have. The batch
   is still applied, because that is what the other two boards are using it for -
   the permission to act on those cards - and it costs a watcher nothing to hold a
   list it will not act on. The window is the part that is withheld.
*/
react('cardsRevealed', (data) => {
   applyReveal(data)
   if (!spectating.get() && reveal.get()) revealOpen.set(true)
})

/*
   Their shuffle of the deck a Reveal or a Look was about.

   A shuffle is the *deck's* state rather than a window's, so it is applied
   whichever windows either player has closed: the order the cards were read in is
   gone either way, and a mirror that skipped it would hold an order its owner no
   longer has.
*/
react('backToDeck', ({ owner }) => {
   const pile = pileFor(localOwner(owner), 'deck')
   if (pile) pile.shuffle()
})

/*
   The board is gone: so is everything either window was showing.

   Registered rather than exported for a caller to remember, because the two
   batches are the state that must not outlive the room: one names cards of a
   board that no longer exists, and the other is the permission to act on them.
   `connection.js` owns the "empty this board" moment and hands it out (the same
   hook player.js and the mirrors use).
*/
function clearBatches () {
   reveal.set(null)
   revealOpen.set(false)
   look.set(null)
   lookOpen.set(false)
}

onBoardCleanup(clearBatches)

/* exported so a check can put this module back without going through a room */
export function resetRevealState () {
   clearBatches()
}
