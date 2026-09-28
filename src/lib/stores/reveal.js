import { derived } from 'svelte/store'
import { writable } from './custom/writable.js'
import { share, react, publishLog, publishLogTo, spectating, myId, seatedPlayers as seated, onBoardCleanup } from './connection.js'
import { askConsent, onConsent } from './consent.js'
import { solo } from './soloState.js'

/*
   Reveal, Look and Reveal Hand: the three ways a player is shown cards out of somebody
   else's pile.

   They are the same gesture with three different audiences, which is the whole of the
   difference between them:

      Reveal        both players are told the cards, by an event; the window is the
                    revealer's own reading of them
      Look          the player who looked is shown them, and so is anybody watching the
                    table - the watchers by the game log, and the looker by the window.
                    The opponent gets neither the window nor the ids behind it (see the
                    note over `shareLook`)
      Reveal Hand   the whole of one player's hand, in the Look's window, for the player
                    who asked

   They are deliberately one module: they share the permission rule below, and
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
   What travels for a Look, and who it is for
   -------------------------------------------------------------------------

   A `cardsLooked` event carries the same shape as a reveal's, and it is a
   different kind of thing: a reveal is addressed to the room, and a look is
   addressed to **the player who took it and the room's watchers**. The deck being
   read is the opponent's, and an id out of a face-down deck is exactly what that
   deck withholds - so the owner of the deck must not be handed the ids, and the
   relay is what enforces that (`audienceOf` in the events route). The client
   asks for an audience, the relay decides it from membership, and a poll answers
   each member only what is theirs.

   That is also why a Look travels at all, having once not: a watcher sitting at a
   table where a look happens was shown nothing at all, and the named log line is the
   report of it. What a Look does not become is shared in the sense a Reveal is: the
   opponent is not told. And the **window** belongs to the looker alone, which is where
   this differs from the two gestures beside it - see `cardsLooked`.

   -------------------------------------------------------------------------
   The permission: the "allowed to take action on this opponent card" property
   -------------------------------------------------------------------------

   A card shown by a Reveal, a Look or a Reveal Hand is a card the player may act
   on *on the other player's side*: move it to that player's discard, put it into
   play as one of their Pokemon, and so on. The permission is not a field written
   onto the card object, and it is not "one of the cards a batch holds" either. It
   is **the card as the window carries it**: one of the cards the batch of a window
   that is on screen is showing, carried by that batch's own pile - which is the
   pile a window hands its cards (`asPile`) and is not any pile of the board. All
   three, because any one of them alone leaks:

      - the **batch** alone cannot outlive the board it was about, and it is
        replaced wholesale by the next gesture - but a batch reads a pile the
        mirror already holds, so its cards *are* the objects the board's own zones
        draw, and "one of the cards of the batch" answered for the same card in
        the opponent's hand zone, behind the window, and again after the window
        was closed
      - its **pile** alone is not enough either, because a batch deliberately
        outlives its window (see below) - so a closed window's batch would go on
        granting a permission with nothing on screen to use it on
      - a **flag on the card** cannot work at all: a card object is shared between
        a board and its mirror within one client, so a property written onto one
        would follow it onto the owner's own board, where it would offer the
        opponent's menu for their own card
      - and a **set of ids kept beside the cards** is the failure mode of both:
        a second source of truth that drifts the moment a move forgets to write it

   So the rule is `isActionable(card, pile)` - the card, and the pile the gesture
   is carrying it with - and the answer is that the pile is the batch of a window
   that is up, a card of which is on show. A window hands over its batch; every
   zone of the board hands over the zone (`opponent/Hand.svelte`,
   `opponent/Stadium.svelte`, the bench slots), and a zone is never a batch, so **in
   a room the opponent's cards on the board are not actionable at all** - which is
   the rule the report asked for in as many words: *cards should only be actionable
   in the Reveal Hand window*.

   Both halves of a Reveal carry the same batch, because both were told the same
   event. A Look's batch is the looker's alone, and a watcher - if one is handed
   the batch at all - is refused by `isActionable` for the same one line.

   A Look's batch is deliberately *kept* when its window is closed (`lookOpen`
   goes false, the cards stay in store): the card said "look at the top X cards",
   so those cards are what the player is looking at whether or not the panel is on
   screen. Close is a view being dismissed, not an undo. **What closing does end
   is the permission**, because the permission is the batch *as a window hands it
   over* - and a closed window hands nothing over.
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

/*
   The Live view of a Reveal Hand batch: the hand's own cards, and it shrinks as they are
   acted on exactly as a Look's does - see `viewOf`. It needs a store of its own for the
   same reason the other two do: a hand is a pile on the owner's board, and a card leaving
   it writes no event on the reader's board.
*/
export const handRevealView = writable([])

export const reveal = writable(null)

/*
   The Look batch on this board, or null: what was looked at. The same shape as a
   Reveal batch with three fields of its own, and a Look is only ever about the
   far half's deck - so `owner` is always 'theirs' and `ownerHere` is always
   'mine' for the player who took it.

      `looker`   the member id of the player who looked, or null when that is
                 this board - which is what picks the pile the batch reads
                 (`theirPileFor`), and what tells a watcher's board which of its two
                 mirrors the ids came from
      `seat`     `looker`'s seat in the game's own order; null locally. It is what a
                 board that is *not* the looker can name the half by, and nothing
                 draws it now that the Look window is the looker's own - it stays on
                 the batch because the event carries it and `backToDeck` matches a
                 watcher's batch by it (see `lookSeat`)
      `remote`   whether this batch arrived from the other board. A look that is
                 *ours* is the player's own reading and ends with Close &amp;
                 Shuffle; one that arrived was taken by somebody else and has no
                 ending of its own.

   `theirHere` is the pile store the batch reads, resolved by the owner of the
   mirrors: the looker's own, or - for a watcher - the mirror of the player the
   looker was reading. See `registerTheirPile`. `pileName` is what says *which* of
   that player's piles: a Look reads `'deck'`, a Reveal Hand `'hand'`.
*/
export const look = writable(null)

/*
   The Reveal Hand batch on this board, or null: the whole of one player's hand, shown to
   the player who asked for it.

   It is a Look in every respect but the pile it reads and the ending it has, so it is the
   same shape of batch, applied by the same function, and drawn by a window that is a
   copy of the Look window (`dialogs/HandReveal.svelte` says why it is a copy rather than
   a parameter). `pileName` is `'hand'`, which is what picks the hand off the member the
   batch names.

   **There is no `frozen` state and no shuffle**, because a hand is not a deck: a reveal
   of a hand shows cards in a pile that is not being read in an order, and the order a
   hand is held in is the owner's own business. So its window has one ending - Close - and
   the batch is never frozen.
*/
export const handReveal = writable(null)

/*
   Whether a window is on screen. A batch outlives its window (see the note
   above), so "what was shown" and "what is on screen" are two questions and two
   stores: one boolean could not say "closed, and still the batch".
*/
export const revealOpen = writable(false)
export const lookOpen = writable(false)
export const handRevealOpen = writable(false)

/*
   What the three windows are showing, as one store: each window's batch, the cards that
   batch is showing right now, and whether the window is on screen at all.

   It exists for the **recomputation** rather than for the answer. `isActionable` reads the
   batches, their views and the record of what has been spent *itself* - it is the one place
   the rule lives - so a component that writes `$: actionable = isActionable(card, pile)` has
   given the compiler **no inputs at all**: the statement is compiled as depending on `card`
   and `pile`, runs once when the card is created, and keeps that answer for the card's whole
   life. Measured, and reported: the cards of the opponent's hand zone were built before the
   Reveal Hand window opened, so they answered none of it - and a board state that rebuilt
   them while the window was open left them answering after it was closed (*after the "Reveal
   Hand" window closes the cards in the opponent's hand are still actionable*). The same
   snapshot is why a card that was moved and put straight back into its pile - *To Top of
   Deck* - went on offering its menu.

   So a component reads this store and hands the value to `isActionable`
   (`$windows` in `opponent/Card.svelte`): the rule stays in one function, and the
   subscription that keeps a component's answer live is the component's. A caller with no
   component to subscribe in - a menu entry, a drop handler - calls `isActionable` without it,
   and the same value is read at the moment it asks, which is what a gesture wants.
*/
export const windows = derived(
   [ reveal, look, handReveal, revealView, lookView, handRevealView, revealOpen, lookOpen, handRevealOpen ],
   () => windowsOnShow()
)

/* what the three windows hold at this instant: the batch, its live view, and whether it is up */
function windowsOnShow () {
   return [
      { batch: reveal.get(), view: revealView.get(), open: revealOpen.get() },
      { batch: look.get(), view: lookView.get(), open: lookOpen.get() },
      { batch: handReveal.get(), view: handRevealView.get(), open: handRevealOpen.get() }
   ]
}

/* the player's own deck, registered rather than imported (see below) */
let myDeckStore = null

/*
   The player's own lists, registered for the same reason as the deck: the one
   question `isWindowPile` has to ask about a pile is whether it is *this* board's,
   and a board's own `piles()` is the authority on that (see custom/board.js).
*/
let pilesStore = null

/*
   The player's own selection, registered for the same reason again, and it answers the
   one question the view cannot: whether a batch's cards have *gone* or merely not
   arrived (see `actedOn`).
*/
let selectionOf = null

/*
   The far half's deck, registered by `opponent.js` for the same reason.

   It is a **function of the looker** rather than one store, and that is what a
   spectator needs: a look taken by either player arrives with the cards of the
   deck that player was reading, and on a watcher's screen the two players' decks
   are two different mirrors (`spectatorOpponents`). So the answer is
   "the mirror of the deck `lookerId` was reading", which only the module that
   owns the mirrors can give - `resolveTheirDeck(null)` being this board's own
   view, where "the other player" is the single mirror.
*/
let resolveTheirDeck = null

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

/*
   The two decks, as a table keyed by this board's words for a half.

   `theirs` is the far deck *this* board is looking at - the single mirror - which
   is what a Reveal names a half by and what a look taken here reads. A look taken
   by somebody else is a different deck depending on who took it, and that is
   `theirPileFor`'s question rather than this table's.
*/
const decks = () => ({ mine: myDeckStore, theirs: theirPileFor(null, 'deck') })

/*
   The pile a batch reads, which is the one thing a Look, a Reveal and a Reveal Hand
   do not all answer the same way.

   A Reveal names a half in the *sender's* words and `pileFor` flips that word onto
   this board's two decks. A Look and a Reveal Hand have no half to flip - both are
   always about the far half of the *reader's* own board - so the answer is asked of
   the reader: this board's far mirror when the batch is ours, and the mirror of the
   player the reader was reading when it is a watcher's. `registerTheirPile` is where
   that question is answered, because the mirrors are `opponent.js`'s. The pile is
   *named* as well, because the two gestures read two different things: a Look reads
   a deck, a Reveal Hand reads a hand.
*/
function theirPileFor (readerId, pileName) {
   return resolveTheirDeck ? resolveTheirDeck(readerId ?? null, pileName) : null
}

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

/* the player's own `piles()`, registered by player.js so a drop can ask what is whose */
export function registerPiles (piles) {
   pilesStore = piles
}

/* the player's own selection, registered by player.js so a batch can ask what was acted on */
export function registerSelection (selection) {
   selectionOf = selection
}

/*
   The far half's piles, registered by `opponent.js` for the same reason.

   `resolve` is handed the reader's member id - null for this board - and the *name* of the
   pile that reader is reading (`'deck'`, `'hand'`), and answers with the store.

   It is a name as well as a member, and that is what a Reveal Hand needed on top of what a
   Look needed. A Look is always about a deck, so "which member" was the whole question; a
   Reveal Hand is always about a hand, and a hand and a deck are two piles of the same
   member - so the pile is named rather than assumed, and one registration answers both.
*/
export function registerTheirPile (resolve) {
   resolveTheirDeck = resolve
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
/*
   The pile a batch is a view of.

   A Reveal names a half in the sender's words, and that word is this board's own
   once `applyReveal` has flipped it (`ownerHere`). A Look and a Reveal Hand have no
   half to name - both are always about the pile the reader was reading - so
   `theirPileFor` answers them from the reader and the pile they read.

   The two are told apart by the field each one carries and the other does not: a
   Look and a Reveal Hand both name the member that read (`looker`), and a Reveal
   never does.
*/
function pileOfBatch (batch) {
   return batch.looker !== undefined
      ? theirPileFor(batch.looker, batch.pileName)
      : decks()[batch.ownerHere] || null
}

function viewOf (batch) {
   if (batch.frozen) return batch.frozen

   const pile = pileOfBatch(batch)
   if (!pile) return []

   const cards = pile.get()
   return batch.cards
      .map((id) => cards.find((card) => card._id === id))
      .filter(Boolean)
}

/*
   Whether a batch's cards have **left the game** rather than merely not arrived yet.

   The distinction the view cannot make on its own, and the whole of whether a window that
   goes empty has ended: an empty view means "these ids are not in the deck", and the deck
   is not in place yet at the moment a batch lands on a board that is still being told what
   the board holds (see `setBatch`). Reading the two as one thing made a window blink out
   and back in.

   So the answer is asked of the **selection**: a card of the batch that the player has
   picked out is a card being acted on, and the batch is spent. The selection is also what
   the gesture was about, so a batch with cards missing from the deck and **nothing** of it
   selected is a batch whose deck has not arrived, and it is left alone to fill in.
*/
function actedOn (batch) {
   if (!selectionOf) return false

   const chosen = selectionOf()
   if (!chosen.length) return false

   return batch.cards.some((id) => chosen.some((card) => card._id === id))
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

   **A batch that has gone empty is left alone unless its cards have actually gone**
   (see `actedOn`): a window whose cards left the deck is a window that is over, and one
   whose deck has not arrived yet is a window that is still filling in. Clearing on the
   first is what the shuffle and a spent batch rely on; clearing on the second was what
   made the window blink out.

   `watching` guards against a timer or subscription from a replaced batch: two
   reveals in a row would otherwise both be feeding one window.
*/
function setBatch (which, view, batch) {
   stopWatching()

   /*
      A new gesture, so nothing has been acted on in it yet - see the note over `spentIds` for
      what leaving the last window's record in place costs.
   */
   spentIds.clear()

   which.set(batch)
   view.set(viewOf(batch))

   const deck = pileOfBatch(batch)
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

   It is also **the pile the permission is asked of** (`isActionable`): a batch object is
   made once per gesture and handed to every card in that gesture's window, so "is this
   card carried by that batch" is one identity test - and a zone of the board, which is
   what the same card objects are handed where the board draws them, is a different
   object and refuses.
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
   hold the same objects (`viewOf`). What is kept is every id the event named: a card
   that leaves the deck afterwards drops out of the *view* of the batch rather than
   out of the record.

   **A batch is dropped when there is no deck to read it against, and not when the
   deck is momentarily empty** - an empty view is the ordinary state of a board whose
   full state has not arrived yet, and giving up on it is the failure the note below is
   about. Measured with a spectator in the room: the mirror read 0 for a moment, the
   reveal landed in that moment, and a guard that gave up on an empty view never opened
   the window on that board at all. `actedOn` is what tells the two apart.
*/
function applyReveal ({ owner, pileName, cards }, senderIsMe = false) {
   trace.push({ owner, senderIsMe, count: cards?.length })
   if (trace.length > 8) trace.shift()

   const source = pileFor(owner, pileName)

   /*
      A batch is kept while its deck has not arrived, and dropped once its cards have been
      acted on - see `actedOn`, which is the whole of the difference. `!cards.length` is the
      one case that is meaningless either way: an event that named nothing is not a reveal.
   */
   if (!source || !Array.isArray(cards) || !cards.length || actedOn({ cards })) {
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
   both, and a Look is only ever shuffled by the player who took it (`lookCloseAndShuffle`
   is not offered to a watcher) so `pileFor` and `pileOfBatch` agree about which deck that is.

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

/*
   What a look found, for the log of the player who took it and the room's watchers.

   The same audience as the window, and the same reason: the cards were read out of a
   face-down deck, so the record of *which* cards belongs to the people who were shown them.
   The deck's owner is not among them - their log keeps the unnamed `lookLine`, which is
   what tells them a look happened without telling them what was in it.

   The names are read on the board that holds the deck, at the moment of the look, which is
   the same reading the window is built from (`topIds`). Both routes find them the same way
   if the deck moves - a card acted on afterwards leaves this line alone, because a log is a
   record of what was done rather than of what is still there.
*/
function lookedLine (names) {
   return `Looked at [${names.join(', ')}]`
}

export function closeLook () {
   lookOpen.set(false)
}

/* ------------------------------------------------------------------ a hand -- */

/*
   Reveal the whole of the opponent's hand: the window, the log line, and the flag that
   turns the hand face up on its owner's board.

   ---------------------------------------------------------------------------
   Why this is a window and no longer a toggle
   ---------------------------------------------------------------------------

   The board had a *Reveal Hand* before this and it was one line on the **player's own**
   hand menu that flipped `handRevealed`: the opponent read "Reveal Hand", clicked it, and
   their own hand turned face up on the other player's board. It was asked for as a window
   - *when Reveal Hand is clicked it should show a window showing the entire of the
   opponent's hand with a Close button* - so the entry moved to the hand it is about (the
   opponent's, where `opponent/Hand.svelte` renders it).

   **The hand itself stays hidden, and that was asked for too**: *when "Reveal Hand" is
   selected the cards in the hand zone should remain as Hidden Cards*. So this gesture sets
   no per-zone flag at all - there is no `handToggle` and no face-up hand behind the window -
   and the window is the whole of what it shows. That is also the reading that keeps the
   gesture honest: the cards are the opponent's, the player is being *shown* them, and the
   zone they came from goes on looking exactly as it did, to both players.

   That also means a Reveal Hand leaves no trace on the table that a later reader could
   mistake for the owner turning their own hand up: the log line is the record, and the
   window is for the player who asked.

   ---------------------------------------------------------------------------
   Who sees it, and who is told
   ---------------------------------------------------------------------------

   The audience is the Look's: the player who asked for it, and the room's spectators.
   The hand's **owner** is not among them - `revealedHand` is addressed the way
   `cardsLooked` is, and `audienceOf` in the relay's events route adds every watcher from
   membership - because the ids in the payload are cards out of a hand, which is the one
   pile the opponent is not shown. Their copy of the gesture is the log line, which is what
   they are entitled to: that it happened.

   **The hand's owner is asked first** (see the note over `askFor`). It used to be
   unilateral - *when the player performs this action it should just happen and add to the
   game log* - and that is what changed: a hand is the pile its owner is not shown, so
   turning it up is a thing done to them rather than a thing done by the player asking. The
   log line and the window are unchanged; what is new is that the owner said yes.
*/
export function revealHand () {
   if (!canReveal()) return false

   const pile = theirPileFor(null, 'hand')
   if (!pile) return false

   /*
      An empty hand is nothing to look at, and a window over it would be a panel saying
      "0 cards" with a Close button - so the gesture is refused rather than half-made.
      Nothing is logged for it either: nothing happened. And it is refused *before* the
      owner is asked, because asking them to show a hand that is not there is not a
      question anybody can answer usefully.
   */
   if (!pile.get().length) return false

   return askFor('revealHand', { count: pile.get().length }, () => showHand())
}

/* the reveal itself, once the hand's owner has allowed it */
function showHand () {
   const pile = theirPileFor(null, 'hand')
   if (!pile) return false

   const ids = pile.get().map((card) => card._id)
   if (!ids.length) return false

   /*
      `reader` is this player's own member id rather than null, and that is what lets a
      *watcher's* board find the hand the batch is about: a batch names the member whose pile
      it reads, and this one is read off the reader's own board (`theirPileFor` above), where
      "the hand" is the far half's - so the two agree here, and on a spectator's board the id
      is what picks which of its two mirrors to read (`theirPileFor` in opponent.js).
   */
   if (applyHandReveal({ reader: myId.get(), pileName: pile.name, cards: ids }, false)) {
      handRevealOpen.set(true)
   }

   publishLog("Revealed opponent's hand")
   return true
}

export function closeHandReveal () {
   handRevealOpen.set(false)
}

/*
   Apply a Reveal Hand batch, from either side - the same one function for the reader and
   for everyone told about it that a Look and a Reveal have, and for the same reason.
*/
function applyHandReveal ({ reader, pileName, cards }, remote) {
   if (!Array.isArray(cards) || !cards.length) {
      clearBatch(handReveal, handRevealView)
      return null
   }

   const batch = {
      looker: reader ?? null,
      remote,
      pileName: pileName || 'hand',
      cards: cards.slice()
   }

   batch.pile = asPile(batch)
   setBatch(handReveal, handRevealView, batch)
   return batch
}

/*
   Close a Look and shuffle the deck it was about.

   The shuffle is shared, and it *has* to be: the deck belongs to the other
   player, and a shuffle is state of theirs. What is not shared is who saw what -
   the cards the player looked at stay between the looker and the watchers the look
   was reported to, and the opponent is told nothing beyond the deck rearranging
   itself, which is exactly what a card that says "shuffle that deck" looks like
   from their side too.

   This is the looker's ending and only the looker's, which is why it is here and not the
   whole of `closeLook`: a batch this board did not take is somebody else's look, and a
   shuffle is somebody else's deck changing (see `remote`). Such a board draws no window
   either (see `cardsLooked`), so the guard is the rule said once rather than a button
   being withheld.
*/
export function lookCloseAndShuffle () {
   lookOpen.set(false)

   const batch = look.get()
   if (!batch || batch.remote) return

   freeze(look, lookView)
   shareShuffle(batch)
}

/*
   Whether a card may be acted on as one of the *other* player's.

   Three things make it so, and **all** of them are needed:

      - the window that is showing the cards is **on screen** (`open`)
      - the card is one of the cards that window is showing (the batch's live view)
      - the card is being carried by **that window's pile** - `pile` is what the window
        handed it, and a window hands over its batch (`asPile`)

   The pile is the whole of "only in the window", and it is what the report was about:
   *the Reveal Hand window allows the owner's cards in the Hand Zone to be selected ...
   cards should only be actionable in the Reveal Hand window*. A batch reads a pile the
   mirror already holds - a hand, a deck - and `viewOf` resolves its ids against that very
   pile, so a window's cards **are** the objects the board's own zones draw. An answer that
   asked only "is this one of the batch's cards" therefore said yes to the same card in the
   opponent's hand zone, behind the window, and went on saying it after the window was
   closed. Asked of the pile as well, the same card is refused wherever the board draws it,
   because a zone hands over the zone (`opponent/Hand.svelte`, `opponent/Stadium.svelte`, the
   bench slots) and a zone is never a batch - which is the same rule stated the other way:
   **in a room, a card of the opponent's on the board is never actionable**, whether it was
   put there by a window, by its owner, or by nobody at all.

   The open flag is what makes "only in the window" true of the *store* rather than only of
   the screen: the batch outlives its window by design (see the note above), so a rule that
   ignored the flag would go on answering for a pile that no window is handing over any
   more. It also means a closed window's cards stop answering at once, whatever a
   component's own snapshot of the answer happens to be.

   It asks the batch's live view rather than its record of ids, so a card that has already
   been moved out of the pile stops answering, and `oppAction.js` refuses it a second time.

   **A spectator is refused here**, and that is the whole of how a spectator's window is
   read-only: it sees the same batch (see the note over `cardsLooked`), and every way of
   acting on those cards - the click, the menu, the drag, `oppAction.js` - asks this one
   question first. One refusal at the source rather than a `$spectating` test in each of
   them, which is the same rule `share()` applies from the other end.

   It is also what keeps a Look the looker's: a watcher is refused by the same line, and the
   opponent never had the batch at all - the relay does not send it there.

   `showing` is what a *component* subscribes to (see `windows`), and the default is the
   same value read at the moment the call is made. A caller that has a `$` to read should
   pass it, or its answer is a snapshot of the moment the card was created.

   **A card this player has already moved stops answering**, and that is what `spent` is for -
   see the note over it. Without that, a card sent to the owner's *hand* stayed actionable for
   ever: it is still in the pile the batch reads, so the live view still shows it, and the card
   could be picked up and sent somewhere else a second time.
*/
export function isActionable (card, pile = null, showing = windowsOnShow()) {
   if (!card || !pile) return false
   if (spectating.get()) return false
   if (spentIds.has(card._id)) return false

   return showing.some(({ batch, view, open }) => open && batch && batch.pile === pile && view.includes(card))
}

/*
   The ids of the cards **this player has already acted on** out of the window that is open.

   Why a set of ids and not one of the two things that look like they should answer it:

   - **the view is not enough**, and that is the fault this exists for. A window's view is
     "the batch's cards that are still in the pile", which is what makes a card that leaves a
     *deck* leave the window. But a card sent to the owner's **hand** is still in a pile the
     batch can read, so it is still on show - correctly, it is in their hand - and it went on
     answering clicks. Measured: right-click a card in a Reveal Hand window, *To Hand*, and the
     card is in the opponent's hand **and** still selectable and still draggable.
   - **the record of the batch is not enough either**: `batch.cards` is what was *named* by the
     gesture, and a card leaves it only when the batch is replaced (see `applyReveal`, which
     keeps the ids the event named so the window can fill in late).
   - **nothing on the card**, because a card object is shared between a board and its mirror
     within one client - the same reason the permission is not a flag on the card at all (see
     the note above).

   Ids rather than objects, for the reason the batches use ids: a mirror holds *copies* of the
   cards, and the object a window draws is the mirror's copy rather than the one the owner's
   board holds.

   **It is emptied when a new batch is put up** (`setBatch`), and that is not tidiness - it is
   what keeps the record from outliving the gesture it belongs to. Ids are handed out per
   *board load* (`loadDeck` in custom/board.js numbers them 1..n), so a board that is reloaded -
   an import, an adopted board state, a spectator's mirror being filled - hands the same ids to
   entirely different cards. Measured: without the reset, a check that moved a card and then
   took a *fresh* look at a reloaded board found the new window's cards already marked spent,
   and every drag of them refused. The batch is the gesture, so the record of what that gesture
   has done is exactly as long-lived as the batch.
*/
const spentIds = new Set()

/* record that these cards have been acted on, so a window stops offering them */
export function spendCards (cards) {
   for (const card of cards || []) {
      if (card?._id !== undefined) spentIds.add(card._id)
   }
}

/* exported for `tools/render-check.mjs`, which asks the permission rather than the window */
export function spentCount () {
   return spentIds.size
}

/*
   Whether a drag carrying this pile is a **window's** card rather than one of the
   board's own.

   It is the mirror of `isDraggingRevealed` in `oppAction.js`, for the half that has
   to *refuse* a window's card instead of taking it: every zone of the player's own
   side asks this before it accepts a drop, so a card out of a Reveal or a Look
   cannot be carried onto the player's own board - nor onto the table or the
   Stadium, which are cells the halves meet in and which each half plays its own
   cards into. The two halves of that rule are deliberately in the two modules that
   own them: this one answers "is this a window's card", `oppAction.js` answers
   "may this board act on it".

   The test is whether the pile the drag carries is one of the player's own lists,
   which is the same question `board/Card.svelte` asks to pick the right menu - a
   window hands its cards a *batch*, and a batch is not a pile of this board's.

   It is off in solo, where both halves are the same person and a window's cards
   are played on the far half from this keyboard (see `opponent/Card.svelte`).
*/
export function isWindowPile (pile) {
   if (!pile || typeof pile !== 'object') return false
   if (solo.get()) return false
   if (!pilesStore) return false

   return !pilesStore().includes(pile) && !pile.theirPile
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
   Whose deck a Look batch is showing, as a **seat** - or null when the batch is the
   looker's own reading.

   A Reveal answers a window with a half in this board's words (`revealOwnerHere`),
   because both boards have the same two halves and only the words for them differ.
   A Look cannot: a board that is not the looker's mirrors *both* players, so "theirs"
   is not one half of its screen but one half of the looker's - which is a seat, and
   the seat is the only thing either board can agree on.

   **Nothing draws it any more.** A watcher's Look window was the one thing that had to
   name the half it was showing, and it is gone (see `cardsLooked`): the window is the
   looker's own, so its heading is the looker's own words for the far half. The seat is
   still on the batch - the event carries it, and `backToDeck` matches a watcher's batch
   by it - so this read stays as the one way to ask for it.

   Exported rather than called from a component, and that is the other half of the
   lesson: a component that says `$: seat = lookSeat()` leaves the compiler nothing to
   see as an input, and the value it keeps is the one it was built with (see the note in
   `docs/gotchas.md`).
*/
export function lookSeat () {
   const batch = look.get()
   return batch && batch.remote ? batch.seat : null
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
   -------------------------------------------------------------------------
   Asking the other player before reading their cards
   -------------------------------------------------------------------------

   A Reveal of their cards, a Look at their deck and a Reveal Hand are all *their* cards, so
   all three now ask first: the owner is shown the consent dialog (see stores/consent.js) and
   the gesture happens only on a yes. This player's own cards are not asked about - revealing
   your own is yours to do - which is the distinction `revealTop` makes.

   **Every gesture asks**, which was asked for in as many words: a player searching their deck
   may look several times in a turn, and each of those is a separate reading of somebody else's
   pile. There is no "remembered" consent to expire, and a *No* is per gesture for the same
   reason.

   The pending gesture is **one slot**, and the consent handshake allows one outstanding ask,
   so there is nothing to match up: `askFor` stashes what a yes would do, the ask goes out, and
   the answer either runs it or drops it. A second gesture asked while one is in the air
   replaces the slot and the ask, exactly as the reveal batches replace each other - there is
   one player to ask, one question to put, and one answer to give between them.

   What travels in the ask is the **words**, not the gesture: a count is what the owner needs to
   understand the question ("the top 3 of your deck"), and everything needed to *perform* it -
   the pile, the ids - is this board's own and is read again at the moment it runs. That is
   deliberate: a payload carrying ids would be a second copy of the deck's contents sent to the
   one client that must not have it.
*/
let pendingGesture = null

/*
   One ending per kind, registered for every kind that has a pending gesture - and the
   registration is registered **once** per kind. `onConsent` keeps one ending per kind, so a
   second call for the same kind replaces the first: written as two calls (a `yes` one and a
   `no` one) the `no` silently took the `yes`'s place and a granted look ran nothing at all.
*/
for (const kind of [ 'reveal', 'look', 'revealHand' ]) {
   onConsent(kind, {
      /* only the board that asked has a gesture waiting, so only that board runs it */
      yes: (_payload, { mine }) => { if (mine) runPending() },
      no: () => dropPending()
   })
}

/*
   Ask the owner, and remember what a yes would do.

   The `no` ending is registered as well as the `yes` one and does the same thing for every
   kind - put the gesture down - so it lives here beside the slot rather than in each of the
   three callers.
*/
function askFor (kind, payload, run) {
   pendingGesture = run
   if (askConsent(kind, payload)) return true

   /* nothing was asked - no room, or a spectator - so there is nothing pending either */
   pendingGesture = null
   return false
}

/* the answer was yes: do the thing that was asked about */
function runPending () {
   const run = pendingGesture
   pendingGesture = null
   if (run) run()
}

/* the answer was no, or the ask was replaced: the gesture is not this player's to make */
function dropPending () {
   pendingGesture = null
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

   **The other player's deck is asked about first** (see the note over `askFor`), and this
   player's own is not: revealing your own cards is yours to do. Which of the two this is
   is the same question the owner is derived from, so it is asked once.
*/
export function revealTop (pile, asked) {
   if (!pile || !canReveal()) return false

   const count = topCount(pile, asked)
   if (!count) return false

   if (pile === myDeckStore) return showReveal(pile, count)

   return askFor('reveal', { count }, () => showReveal(pile, count))
}

/* the reveal itself, once it is this player's to make */
function showReveal (pile, count) {
   if (!pile) return false
   shareReveal(pile === myDeckStore ? 'mine' : 'theirs', pile, topIds(pile, count))
   return true
}

/* the top `count` cards of a deck, as ids, top of the deck first */
function topIds (pile, count) {
   return pile.get().slice(-count).reverse().map((card) => card._id)
}

/*
   Look at the top X cards of the far half's deck.

   It is a function here rather than in the menu so that the reading of the deck -
   which end is the top, and what "top X" means - is stated once for both gestures.

   The batch is applied here *first*, exactly as a Reveal's is, so the player who
   looked sees their own window at once: their own events are never handed back to
   them, so nothing else would show it. What it is *not* is `setBatch` alone: the
   ids are shared, because a Look is *reported* to the room's watchers as well as
   kept by the player who took it (see `shareLook`).

   **The deck's owner is asked first** (see the note over `askFor`): the cards come out of a
   pile they are not shown, and the whole of a face-down deck is that its owner does not have
   to show it. A look is also the most private of the three gestures - its cards are the
   looker's and the watchers', and the owner is told only that a look happened (see
   `lookLine`) - which is exactly why it is the one worth asking about.
*/
export function lookTop (asked) {
   const pile = pileFor('theirs', 'deck')
   if (!pile || !canReveal()) return false

   const count = topCount(pile, asked)
   if (!count) return false

   return askFor('look', { count }, () => showLook(count))
}

/* the look itself, once the deck's owner has allowed it */
function showLook (count) {
   const pile = pileFor('theirs', 'deck')
   if (!pile) return false

   const left = topCount(pile, count)
   if (!left) return false

   shareLook(pile, topIds(pile, left))
   return true
}

/*
   Show the top of a deck to the looker, and tell the room's watchers what was seen.

   The event carries the same three things a reveal's does, and a fourth that only
   a look needs: **whose** look it was. A reveal's cards are the room's, and each
   board finds them in the deck the event names; a look's cards are one player's
   reading of the other player's deck, so a board that is not the looker's - which
   mirrors *both* players - has to be told which of its two mirrors the ids came from.
   The looker's member id is that answer, and it is also what the relay addresses the
   event to: the looker and the spectators, never the owner of the deck.

   **The window is the looker's and the report is the watchers'.** The looker's own
   board opens it here; a board the event arrives at applies the batch and does not open
   one (`cardsLooked`), and reads the named log line below instead. A batch that arrived
   is a *reading* of somebody else's look rather than that board's own, which is what
   `remote` records on it: it has no ending of its own, because both of a look's endings
   are the looker's (see `lookCloseAndShuffle`).
*/
function shareLook (pile, ids) {
   const batch = applyLook({ looker: null, cards: ids }, false)
   if (batch) lookOpen.set(true)

   /*
      Who the relay is to address the look to. The looker is the sender and already
      knows; the watchers are not named here - the relay finds every spectator in the
      room from membership, so a client cannot name a member it should not reach (see
      `audienceOf`).
   */
   const to = [ myId.get() ]

   share('cardsLooked', {
      looker: myId.get(),
      lookerSeat: seatOf(myId.get()),
      pileName: pile.name,
      cards: ids,
      to
   })

   /*
      Two lines, and they go to different people.

      The **unnamed** one is the room's: it says a look happened and nothing about what was
      in it, which is what the deck's owner is entitled to know. The **named** one goes to
      the looker and the watchers, who are the people the look was reported to - it is the
      log's copy of what the window is drawing for the looker.
   */
   publishLog(lookLine(ids.length))
   publishLogTo(lookedLine(namesOf(pile, ids)), to)
}

/*
   Which seat, in the game's own order, a member id holds - the index the relay
   lists the two players in, which is what tells a watcher's board which of its two
   mirrors a look is about (`Board.svelte` puts seat 0 on the top half and seat 1 on
   the bottom, before its own flip). Null for a member that is not seated.
*/
function seatOf (id) {
   if (!id) return null
   const index = seated.get().findIndex((player) => player?.id === id)
   return index === -1 ? null : index
}

/*
   Apply a Look batch, from either side.

   The one function for the looker and for everyone told about it, for the same
   reason `applyReveal` is: two routes onto one board is how the two boards come to
   disagree about what was on show.

   `looker` is the member id of the player who took the look, or null when that is
   this board. `seat` is the same player's seat, for a board that is not the looker's
   to name the half by (`lookSeat`); `remote` says the batch arrived rather than being
   taken here, which is what says this board has no ending of its own for it
   (`lookCloseAndShuffle`).

   The record is the ids the event **named**, not the ones this board could find at
   this instant - the same rule as a reveal's, and for the same reason: the full
   board state a watcher is replaying can still be in flight when the look lands, so
   a record of what was found would be permanently short. The *view* is what fills
   in, and `setBatch`'s poll keeps asking until the deck has it.
*/
function applyLook ({ looker, lookerSeat = null, pileName, cards }, remote) {
   if (!Array.isArray(cards) || !cards.length) {
      clearBatch(look, lookView)
      return null
   }

   const batch = {
      looker: looker ?? null,
      seat: lookerSeat,
      remote,
      pileName: pileName || 'deck',
      /* a look is always a reading of the deck the looker was looking at */
      ownerHere: 'theirs',
      cards: cards.slice()
   }

   batch.pile = asPile(batch)
   setBatch(look, lookView, batch)
   return batch
}

/* ------------------------------------------------------------------ wiring -- */

/*
   Their Reveal, arriving.

   The **batch** is applied through the same function the revealer used, so the two boards
   cannot disagree about what was shown - and it is applied for everyone, because it is
   what makes those cards actionable and what the acting board's permission is checked
   against.

   **The window opens for the player who revealed and for nobody else**, which is the
   audience the gesture actually has. Everyone else is told by the game log, which names the
   cards (`revealLine`): a reveal is a public act, so the log is the record of what the
   table was shown, and a window over another board is the same information a second time
   on a board whose player is not the one doing the revealing. The opponent said so - *the
   cards are shown in the game log* - and a spectator has always read it that way.

   This handler is the *receiving* side and only ever runs on a board that is not the
   revealer's: a player's own events are never handed back to them (see `emit` in
   relay/client.js), so the revealer's window is opened by `shareReveal` itself. So the
   batch is applied here and the window is not opened at all - and the batch still travels,
   deliberately: it is the *record* of what was shown, and the two boards' copies of a
   gesture are supposed to be the same one. It is **not** a permission on this board,
   because the cards a reveal names are in a pile this board draws as one image (a
   face-down deck) and the permission is only ever asked of a card a *window* is carrying
   (see `isActionable`). Withholding the batch to withhold the window would have left the
   two boards holding different accounts of the same act.
*/
react('cardsRevealed', (data) => {
   /* one function, one word: the sender's `owner` is what the batch keeps (see `pileFor`) */
   const applied = applyReveal(data)

   /* nothing to show - so nothing is left on screen either */
   if (!applied) revealOpen.set(false)
})

/*
   Their Look, arriving - which is a look taken by *one* player, on a board that is
   either the looker's own or a watcher's.

   The event reaches the player who took the look and the room's watchers, and never
   the owner of the deck that was looked at: the ids it carries come out of a
   face-down deck, and that deck is the one thing the owner is not shown (see
   `audienceOf` in the relay's events route). So this handler is never run on the
   opponent's board with a batch about somebody else's look.

   **The window opens for the looker and for nobody else.** It used to open on a watcher's
   board too - a Look is a public act with a private meaning, and a watcher shown nothing at
   all is being told the game is not being played - and it was reported as a window in the
   way: *when a player looks at the X cards on the opponent's deck it should not bring up the
   Look window for the spectator*. A reading of somebody else's deck is not the watcher's
   screen to have a panel over, which is the same rule the Reveal window has always followed
   (*a window is the player's own reading, and the table is told by the log*). What a watcher
   is told is the **named log line**, which is the report of the look and is what the event
   is still addressed to them for (`shareLook` -> `publishLogTo`).

   The batch is still applied on both, because it is the record of the gesture and the two
   boards' copies of it should not differ; a watcher has nothing to act on it with
   (`isActionable` refuses a spectator). `remote` therefore only says "this arrived rather
   than being taken here" - it is what takes the shuffle ending off a batch this board did
   not take (`lookCloseAndShuffle`), which is now a window such a board never draws.

   `looker` being this board's own member id is what makes it ours.
*/
react('cardsLooked', ({ looker, lookerSeat, pileName, cards }) => {
   const mine = !looker || looker === myId.get()
   const batch = applyLook({ looker, lookerSeat, pileName, cards }, !mine)

   if (!batch) {
      lookOpen.set(false)
      return
   }

   if (mine) lookOpen.set(true)
})

/*
   Their Reveal Hand, arriving - which is a hand shown by *one* player, on a board that is
   either the reader's own or a watcher's.

   The event reaches the player who asked and the room's watchers, and never the owner of
   the hand: the ids it carries are cards out of a hand, and a hand is the pile its owner
   is not shown. That is the Look's rule, the Look's machinery, and the Look's reason (see
   `cardsLooked`). So this handler is never run on the owner's board with a batch about
   somebody else's hand.

   The window opens on both the reader's board and a watcher's: the reader reads their own
   reveal, and a watcher reads the one they are watching. What differs is only what a
   window may do with it, and for this gesture that is nothing at all - the window has a
   Close button and no other ending, because a hand has no order to shuffle and the cards
   belong to somebody else.
*/
react('handRevealed', ({ reader, pileName, cards }) => {
   const mine = !reader || reader === myId.get()
   const batch = applyHandReveal({ reader, pileName, cards }, !mine)

   if (!batch) {
      handRevealOpen.set(false)
      return
   }

   handRevealOpen.set(true)
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

   if (reveal.get()?.ownerHere === here) {
      freeze(reveal, revealView)
      return
   }

   /*
      A Look's batch is named by *whose* look it was rather than by a half, so a board
      that is not the looker's matches its copy by that player: a look is a reading of
      the looker's far half, which is the deck of the *other* seat. On the looker's own
      board there is no seat on the batch (`seat` is null for a look taken here) and
      nothing to do either - `lookCloseAndShuffle` froze that batch before it shared
      the shuffle.

      That board draws no window now (see `cardsLooked`), so the freeze it makes is the
      batch's *record* being kept in step rather than a panel being held open: the deck
      on its screen has been rearranged, so the cards the batch named still belong to it
      rather than vanishing as a live view would (see `freeze`).
   */
   const batch = look.get()
   if (batch && batch.seat !== null && watchSeat(batch.seat) === seatOf(localOwner(owner))) {
      freeze(look, lookView)
   }
})

/*
   The seat a watcher's board shows for the deck a look was of.

   A look by the player in seat `lookerSeat` is a reading of that player's far half,
   which is the *other* player's deck - and the halves a watcher shows are the two
   seats in order (see `setPlayers` in opponent.js). So the deck the shuffle is
   about is the one on the half of the seat that is not the looker, and a batch
   about any other deck is not this board's business.
*/
function watchSeat (lookerSeat) {
   const players = seated.get()
   if (players.length < 2) return lookerSeat
   return lookerSeat === 0 ? 1 : 0
}

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
   clearBatch(handReveal, handRevealView)
   handRevealOpen.set(false)
   spentIds.clear()
}

onBoardCleanup(clearBatches)

/* exported so a check can put this module back without going through a room */
export function resetRevealState () {
   clearBatches()
}

