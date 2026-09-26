import { writable } from './custom/writable.js'
import { share, react, publishLog, spectating, onBoardCleanup } from './connection.js'
import { solo } from './soloState.js'

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

   `{ owner, senderIsMe, ownerHere, pileName, cards, ordered, pile }`:

      `owner`       the half the deck belongs to in the **sender's** words
      `senderIsMe`  whether this board is the revealer (local, never sent)
      `ownerHere`   the same half in *this* board's words, for the heading
      `cards`       the record of the gesture: the ids that were shown
      `ordered`     those ids resolved against the deck, and what the window draws
      `pile`        the deck's name and shape, so a card can be handed a pile

   `ordered` is a store of its own and not a computed list, and that is the point of
   the whole shape: the window has to *update* when a card leaves the deck - which
   happens on the owner's own board, with no event, because a player's own events are
   never handed back to them - and Svelte can only see that through a store it
   subscribes to. `setView` below is what pushes it, from a subscription to the deck
   itself.
*/
export const revealView = writable([])
export const lookView = writable([])

export const reveal = writable(null)

/*
   The Look batch on this board, or null: what the player was shown privately. The
   same shape as a Reveal batch, and a Look is only ever about the far half's deck -
   so `owner` is always 'theirs' and `ownerHere` is always 'mine'.
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

/* the same, for the far half: the mirror's deck, registered by opponent.js */
let theirDeckStore = null

/* which batch the live subscription below belongs to, so a stale one can be dropped */
let watching = null

/*
   Which batch is following its deck, for `tools/reveal-check.mjs` through
   `$lib/util/dev-debug.js`.

   One slot rather than one per kind, because only one window is ever the live one: a
   new batch of either kind stops the last one's watch. It is a read of the store's own
   state, not a rule anywhere - what a shuffle is *about* is asked of the half an event
   names (see the `backToDeck` handler).
*/
export function watched () {
   const batch = watching?.batch
   if (!batch) return null
   if (batch === reveal.get()) return 'reveal'
   if (batch === look.get()) return 'look'
   return 'stale'
}

/*
   Every `applyReveal` this client has run, kept for `tools/reveal-check.mjs`.

   A reveal is applied by two different routes - the revealer applies its own batch
   before sharing it and the opponent's arrives as an event - and the two are
   supposed to be indistinguishable from outside. When they are not, the trail is
   what says which route ran and with whose word for the half.
*/
export const trace = []

/* the two decks, as a table keyed by this board's words for a half */
const decks = () => ({ mine: myDeckStore, theirs: theirDeckStore })

/*
   `player.js` registers its deck here, and `opponent.js` registers the mirror's.

   Neither is an import, and that is the point: player.js imports this module, this
   module is imported by components on both halves, and importing either board back
   would point the import graph at itself - which is a 500 on every page load rather
   than a subtle bug (the note in connection.js is the long account of it). What this
   module needs is one store from each board, and a registration is one direction of
   dependency where an import is two.
*/
export function registerOwnDeck (deck) {
   myDeckStore = deck
}

/* the far half's deck, registered by opponent.js for the same reason */
export function registerTheirDeck (deck) {
   theirDeckStore = deck
}

/*
   What a window is showing right now.

   Two answers, and which one applies is the batch's own state:

   - **live**, the ordinary case: the batch's ids read back off the deck, top first,
     in the deck's own objects. A card that has left the deck is simply not in the
     answer, which is what makes the window shrink as cards are acted on.
   - **frozen**, once the reveal has been ended with a shuffle: what was on show at
     that moment, kept as it is (`freeze`). The cards were revealed and the reveal is
     still on screen, so they stay - and the other player, whose window is still open,
     keeps the cards and the one button that closes it.

   Ids rather than objects, and that is not a detail: a **mirror holds copies of the
   cards, not the cards themselves** (`applyBoardState` reloads the list and `reset`
   builds fresh objects from it - see `copy` in custom/board.js), so a batch of card
   objects could not be matched against the board receiving it at all.
*/
function viewOf (batch) {
   if (batch.frozen) return batch.frozen

   const deck = decks()[batch.ownerHere]
   if (!deck) return []

   const cards = deck.get()
   return batch.cards
      .map((id) => cards.find((card) => card._id === id))
      .filter(Boolean)
}

/*
   Put a batch on screen, and keep it there.

   `which` is the store the batch belongs to (`reveal` or `look`) and `view` is the
   list store the window draws. Setting the batch is what starts the two things that
   keep it honest, and both are needed:

   **A subscription to the deck** refreshes `view` on every change to it, so a card
   that is moved out of the deck leaves the window at once - including on the
   *owner's* own board, where the move writes no event at all (a player's own events
   are not handed back to them, see relay/client.js), which is the case that made a
   computed list wrong.

   **A poll while the view is incomplete** covers the other direction: a batch that
   names cards this board does not hold *yet*. The two events that set a reveal up -
   the full board state and the reveal itself - are separate, and the board state can
   still be in flight when the reveal lands, so a view read once would be short by
   those cards for ever. The subscription cannot be relied on to fix it: `pile.push`
   mutates the array in place and calls `set` with the same object, and Svelte's
   writable does not notify when a value equals itself, so a deck can be filled
   without a single notification. The poll asks until the deck has caught up, and
   stops by itself when it has.

   `watching` guards against a timer or subscription from a replaced batch: two
   reveals in a row would otherwise both be feeding one window.
*/
function setBatch (which, view, batch) {
   stopWatching()

   which.set(batch)
   view.set(viewOf(batch))

   const deck = decks()[batch.ownerHere]
   if (!deck) return true

   const stop = deck.subscribe(() => view.set(viewOf(batch)))
   const timer = setInterval(() => {
      const now = viewOf(batch)
      if (now.length === batch.cards.length) return
      view.set(now)
   }, 250)

   watching = { stop, timer, batch }
   return true
}

/* drop a batch's subscription and its poll: nothing is on show any more */
function stopWatching () {
   if (watching?.stop) watching.stop()
   if (watching?.timer) clearInterval(watching.timer)
   watching = null
}

/* forget the batch entirely: nothing is on show any more */
function clearBatch (which, view) {
   stopWatching()

   which.set(null)
   view.set([])
}

/*
   The pile a batch names, on the board that owns it - **from the receiving board's
   perspective**.

   `owner` is the word an event carries, which is the *sender's*: their 'mine' is the
   deck they revealed, and on this board that is the mirror's if they are the other
   player. So this maps a sender's word onto this board's piles, and it is the only
   place that mapping exists.

   This is the flip that matters, and getting it wrong is quiet: the batch would be
   gathered off the opposite deck, none of the ids would be found in it, and the
   window would never open on the other player's screen - which reads as the event
   not being relayed at all. `localOwner` is the same flip said the other way, for the
   places that have to *print* or *shuffle* the half a batch is about.
*/
function pileFor (senderOwner, pileName) {
   if (pileName !== 'deck') return null
   return decks()[senderOwner] || null
}

/* the sender's word for a half, said in this board's words (and back again) */
function localOwner (senderOwner) {
   return senderOwner === 'mine' ? 'theirs' : 'mine'
}

/*
   The cards of a batch, read off the pile it names.

   Ids rather than objects, and that is not a detail: a **mirror holds copies of the
   cards, not the cards themselves** (`applyBoardState` reloads the list and `reset`
   builds fresh objects from it - see `copy` in custom/board.js), so the object the
   batch was built from on the revealer's board is not the object the mirror holds.
   Anything that matched a batch card by identity would find nothing on the board
   receiving the reveal, and the failure looks exactly like an event that never
   arrived.

   `ids` is the event's own list and it is what fixes the *order*: a deck is read from
   its end (the card drawn next is the array's last - see the note over `placeOrdered`
   in custom/cards.js), so the ids arrive top-of-deck first and the cards are read back
   in that order rather than in whatever order the pile happens to hold them.
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

   `get()` is the batch's ids resolved against the deck (`viewOf`), and `name` is the
   deck's own name, so the menu and any log line that asks about the card's pile read
   the same string a pile would give them.

   What makes this recognizable as *not* one of the board's piles is the object: it is
   not in `piles()` (custom/board.js), and `board/Card.svelte` reads exactly that to
   pick the menu for somebody else's card. A flag beside the name would be a second
   answer to a question the board can already answer.
*/
function asPile (batch) {
   const get = () => viewOf(batch)

   return {
      name: batch.pileName,
      get,
      /* the shape a store has, so a component may write `$pile` if it wants to */
      subscribe: (fn) => { fn(get()); return () => {} }
   }
}

/*
   Apply a Reveal batch, from either side.

   One function for the revealer and for everyone told about it, so the two boards
   cannot disagree about what was shown. `owner` is the word that arrived - the
   sender's - and it stays that way in the batch: it is what the wire means, and the
   places that have to print or shuffle the half ask `revealOwnerHere` for this
   board's word (see `pileFor`, which is the same mapping for a pile).

   `senderIsMe` is what makes that flip possible, and it is local: it is set by
   `shareReveal`, which is this board revealing, and left false by the handler that
   receives one. It never travels - the event's `from` already says who sent it, and
   the receiving client knows it is not the sender.

   The record is the **ids**, not the objects, because a board and its mirror do not
   hold the same objects (`viewOf`). What is kept is every id the event named that the
   deck still holds: a card that leaves the deck afterwards drops out of the *view* of
   the batch rather than out of the record. A batch with nothing in it at all - every
   card named has already gone - leaves no batch, and the caller keeps its window shut.
*/
function applyReveal ({ owner, pileName, cards }, senderIsMe = false) {
   trace.push({ owner, senderIsMe, count: cards?.length })
   if (trace.length > 8) trace.shift()

   const source = pileFor(owner, pileName)
   const found = gather(source, cards)

   if (!source || !found.length) {
      clearBatch(reveal, revealView)
      return false
   }

   const ownerHere = senderIsMe ? owner : localOwner(owner)

   /*
      The record is the ids the event **named**, not the ones this board could find at
      this instant, and that is load-bearing rather than tidy. The two events that set a
      reveal up are separate - the full board state and the reveal itself - so the board
      state can still be in flight when the reveal lands, and the batch then names cards
      this board does not hold yet. Keeping only what was found made that state
      permanent: the batch's record became "the two of the three I happened to have",
      the view matched it, and the healing poll below saw a batch that was complete and
      stopped looking. The third card never arrived, and the window stayed at two.

      Naming all of them makes the record the truth and the *view* the thing that fills
      in: a card that is not here yet is simply not on show, and the poll keeps asking
      until the deck has it. Measured, this was the difference between the other board
      showing two cards of the three revealed in about half of runs and showing three
      every time.
   */
   const ids = cards.slice()

   const batch = { owner, senderIsMe, ownerHere, pileName, cards: ids }
   batch.pile = asPile(batch)
   setBatch(reveal, revealView, batch)

   return true
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

   /*
      The batch is applied here *first*, so the player who revealed sees their own
      window at once: a player's own events are never handed back to them (see
      `emit` in relay/client.js), so nothing else would show it. A batch that could
      not be applied - a deck that has gone, cards that have already left it - opens
      nothing, and the log line below still says what was asked for, because that is
      what the player did.
   */
   if (applyReveal({ owner, pileName: pile.name, cards: ids }, true)) revealOpen.set(true)

   share('cardsRevealed', { owner, pileName: pile.name, cards: ids })
   publishLog(revealLine(owner, namesOf(pile, ids)))
}

/*
   What the ids a reveal named are *called*, for the log line - looked up in the deck the
   reveal was taken from, which is the only board that holds them at this moment.

   An id the deck no longer holds is skipped rather than printed as `undefined`: the
   reveal has already happened by the time this runs, and the line is a record of what was
   named, so a card that left in the same tick is better left out than named as a blank.
*/
function namesOf (pile, ids) {
   const cards = pile.get()
   return ids
      .map((id) => cards.find((card) => card._id === id)?.name)
      .filter(Boolean)
}

/*
   The line a reveal writes.

   It is written by the player who revealed, and the words are the table's: "the
   top N cards of their deck" is the deck they revealed, and the possessive is
   read from that player's chair - which is how every other line in the log is
   written (see `logPickup`, `logPlacement`).

   **The cards are named**, and that is the difference between this line and a Look's:
   a reveal is a public act, so the log is a record of what the table was shown, and a
   line that says only "the top 3 cards" leaves the one thing the gesture was *for*
   out of the record. The names sit in brackets the way every other line that names
   cards does (`logMove`), and the article follows them, so a reveal of one reads
   "Revealed [Pikachu] from the top of their deck" rather than "the top 1 card".

   A Look is the opposite and stays unnamed: the opponent cannot see those cards, so
   naming them would tell them what the look was for - which is exactly the
   information a face-down deck withholds (see `lookLine`).
*/
function revealLine (owner, names) {
   const whose = owner === 'mine'
      ? 'their deck'
      : "the opponent's deck"

   return `Revealed [${names.join(', ')}] from the top of ${whose}`
}

export function closeReveal () {
   revealOpen.set(false)
}

/*
   Close a Reveal and shuffle the deck it was about - the button beside Close.

   A reveal shows the top of a deck to the table, and the deck it showed is the one
   that is now unknown: the *whole* point of the ending is that the order the cards
   were read in does not survive it. So the shuffle is shared, and this window is
   closed here - its player has said they are done with it.

   The batch is **frozen** first, and that is what the other player's window depends
   on. A window draws the batch's cards that are still in the deck, and a shuffle
   leaves none of them there: without freezing, the cards would vanish from the
   *other* player's window the instant this button was pressed, and the window -
   which closes itself when it has nothing to show - would take its own buttons with
   it. That is a player losing a window they were still reading.

   And it is marked **shuffled**, which is what stops the deck being shuffled twice:
   the other player's window is still open, and their footer now offers Close alone.
   The reveal is a shared act, so its ending is one shuffle between the two of them.
*/
export function revealCloseAndShuffle () {
   const batch = reveal.get()
   revealOpen.set(false)
   if (!batch) return

   freeze(reveal, revealView)
   shareShuffle(batch)
}

/*
   Shuffle the deck a batch is about, and tell the other player.

   The pile is found with `ownerHere` - the batch's word in *this* board's terms -
   because that is the field both kinds of batch have: a Reveal's `owner` is the
   sender's word, while a Look has none at all because a look is always about the far
   half. `ownerHere` is the same pile either way, which is what makes this work for
   both.

   The **event** carries the sender's word, which here is `ownerHere` itself: on the
   board that sends it, "the half I am looking at" is the same string this board would
   write for the other board's deck, and `backToDeck`'s handler flips it once on the
   way in (see `localOwner`). Flipping it here as well sent `theirs` where the wire
   means `mine`, and the receiving board turned it back into `theirs` - so the shuffle
   was applied to the wrong deck and the batch it was about was never found. It looked
   like the event arriving with nothing to do.
*/
function shareShuffle (batch) {
   const pile = pileFor(batch.ownerHere, batch.pileName)
   if (!pile) return

   pile.shuffle()
   share('backToDeck', { owner: batch.ownerHere, shuffled: true })
   publishLog('Shuffled Deck')
}

/*
   Stop a batch following its deck, keeping what it is showing as it stands, and mark
   it shuffled.

   Freezing is an explicit act rather than something the view works out for itself,
   because the two are different answers to "what is on show": a card that is *moved*
   leaves the window (it is no longer one of the cards that were revealed), while a
   deck that is *shuffled* does not (the cards were revealed, and the reveal is still
   on screen). Only the caller knows which of the two it is doing.
*/
function freeze (which, view) {
   const batch = which.get()
   if (!batch || batch.frozen) return

   batch.frozen = view.get()
   batch.shuffled = true
   which.set(batch)
   stopWatching()
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

   const batch = look.get()
   if (!batch) return

   freeze(look, lookView)
   shareShuffle(batch)
}

/*
   Whether a card may be acted on as one of the *other* player's.

   Both batches answer it the same way, so it is one question and one function: the
   card is one of the cards currently *on show* in either of them. It asks the
   batch's live view rather than its record of ids, and that is the whole of why
   this is a function rather than a set membership test at the call site - a card
   that has already been moved is no longer on show, so it stops answering, and
   `oppAction.js` refuses it a second time (see the note over `asPile`).

   **A spectator is refused here**, and that is the whole of how a spectator's window is
   read-only: it sees the same batch (see the note over `cardsRevealed`), and every way of
   acting on those cards - the click, the menu, the drag, `oppAction.js` - asks this one
   question first. One refusal at the source rather than a `$spectating` test in each of
   them, which is the same rule `share()` applies from the other end.

   `opponent/Card.svelte` is what draws the answer: the cards that reply are the
   ones wearing the pulse.
*/
export function isActionable (card) {
   if (!card) return false
   if (spectating.get()) return false

   const inReveal = reveal.get() ? revealView.get().includes(card) : false
   const inLook = look.get() ? lookView.get().includes(card) : false

   return inReveal || inLook
}

/*
   Whose deck a Reveal batch is showing, in the words of **this** board - so a window
   can say it. `mine` is this player's own deck.

   `owner` on the batch is the *revealer's* word for the half, which is also the word
   the event carries, so it is already this board's word when this board is the
   revealer and has to be turned around when it is not (`senderIsMe`, which is set
   locally by `shareReveal` and never travels). `ownerHere` is that answer, computed
   once when the batch is applied, so a window reads a field rather than repeating the
   mapping - a heading that calmly names the wrong deck is the failure mode here.
*/
export function revealOwnerHere () {
   const batch = reveal.get()
   return batch ? batch.ownerHere : null
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

   /* ids, top of the deck first, and the batch resolves them against the deck itself */
   const ids = topIds(pile, count)
   const batch = { pileName: 'deck', ownerHere: 'theirs', cards: ids }

   batch.pile = asPile(batch)
   setBatch(look, lookView, batch)
   lookOpen.set(true)

   publishLog(lookLine(ids.length))
   return true
}

/* ------------------------------------------------------------------ wiring -- */

/*
   Their Reveal, arriving.

   The **batch** is applied through the same function the revealer used, so the two boards
   cannot disagree about what was shown - and it is applied for everyone, because it is
   what makes those cards actionable and what the acting board's permission is checked
   against.

   The **window** opens for the two players and not for a spectator.

      - a spectator no longer needs it: a reveal is written into the game log with the
        names of the cards (`revealLine`), so the table has been told what was shown, and a
        window over a watcher is the same information a second time on a board whose player
        is not doing anything with it
      - a player still needs it, and that is not about *reading* the cards either - it is
        the only place on their board those cards are **cards**. The revealed cards stay in
        the deck, and a face-down deck is one pile image (`opponent/Deck.svelte`), so a
        player with no window has nothing to right-click and no way to take the action the
        batch gives them permission for. The window is that affordance for both of them.

   It was once withheld from a spectator only, and then given to all three; the rule now is
   the one the gesture actually has - the two players act on what was revealed, a watcher
   is told about it.
*/
react('cardsRevealed', (data) => {
   /* one function, one word: the sender's `owner` is what the batch keeps (see `pileFor`) */
   const applied = applyReveal(data)

   if (!applied) {
      /* nothing to show - so nothing is left on screen either */
      revealOpen.set(false)
      return
   }

   if (!spectating.get()) revealOpen.set(true)
})

/*
   Their shuffle of the deck a Reveal or a Look was about.

   A shuffle is the *deck's* state rather than a window's, so it is applied whichever
   windows either player has closed: the order the cards were read in is gone either
   way, and a mirror that skipped it would hold an order its owner no longer has.

   It is also the other half of "one shuffle between the two of them": the board that
   did **not** press the button still has its window open, so its batch is frozen where
   it stands and marked shuffled - the cards stay on screen and its Close & Shuffle
   becomes a Close. Without that, the shuffle would empty the window's view, the
   window would close itself, and the button that would have closed it would go with
   it.

   Which batch it is about is asked of the **half the event names**, not of "the open
   batch": a board keeps the last reveal *and* the last look, and either may be the one
   a window is still showing. So this freezes the batch whose deck the shuffle is of,
   and a board that has no batch about that deck has nothing to do.
*/
react('backToDeck', ({ owner, shuffled }) => {
   const here = localOwner(owner)
   const pile = pileFor(here, 'deck')
   if (pile) pile.shuffle()

   if (!shuffled) return

   if (reveal.get()?.ownerHere === here) freeze(reveal, revealView)
   else if (look.get()) freeze(look, lookView)
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
   clearBatch(reveal, revealView)
   revealOpen.set(false)
   clearBatch(look, lookView)
   lookOpen.set(false)
}

onBoardCleanup(clearBatches)

/* exported so a check can put this module back without going through a room */
export function resetRevealState () {
   clearBatches()
}

