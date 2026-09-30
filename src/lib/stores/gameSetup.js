import { writable } from './custom/writable.js'
import { share, react, spectating, solo, room, myId, seatedPlayers, publishLog } from './connection.js'
import { cards } from './player.js'
import { defaultOpponent } from './opponent.js'
import { showMessage } from './message.js'

/*
   Setting a game up: the opening handshake of a room.

   A room's game does not begin with the deal - it begins with the two players sitting down,
   importing a deck each, and agreeing on who goes first. This module is that agreement, and
   the deal it ends in. It is the room's alone: solo deals both halves from one button and
   asks nobody anything (see GameActions.svelte).

   ---------------------------------------------------------------------------
   The phases, and what each one is waiting for
   ---------------------------------------------------------------------------

      idle     no setup is under way. *Game Setup* is the button that starts one
      coin     the player the room picked is choosing Heads or Tails. A coin *toss* is a
               flip somebody called, and the call is the half of it this waits for
      order    the call is made and the coin has come up, and the player who called it
               right is choosing to go first or second
      deal     the order is settled, both boards have dealt seven cards and six prizes,
               and the two are deciding whether to keep them
      live     both were ready, the game has started, and the row of setup buttons is gone

   ---------------------------------------------------------------------------
   Why the phase travels, and what travels with it
   ---------------------------------------------------------------------------
   Both players have to agree on which of those five the game is in, so every step is a room
   event: one player acts, tells the room, and both boards take the new phase from it. The
   event is not the state, though - the phase is applied locally by whoever acts and by
   whoever is *told*, which is the division the turn counter and the clock already use.

   Each event carries the whole agreed state rather than the one field that changed, so a
   client that reloads mid-setup and replays the room's log arrives at the same phase with
   the same caller and the same ready list.

   ---------------------------------------------------------------------------
   What this module deliberately does not touch
   ---------------------------------------------------------------------------
   No card, no pile and no board. The deal is a board action - shuffling, drawing seven and
   putting six prizes - and it belongs to the component that already does it, so it is
   *registered* here rather than imported: `onDeal` and `onStart` are handed over by
   GameActions.svelte, which is the module that owns the player's board.

   That is the direction `onBoardCleanup` and `onNewGameStart` already take, and for the same
   reason: this module is imported by the component, so importing the board back would point
   the import graph at itself (see the note in connection.js).
*/

export const PHASES = [ 'idle', 'coin', 'order', 'deal', 'live' ]

/*
   The flow, as both players see it.

   `chooser` is who the room picked to call the coin and `winner` is who called it right;
   `you` is this board's reading of each of them, kept as a store value rather than worked
   out in a template, because "you" is not a fact about the room. `first` is who the order
   put in front, which is a fact about the *game* rather than about the handshake - it is
   what the turn row starts from, and it is public so a late watcher knows it too.

   `ready` is who has pressed *Ready* for this game.

   The mulligans are **not** in here: they are one player's own, counted and read locally,
   and the log is where the table is told about them (see `myMulligans`).
*/
export const gameSetup = writable({
   phase: 'idle',
   chooser: null,
   winner: null,
   you: { chooser: null, winner: null },
   call: null,
   result: null,
   order: null,
   first: null,
   ready: []
})

const isPhase = (value) => PHASES.includes(value)

/* the playing seats that are actually taken, and whose they are */
const seats = () => (seatedPlayers.get() || []).filter(Boolean)

/* who a member is from this board's point of view, which is not a fact about the room */
const youAre = (id) => (id === myId.get() ? 'you' : 'them')

/* the word for a side, which is what the table calls it rather than the seat order */
const side = (order) => (order === 'first' ? 'First' : 'Second')
const face = (call) => (call === 'heads' ? 'HEADS' : 'TAILS')

/*
   The four guards and counters the flow keeps, declared **before** the seat watcher because
   `reset()` writes to all of them and the watcher can reach `reset()` as this module is being
   evaluated. `let` and `const` are in their temporal dead zone from the top of the file until
   the line they are declared on, and a write into that zone is a module that will not load at
   all - so this is placement rather than taste.

      dealtFor    the deal has happened for the phase this board is in, so it does not happen
                  twice on a board that is already holding its cards
      startedFor  the same for the start
      mulligans   this player's count, which is not part of what the room agrees
      countedFor  the deal the count above belongs to
*/
let dealtFor = null
let startedFor = false
let mulligans = 0
let countedFor = null

/* the count the row shows, so a player can see their own without reading the log */
export const myMulligans = writable(0)

/*
   **A setup belongs to two particular players, in one particular room.**

   The phase travels in the room's log and nowhere else, so if either of those changes while a flow
   is under way, both boards are left in a phase that was agreed by somebody - or in somewhere -
   that is no longer the case:
   
      a seat changing hands   the list of who is ready names a member who has gone, the new player
                              replays into a deal that happened before they arrived (and so has no
                              cards in front of them), and the phase can never come back down
      another room            this is the reported fault, and it is the reason this is watched on
                              the room as well as the seats. A player leaves a room and makes
                              another one with the same opponent: the seats are then the *same two
                              members in the same order*, so watching the seats had nothing to
                              notice - while the flow still held a `ready` list naming both of
                              them, and `bothReady()` was satisfied by a room that had not dealt a
                              card. The phase went to `live` on nothing, and *Game Setup* was not
                              drawn, so the second room could not be started at all.

   Watching the room rather than the events is what makes this survive a **reload**, which is the
   other half: resuming a session re-joins the same room, so a reset keyed on `joinedRoom` would
   wipe a setup the player is in the middle of. Keyed on the room id, a reload is not a change and
   the replay repairs the lists as it should.
*/
let seenRoom = null
let seatPair = null

function watchRoom () {
   const here = room.get() || null
   const pair = (seatedPlayers.get() || []).filter(Boolean).map((player) => player.id).join()

   /* out of a room: the next one is a new room rather than a change to this one */
   if (here === null) {
      seenRoom = null
      seatPair = pair
      return
   }

   const differentRoom = seenRoom !== null && seenRoom !== here
   const seatsChanged = seatPair !== null && pair !== seatPair && Boolean(pair)

   seenRoom = here
   seatPair = pair

   if (differentRoom || seatsChanged) resetSetup()
}

room.subscribe(watchRoom)
seatedPlayers.subscribe(watchRoom)

/*
   Whether the setup flow is this board's business at all: a room, a playing seat, and
   somebody in the other one.

   A spectator has no deck to import and no coin to call - the relay refusing a non-chat
   event from one is the enforcement - and solo has no second player to agree with.
*/
export function inSetupRoom () {
   return Boolean(room.get()) && !solo.get() && !spectating.get() && seats().length >= 2
}

/*
   Whether **both players have imported a deck**.

   The deck a player imported is the card list on their board, and it reaches the other
   player the way every board state does: this board holds its own in `cards` (see
   `importDeck` in player.js, which shares a `deckLoaded` carrying the list) and the other
   player's in the default mirror, whose `cards` the same `deckLoaded` and every
   `boardState` set. There is no imported-deck indicator to add, and adding one would be a
   second answer to a question the board already answers.

   The mirror's list is the authority for the opponent rather than their seat is: a player
   who has sat down but not imported has a seat and no cards, and a game cannot be dealt
   from a deck that is not there. Keeping *Game Setup* out of that state is what this is for.
*/
export const decksReady = writable(false)

function readDecks () {
   const mine = (cards.get() || []).length
   const theirs = (defaultOpponent.cards.get() || []).length
   decksReady.set(mine > 0 && theirs > 0)
}

cards.subscribe(readDecks)
defaultOpponent.cards.subscribe(readDecks)
seatedPlayers.subscribe(readDecks)

/*
   Where each phase sits in the flow, so a step that arrives *late* can be told from one that
   arrives next.

   **The room's own order is not the order a board applies them in.** The transport retries a
   failed send, so an event that was written first can land second - and the relay's poll hands
   over a whole batch at once, in sequence, which a board that has just reloaded takes in one
   go. A `setupStarted` delivered after the `setupCoin` that followed it would put the flow back
   to `coin`; the coin would then be callable a second time, and the toss would hand out a second
   order on top of the one already dealt.

   So a step is applied only if it is **not behind** where this board already is. Equal is
   allowed, and is the ordinary case: `setupReady` is put twice on the board that pressed it,
   once as its own action and once when the other player's arrives.
*/
const RANK = { idle: 0, coin: 1, order: 2, deal: 3, live: 4 }

/*
   The steps that are **one answer each**, and the field that is the answer.

   A step this names may be taken once for its phase and not again. That is what makes the two
   boards' automatic start safe rather than a race: both of them *may* begin the opening - they can
   each see the second deck land - and whichever event reaches a board first is the toss, with the
   second refused. The same is true of the order, which is one decision.

   It is not "a phase can only be written once": `setupReady` puts `deal` over and over, and the
   ready list is a union because of it. What is refused is a second *answer*.
*/
const ONE_ANSWER = { coin: 'chooser', order: 'winner' }

/*
   Taking the state the room has agreed.

   It **merges** rather than replaces: an event names what its own step decided - the caller,
   the coin, the order, the ready list - and a field it does not carry is one the room already
   agreed and still holds. Replacing wholesale would work for a full event and lose the order on
   a `setupReady`, which carries no order because it is not about one.

   **Ready is a union, and that is a reload repair rather than a nicety.** A client is never
   handed its own events back, so a player who reloads mid-setup replays *their own* `setupReady`
   away with the rest of their own log - their ready list comes back holding the opponent's id
   and not their own, while the opponent's still holds both. Taking the incoming list verbatim
   would then leave the reloaded board in `deal` for ever while the other one played on, and the
   Ready button it was still showing would publish that stale list back. Nobody stops being
   ready, so the answer is the one the two boards between them know.

   `clear` is the exception, and it exists because a union has no way out: a step that speaks for a
   list adds to it, and there is no value it could send that would take an entry away. Forgetting a
   setup has to mean forgetting, so `reset` passes this and the list is replaced instead.
*/
function put (state, { clear = false } = {}) {
   if (!isPhase(state?.phase)) return

   const before = gameSetup.get()
   if (RANK[state.phase] < RANK[before.phase]) return

   const answer = ONE_ANSWER[state.phase]
   if (state.phase === before.phase && answer && before[answer] != null) return

   const chooser = state.chooser ?? before.chooser ?? null
   const winner = state.winner ?? before.winner ?? null

   gameSetup.set({
      phase: state.phase,
      chooser,
      winner,
      you: { chooser: youAre(chooser), winner: youAre(winner) },
      call: state.call ?? before.call ?? null,
      result: state.result ?? before.result ?? null,
      order: state.order ?? before.order ?? null,
      first: state.first ?? before.first ?? null,
      ready: clear ? (state.ready || []) : union(before.ready, state.ready)
   })
}

/* the members in both lists, in the order they were first seen */
function union (before, incoming) {
   if (!Array.isArray(incoming)) return before
   return [ ...new Set([ ...before, ...incoming.filter(Boolean) ]) ]
}

/*
   Back to nothing under way: a room left, a game started over, or the two seats changing hands.

   **It is a hoisted declaration and that is load-bearing.** The seat watcher above runs as this
   module is evaluated, when the seats are still empty, and the flow's own guards are declared
   further down with `let` - so a `const` arrow here would be in its temporal dead zone at the
   moment the watcher reaches it, which is a module that will not load at all.
*/
function reset () {
   put({
      phase: 'idle',
      chooser: null,
      winner: null,
      call: null,
      result: null,
      order: null,
      first: null,
      ready: []
   }, { clear: true })
   dealtFor = null
   startedFor = false
   countedFor = null
   mulligans = 0
   myMulligans.set(0)
}

react('leftRoom', reset)

/*
   And a game started again, which is the *other* way a setup has to be forgotten.

   **A new game does not leave the room**, so the reset above never runs for it - and without
   this the two guards either side of the deal stay set for the life of the page. Measured
   consequence of leaving it out: the second game in a room deals *nothing* (the board stays
   empty behind a Ready button) and starts nothing (the clock frozen at fifty minutes, the turn
   where the last game left it), because `dealOnce` and `startOnce` are each once-per-page rather
   than once-per-game. The Mulligan button deals, which is what makes it look like a broken deal
   rather than a broken guard.

   It is exported rather than wired here because the module that *starts* a new game is the one
   that knows: `player.js` already registers its half of the restart with `onNewGameStart`, and
   GameActions calls this from beside that registration.
*/
export function resetSetup () {
   reset()
}

/* ------------------------------------------------------------------ the button --- */

/*
   Whether *Game Setup* can be pressed.

   Three things, and each is a different reason it cannot be: a player in each seat
   (`inSetupRoom`), a deck imported on **both** boards (`decksReady`), and a flow that has not
   already begun (`phase`). The button is the way *into* the opening, so it stands aside once the
   toss is under way - which is why the phase is read rather than a flag of its own.

   **A store read inside a function this is called from is invisible to Svelte**, so the caller
   binds the values it is about into its own reactive expression (see the note in
   GameActions.svelte). This function is still the one place the rule is stated, and `startSetup`
   still enforces it.
*/
/*
   Whether this board may begin the opening.

   **Everything here is a precondition, and none of it is a button.** The opening used to wait on a
   *Game Setup* press from each player; it waits on **the two decks** now. That is the same
   condition the lock was already drawn on - the board is covered while a player has not imported -
   so the moment the second deck lands there is nothing left to wait for, and asking for a press on
   top of it was asking the players to confirm something the room could already see.

   Read by `startSetup` and by the automatic start below, which is the only caller left.
*/
export function canStartSetup () {
   const open = Boolean(room.get()) && !solo.get() && !spectating.get() && seats().length >= 2
   const at = gameSetup.get().phase
   return open && at === 'idle' && decksReady.get()
}

/*
   Beginning the opening: one player is picked to call the coin.

   **It runs by itself, on whichever board sees the second deck arrive**, which is the board that
   imported it - and that board is not always only one. Each board has its own deck and its own
   mirror of the other's, and they fill in a different order, so both preconditions can become true
   at the same moment: measured on two browsers, both boards started the opening, both drew a caller,
   and each then received the other's event - so **both players were offered Heads or Tails** and the
   two were calling different coins.

   So the draw is **not** `Math.random()`. A chooser has to be one answer that both boards agree on
   the instant they make it, because either of them may make it first: it is the first seat, in the
   order the relay lists the seats, which is a value both already hold. Two boards drawing the same
   value cannot disagree about it, and the phase guard in `put` refuses a second step for a phase
   that already has one - so whichever event lands first is the toss.
*/
function startSetup () {
   if (!canStartSetup()) return false

   /* the *first* seat, which is the one the relay lists first and both boards can see */
   const players = seats().map((player) => player.id)
   const chooser = players[0]

   const agreed = { phase: 'coin', chooser }
   put(agreed)
   share('setupStarted', agreed)

   return true
}

/*
   The automatic start, on every change to the two things it waits for.

   **Watched on the seats as well as the decks**, because the order they arrive in is not fixed: a
   player who imported while alone in the room has `decksReady` false until the second seat is
   filled, and the seat arriving changes nothing about their deck - so a watcher on the decks alone
   would never fire for them, and the room would sit under the lock with both decks imported and
   nobody to start it.
*/
decksReady.subscribe(maybeStart)
seatedPlayers.subscribe(maybeStart)

function maybeStart () {
   if (gameSetup.get().phase !== 'idle') return
   if (!canStartSetup()) return

   startSetup()
}

/* --------------------------------------------------------------- the coin toss --- */

/* a fair coin: one bit, and the word for the face it landed on */
export function flipCoin () {
   return Math.floor(Math.random() * 2) ? 'heads' : 'tails'
}

/*
   Whether this board is the one being asked to call the coin.

   `phase` is passed in by the dialog rather than read here, because a caller inside a
   **component's** reactive statement needs the phase to be a dependency of its own expression -
   Svelte hoists a `$:` with no reactive dependency out of the component's update function and
   runs it once, so `calling = callsCoin()` was answered at instance creation and never again (see
   the note in GameSetupDialog.svelte). Called with nothing, it reads the store, which is what the
   check tools and any non-component caller want.
*/
export function callsCoin (phase = gameSetup.get().phase) {
   const state = gameSetup.get()
   return phase === 'coin' && Boolean(state.chooser) && state.chooser === myId.get()
}

/*
   The chosen player calling it.

   The call is written to the log the moment it is made - it is the player's own act, and the
   coin has not been flipped until they have made it - and the flip happens in the same
   breath, because a call whose result is undecided is a dialog with nothing behind it.
*/
export function callCoin (call) {
   if (!callsCoin()) return false
   if (call !== 'heads' && call !== 'tails') return false

   /*
      `Chooses Heads`, not `Player chooses Heads`: the relay names the sender on every line it
      delivers, so the line already reads *[Alice] Chooses Heads* and the word `Player` was the only
      thing in it that was said twice.

      **`face`, not `side`.** The two do the same thing for the turn order and different things for a
      coin: `side` answers `First` or `Second`, so a call of `heads` was written as *Chooses Second* -
      the one word that is never a coin face. Measured on two boards, which is how it was found.
   */
   publishLog(`Chooses ${face(call)}`)

   const result = flipCoin()
   const chooser = myId.get()
   /*
      The toss is the call against the coin: calling it right wins it, and a wrong call hands
      the choice to the other player. The winner is recorded either way - who won the toss is
      worth saying even when the choice that follows is not theirs.
   */
   const won = result === call
   const winner = won ? chooser : (seats().find((player) => player.id !== chooser)?.id || null)

   /* the deal is the next game's, and it starts with nobody ready */
   const agreed = { phase: 'order', chooser, winner, call, result, ready: [] }
   put(agreed)
   share('setupCoin', agreed)

   showMessage(`Coin flip result: ${face(result)}`)
   publishLog(`Coin flip: ${face(result)}`)

   return true
}

/* ------------------------------------------------ first or second, and the deal --- */

/* whether this board is the one choosing to go first or second (see `callsCoin` for `phase`) */
export function choosesOrder (phase = gameSetup.get().phase) {
   const state = gameSetup.get()
   return phase === 'order' && Boolean(state.winner) && state.winner === myId.get()
}

/*
   The winner of the toss deciding the turn order.

   Choosing *Second* does not make this player second: it says the other player goes first,
   and choosing *First* says this one does. Both are recorded, because they are two different
   things - what was chosen, and who it puts in front - and the turn row and the log want the
   second of them.
*/
export function chooseOrder (order) {
   if (!choosesOrder()) return false
   if (order !== 'first' && order !== 'second') return false

   const winner = myId.get()
   const taker = order === 'first' ? winner : (seats().find((player) => player.id !== winner)?.id || null)

   const agreed = {
      phase: 'deal',
      chooser: winner,
      winner,
      order,
      first: taker,
      ready: []
   }

   put(agreed)
   share('setupOrder', agreed)

   /* `Decided to go First`, for the reason the coin's line lost its `Player` too */
   publishLog(`Decided to go ${side(order)}`)

   return true
}

/* --------------------------------------------------------- the opening hand --- */

/*
   The deal, the redraw and the start, done by the board that owns them.

   Registered rather than imported, and a `Set` rather than one slot, for the reason
   `onBoardCleanup` is: this module is imported by the component that owns the board, so it
   cannot import that board back.

      `onDeal`     the opening deal: reset, shuffle, seven cards and six prizes
      `onRedraw`   the *Mulligan*'s: the hand goes back and seven fresh cards come off the top.
                   It is deliberately not the deal - a mulligan is not a new game, so the prizes
                   stay where they are, the turn counter is not put back to zero and nothing is
                   published that the players did not just ask for
      `onStart`    what the game beginning does to a board: the veil comes off, the clock
                   starts, the turn moves on, and the row goes away
*/
const dealers = new Set()
const redrawers = new Set()
const starters = new Set()

export function onDeal (deal) {
   dealers.add(deal)
   return () => dealers.delete(deal)
}

export function onRedraw (redraw) {
   redrawers.add(redraw)
   return () => redrawers.delete(redraw)
}

export function onStart (start) {
   starters.add(start)
   return () => starters.delete(start)
}

/*
   The redraw a *Mulligan* runs, on the board that owns the hand.

   It is a callback rather than a function here for the reason the deal is: this module holds no
   cards. What it is *for* is the second hand-off `takeMulligan` makes, and it exists as its own
   registration because a mulligan that ran the deal would put the turn counter back to zero and
   re-deal the prizes along with the hand.
*/
export function redrawHand () {
   if (gameSetup.get().phase !== 'deal') return false

   for (const redraw of [ ...redrawers ]) redraw()

   return true
}

/*
   Dealing, if this board has entered the `deal` phase and has not dealt for it yet.

   Once per phase and not once per event: a board that reloads mid-setup replays into `deal`
   and deals then, which is what it has to do anyway - *your own deck is the one thing the
   replay does not bring back* (see docs/rooms.md), so a reloaded board has nothing on it to
   keep. What the guard prevents is dealing twice for one phase on a board that is already
   holding its cards.
*/
export function dealOnce () {
   if (gameSetup.get().phase !== 'deal') return false
   if (dealtFor === 'deal') return false

   dealtFor = 'deal'
   for (const deal of [ ...dealers ]) deal()

   return true
}

/*
   Starting, if this board has entered the `live` phase and has not started for it yet.

   The same shape as `dealOnce`, and it is usually the board that *received* the second Ready
   that runs it: the board that pressed it started on its own press (see `begin`), and the
   other one starts the moment the event lands. Both boards notice the same moment and both
   would write the same line, so the line is written by one seat - the first - which is the
   rule the clock's own run-out line already uses (see GameTimer.svelte, `ownExpiry`).
*/
export function startOnce () {
   if (gameSetup.get().phase !== 'live') return false
   if (startedFor) return false

   startedFor = true
   for (const start of [ ...starters ]) start()

   announceStart()

   return true
}

function announceStart () {
   if (!inSetupRoom()) return
   if (seats()[0]?.id !== myId.get()) return
   publishLog('Game started')
}

/*
   Ready, from the row under the turn.

   One press per player, and the game begins when both are in the list. The list travels with
   the step for the same reason the phase does: a board that reloads mid-setup has to know
   who has already said they are ready, or it would offer the button again to a player who
   has pressed it.
*/
export function ready () {
   if (gameSetup.get().phase !== 'deal') return false
   if (isReady()) return false

   const id = myId.get()
   if (!id) return false

   const agreed = { ...gameSetup.get(), ready: [ ...gameSetup.get().ready, id ] }
   put(agreed)
   share('setupReady', agreed)

   return true
}

/* whether this board's player has pressed Ready */
export function isReady () {
   return gameSetup.get().ready.includes(myId.get())
}

/*
   Whether both players are ready, which is the whole of what starts the game.

   Asked of the seats rather than of a count: two entries in `ready` are two *players* only
   if both of them hold a seat.
*/
export function bothReady () {
   const state = gameSetup.get()
   const players = seats().map((player) => player.id)
   return players.length >= 2 && players.every((id) => state.ready.includes(id))
}

/*
   The Mulligan.

   **The count is this board's own**, because it is this player's mulligans, and it is not
   part of the state the room agrees on: the two lines in the log are what the table is told,
   and the opponent does not need a copy of the number to read them. Its own counter is also
   what the two modes need - solo has no room event to hang it on at all.

   The order is the one the buttons are read in: the player says they are taking a mulligan,
   the count is written, the new hand is drawn, and *then* the cards are named - the line is
   about the hand the mulligan produced, not the one it replaced.
*/
/*
   The count is written first, then the redraw is run, and *then* the new hand is named - the
   line is about the hand the mulligan produced rather than the one it replaced, and the cards
   are read at that moment rather than captured before. Both hand-offs come from the board that
   owns the cards: `redraw` is the redraw it registered (see `onRedraw`) and `hand` is its hand.
*/
export function takeMulligan (redraw, hand) {
   if (gameSetup.get().phase !== 'deal') return 0

   mulligans += 1
   myMulligans.set(mulligans)

   publishLog(`Player had ${mulligans} mulligans`)

   if (redraw) redraw()
   if (hand) publishLog(`Hand: ${(hand() || []).map((card) => card.name).join(', ')}`)

   return mulligans
}

/*
   A fresh deal is a fresh count: the mulligans are this player's for *this* opening hand.
   Without this the row's own count and the log's would carry on from the last game's - and
   the phase is what tells the two apart, since a `setupOrder` is a new deal and a
   `setupReady` is not.
*/
function countMulligans (state) {
   if (state.phase !== 'deal') {
      countedFor = null
      return
   }

   if (countedFor === 'deal') return
   countedFor = 'deal'

   mulligans = 0
   myMulligans.set(0)
}

/* ------------------------------------------------------------------- the relay --- */

/*
   The other player's steps. Each puts the state the actor's board is in, so the two are
   never in different phases; the acting board took its own step from its own action, since a
   board is never handed its own events back.
*/
react('setupStarted', (data) => put(data))
react('setupCoin', (data) => put(data))
react('setupOrder', (data) => put(data))
react('setupReady', (data) => put(data))

/* ------------------------------------------------------------------ the start --- */

/*
   The game beginning, on both boards at once.

   The phase moves to `live` and the board does its four things. The phase is set locally
   rather than sent: neither player has anything left to agree to, so there is nothing to
   say - and *starting* is not something one board can do to another's clock or turn anyway,
   since those are shared values each board applies for itself.
*/
let beginning = false

function begin () {
   if (beginning) return
   if (gameSetup.get().phase === 'live') return
   if (!bothReady()) return

   beginning = true

   try {
      put({ ...gameSetup.get(), phase: 'live' })
   } finally {
      beginning = false
   }
}

/*
   What every change to the agreed state sets off, on whichever board made the change - its
   own press, or the other player's step arriving.

   One subscription rather than a call at each site, and that is deliberate: the deal and the
   start are things a *phase* means, not things a button does, so a board that reaches `deal`
   by replaying the room's log when it reloads deals exactly as a board that reached it by
   choosing to go first. Putting the calls at the sites would have covered the player and
   missed the replay.
*/
gameSetup.subscribe((state) => {
   countMulligans(state)
   if (bothReady()) begin()
   if (state.phase === 'deal') dealOnce()
   if (state.phase === 'live') startOnce()
})
