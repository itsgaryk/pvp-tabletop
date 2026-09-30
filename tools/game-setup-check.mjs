/*
   The room's opening: gating the button, the coin toss, and what starts the game.

   node tools/game-setup-check.mjs
   node tools/game-setup-check.mjs --quiet

   A browser check is what this feature really wants, and `tools/browser-check.mjs` documents
   why a confined session does not run one. So this asks the questions that can be answered
   without one, and they are not the lesser half of them:

     the rules       read out of `stores/gameSetup.js` and run, because the two that matter
                     most have no visible symptom when they are wrong - a button that is
                     enabled when it should not be deals a game from a deck that is not there,
                     and a *Game started* line written by both seats is a log that says it twice
     the wiring      read out of the components, because the store cannot see whether anything
                     calls it: a phase with no dialog over it and a row that is never drawn are
                     both perfectly correct modules
     the allow-list  asked of the relay's own source, because an event the relay does not know
                     is dropped in silence - the press arrives, nothing happens, and the only
                     symptom is a game that never starts

   The three of them fail in the same way (nothing throws, nothing is logged, and the feature
   looks like it was never asked for), which is why they are in one place.
*/

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const root = process.cwd()
const source = (...parts) => readFileSync(join(root, ...parts), 'utf8')

const setup = source('src', 'lib', 'stores', 'gameSetup.js')
const actions = source('src', 'lib', 'play', 'GameActions.svelte')
const dialog = source('src', 'lib', 'play', 'dialogs', 'GameSetupDialog.svelte')
const page = source('src', 'routes', '+page.svelte')
const relay = source('src', 'routes', 'api', 'relay', 'events', '+server.js')

/* the body of one function, up to the next function or the end of the script */
const bodyOf = (text, name) => {
   const start = text.search(new RegExp(`(?:export )?(?:async )?function ${name} \\(`))
   if (start === -1) return ''
   const rest = text.slice(start + 1)
   const end = rest.search(/\n   (?:export )?(?:async )?function |\n<\/script>/)
   return end === -1 ? rest : rest.slice(0, end)
}

/* ------------------------------------------------------------------- the relay --- */

/*
   **A step that arrives late must not undo one that has already landed.** The transport retries
   a failed send and the poll hands over a whole batch at once, so an older event can be applied
   after a newer one - a `setupStarted` landing after the `setupCoin` that followed it would put
   the flow back to `coin`, where the coin can be called a second time and a second order dealt
   on top of the first. So every step is rank-guarded, and this asserts the guard is there
   rather than the shape of the rank table.
*/
check('a step behind the phase the board is in is refused',
   /RANK\[state\.phase\] < RANK\[before\.phase\]\) return/.test(setup),
   'the guard is what stops a late event putting the flow back')

/* the four steps are events, and the relay only relays what it has been told about. An event
   missing here is not an error anywhere: `share` posts it, the endpoint answers 400, the
   transport records a fault and retries, and the other player is simply never told - so the
   board that acted is in a phase the other one is not, for ever. */
const allowList = relay.slice(relay.indexOf('const EVENTS = new Set'), relay.indexOf('])', relay.indexOf('const EVENTS = new Set')))
for (const name of [ 'setupStarted', 'setupCoin', 'setupOrder', 'setupReady' ]) {
   check(`the relay relays ${name}`, allowList.includes(`'${name}'`))
}
check('and it does not relay them to one member only',
   !relay.slice(relay.indexOf('const ADDRESSED'), relay.indexOf('])', relay.indexOf('const ADDRESSED'))).includes('setup'),
   'the setup is the room\'s: both players and every watcher are told each step')

/* ------------------------------------------------------------------ the button --- */

const markup = actions.slice(actions.indexOf('</script>'))

/*
   The opening begins by itself, so what gates it is not a button but the rule the room can see:
   two seats, both decks, and an opening that has not already begun. Every term is asked, because
   dropping any one of them is a deal built from a deck that is not there - and none of those throws.
*/
const canStart = bodyOf(setup, 'canStartSetup')
check('the opening asks for a room with both seats taken', canStart.includes('seats().length >= 2'))
check('and asks for a deck on both boards', canStart.includes('decksReady.get()'))
check('and asks that it has not already begun', /at === 'idle'/.test(canStart))

/*
   **And it runs by itself.** There is no button any more: it waits on the two decks, and the moment
   the second lands the room can see that for itself - so a press asked the players to confirm
   something nothing was waiting on. What is asserted here is that the start is driven from a
   subscription (which is what makes it automatic), that it watches **both** things it waits for,
   and that the board component no longer offers anything to press.
*/
check('the opening is started automatically rather than by a click',
   /decksReady\.subscribe\(maybeStart\)/.test(setup) && /function maybeStart \(\)/.test(setup))
check('and it watches the seats as well as the decks',
   /seatedPlayers\.subscribe\(maybeStart\)/.test(setup),
   'a player who imported while alone has decksReady false until the seat is filled, and the seat arriving changes nothing about their deck')
check('and the start is not exported for a button to call',
   !/^export function startSetup/m.test(setup))
check('and the board offers no Game Setup button at all',
   !/class="game-setup"/.test(markup) && !/on:click=\{startSetup\}/.test(markup))

/*
   **A store read inside a function a `$:` calls is invisible to Svelte**, which compiles the
   statement as a bare assignment and answers it once - measured, three times over, on the running
   app: a *Game Setup* button greyed out for the life of the page, a pressable button that silently
   did nothing, and a *Ready* press that showed no tick. What is left is `waiting`, and it names the
   list itself.
*/
check('the Ready button\'s own state is bound to a reactive value',
   /^\s*\$: waiting = /m.test(actions) && /\$gameSetup\.ready/.test(actions),
   'a store read inside `isReady()` is invisible to the compiler')
check('and no store-reading call is left in the markup beside it',
   !/isReady\(\)/.test(markup) && !/hasPressed\(\)/.test(markup) && !/canStartSetup\(\)/.test(markup),
   'the markup reads the named value, so there is one answer to re-run rather than two')
check('and Ready disables and renames itself from its own, with no glow',
   /disabled=\{waiting\}/.test(markup) && /Ready ✓/.test(markup) && !/class:glow=\{waiting\}/.test(markup),
   'the tick is the whole of the feedback; the continuous pulse is gone')
check('and Ready keeps its colour rather than dimming when it is spent',
   /\.ready:disabled/.test(actions) && /opacity-100/.test(actions))

/*
   `decksReady` and the imported-deck indicator the feature was asked to look for are the same
   thing: the deck a player imported *is* the card list on their board, and the opponent's
   arrives with every board state. Inventing a second flag would be a second answer to a
   question the board already answers - and the two would disagree after a re-import.
*/
const readDecks = bodyOf(setup, 'readDecks')
check('and "a deck is imported" is read off the board, not from a flag of its own',
   readDecks.includes('cards.get()') && readDecks.includes('defaultOpponent.cards.get()'),
   'your own deck and the mirror of theirs, which is where an import lands')
check('and both boards are asked, so one import is not enough',
   /mine > 0 && theirs > 0/.test(readDecks))

/* ------------------------------------------------------------------ the toss --- */

/*
   The caller is picked **once, and identically on whichever board starts it**. Both of them can:
   each has its own deck and its own mirror of the other's, so both preconditions can become true in
   the same moment - measured on two boards, both started the opening and both drew a caller, so
   **both players were offered Heads or Tails**. The draw is therefore the first seat rather than
   `Math.random()`, which is a value both boards already hold.
*/
const start = bodyOf(setup, 'startSetup')
check('the toss demands a room, both decks and an opening not yet begun',
   /if \(!canStartSetup\(\)\) return false/.test(start))
check('and the caller is the first seat rather than a coin the two boards flip separately',
   /const chooser = players\[0\]/.test(start) && !/^\s*const chooser = .*Math\.random/m.test(start),
   'two boards drawing at random is two answers to one question')
check('and the choice travels with the event rather than being drawn again',
   /share\('setupStarted', agreed\)/.test(start) && /chooser/.test(start))
check('and the opening it starts carries nothing from the game before it',
   /const agreed = \{ phase: 'coin', chooser \}/.test(start),
   'the state it publishes is the opening\'s own rather than whatever was on the board')
check('and a second step cannot overwrite an answer already given',
   /const ONE_ANSWER = \{ coin: 'chooser', order: 'winner' \}/.test(setup) &&
   /if \(state\.phase === before\.phase && answer && before\[answer\] != null\) return/.test(setup),
   'both boards may start the opening; whichever event lands first is the toss')

/*
   The call is the player's own act and is logged before the coin is flipped; the flip is in the
   same function, because a call whose result is undecided is a dialog with nothing behind it.
*/
const call = bodyOf(setup, 'callCoin')
check('the call is written to the log as the player makes it',
   /publishLog\(`Chooses \$\{face\(call\)\}`\)/.test(call))
check('and it names a coin face rather than a side',
   !/publishLog\(`Chooses \$\{side/.test(call),
   '`side` answers First or Second, so a call of heads was written as "Chooses Second"')
check('and it does not say "Player chooses"',
   !/publishLog\(`Player chooses/.test(call),
   'the relay already names the sender on every line it delivers, so the word was said twice')
check('and the coin is flipped in the same act', call.includes('const result = flipCoin()'))
check('and only the player who was picked may call it', /if \(!callsCoin\(\)\) return false/.test(call))

/*
   The toss is the call against the coin: calling it right wins it, and a wrong call hands the
   choice to the other player. Both halves are asserted, because "the other player chooses when
   the call is wrong" is the rule that is easiest to leave out and hardest to notice.
*/
check('calling it right wins the toss', /const winner = won \? chooser : \(/.test(call))
check('and calling it wrong hands the choice to the other player',
   /seats\(\)\.find\(\(player\) => player\.id !== chooser\)\?\.id \|\| null/.test(call))

/* and the answer is the player's own business: the whole board is told where it landed */
check('and the flip is shown and logged', /showMessage\(`Coin flip result: \$\{face\(result\)\}`\)/.test(call)
   && /publishLog\(`Coin flip: \$\{face\(result\)\}`\)/.test(call))

/* ------------------------------------------------------------- first or second --- */

/*
   **Second is not "I am second", it is "the other player is first".** The two readings agree
   for First and differ for Second, and the difference is what puts the right name in front -
   so both are checked: who is asked, and who the answer puts in front.
*/
const order = bodyOf(setup, 'chooseOrder')
check('only the winner of the toss chooses the order', /if \(!choosesOrder\(\)\) return false/.test(order))
check('and choosing First puts this player in front',
   /order === 'first' \? winner :/.test(order))
check('and choosing Second puts the other player in front',
   /seats\(\)\.find\(\(player\) => player\.id !== winner\)\?\.id \|\| null/.test(order))
check('and the choice is written the way the table reads it',
   /publishLog\(`Decided to go \$\{side\(order\)\}`\)/.test(order))
check('and it does not say "Player decided"',
   !/publishLog\(`Player decided/.test(order),
   'the same doubling the coin line had')

/* ------------------------------------------------------------------ the deal --- */

/*
   The deal is a *phase*, not a button: it happens when the order is settled, on both boards,
   and the board that reloads into that phase deals then. So the call is in one place, driven by
   the phase - not at the end of `chooseOrder`, which would have dealt for the player who chose
   and never for the one who was told.
*/
check('the deal is made by the board as it enters the deal phase',
   /if \(state\.phase === 'deal'\) dealOnce\(\)/.test(setup),
   'the subscription is the one place the phase is turned into board actions')
check('and never twice for one deal', /if \(dealtFor === 'deal'\) return false/.test(setup))
check('and the turn order the game starts from is a fact the room holds',
   /first: taker/.test(order) && /first: state\.first/.test(setup))
check('and a reloaded board can deal, which is what the phase is for',
   setup.includes('replaying the room\'s log when it reloads deals exactly as a board'))

/* ----------------------------------------------------------------- Ready --- */

/*
   Both players have to be ready, and the *seats* are what makes that two players rather than two
   presses. Two entries in the list from one player would otherwise start the game.
*/
check('both players have to be ready', /players\.every\(\(id\) => state\.ready\.includes\(id\)\)/.test(setup))
check('and two ready entries are only two players if both hold a seat',
   /players\.length >= 2 && players\.every/.test(setup))
check('and a player cannot say it twice', /if \(isReady\(\)\) return false/.test(setup))

/* ------------------------------------------------------------------ the start --- */

/*
   **One seat writes *Game started*.** Both boards notice the same moment, so a line from each
   is a log that says the game began twice - and neither board would report anything, because
   both would be behaving as written. It is the first seat, which is the rule the clock's own
   run-out line uses.
*/
check('one seat, and only one, writes that the game started',
   /if \(seats\(\)\[0\]\?\.id !== myId\.get\(\)\) return/.test(setup))
check('and the line is written once per start', /announceStart\(\)/.test(bodyOf(setup, 'startOnce')))
check('and the start is not run twice for one phase', /if \(startedFor\) return false/.test(setup))

/*
   The four things a start does to a board. The veil is set as a **state** rather than toggled,
   and that is the one that would be wrong quietly: the two boards reach the start at different
   moments, so a toggle would take the veil *on* for whichever arrived second - a board whose
   Pokemon were hidden by the game starting.
*/
const startGame = bodyOf(actions, 'startGame')
check('starting takes the veil off', /setVisibility\(false\)/.test(startGame))
check('and sets it rather than toggling it', !/switchVisibility/.test(startGame),
   'a toggle hides the board of whichever player arrives second')
check('and starts the clock', /setTimer\(\{ running: true, remaining: DEFAULT_TIMER_MS \}\)/.test(startGame))
/*
   **The opening turn is stated, not counted.** `setTurn($turn + 1)` is right for one board and
   wrong for two: each board applies the clock and the turn for itself, and a second entry into
   the start advanced the counter again - measured on two browsers, the game started, the log
   said so once, and the turn row read *Turn 2*. Setting it in two steps is how the counter is
   forced rather than nudged, since `setTurn` ignores a value it already holds.
*/
check('starting states the opening turn rather than counting to it',
   /setTurn\(0\)[\s\S]*setTurn\(1\)/.test(startGame),
   'a relative turn is one more for every board that reaches the start')
/*
   The row above the turn is the **game's own**, and it is up for everything from the deal onwards:

      deal    *Ready* and *Mulligan*
      live    the same two, with *Flip Coin* and *End Turn* added under them

   The *Game Setup* button that used to be the third state is gone: the opening starts by itself,
   so the row has nothing to say about it and is simply absent until there is a hand to decide.
   Both halves are asserted, because either alone is a fault - a row drawn while the opening is
   asking for decks is a button over a locked board, and a game that has begun with no row at all
   is the room as it looked before this change.
*/
check('the row is drawn from the deal onwards and not before it',
   /!\$solo && \$gameSetup\.phase !== 'idle' && \$gameSetup\.phase !== 'coin' && \$gameSetup\.phase !== 'order'/.test(actions),
   'nothing of it is drawn while the opening is still asking for decks')
check('and a live game gets the game row as well',
   /!\$solo && \$gameSetup\.phase === 'live'/.test(actions) &&
   /class="game-actions"/.test(actions) && /on:click=\{flip\}/.test(actions) && /on:click=\{endTurn\}/.test(actions),
   'Flip Coin and End Turn come back when the game does')
check('and no button is drawn for the opening itself',
   !/!\$solo && \$gameSetup\.phase === 'idle'/.test(actions) && !/class="game-setup"/.test(actions))

/* the deal, the redraw and the start are registered by the module that owns the board */
check('the board hands the deal, the redraw and the start to the flow',
   /onDeal\(\(\) => setup\(\)\)/.test(actions) && /onRedraw\(\(\) => redraw\(\)\)/.test(actions)
   && /onStart\(\(\) => startGame\(\)\)/.test(actions))

/*
   **A mulligan is not a new game.** It used to run the deal, which put the turn counter back to
   zero, re-dealt the six prizes and republished a hidden board - three changes to the *table* in
   answer to a player asking for a new hand. So the redraw is registered separately and the
   assertion is that the button goes through `redrawHand` and not through `setup`.
*/
const mulliganButton = bodyOf(actions, 'mulligan')
check('a mulligan goes through the redraw rather than the deal',
   /takeMulligan\(\(\) => redrawHand\(\)/.test(mulliganButton),
   'the deal would put the turn back to zero and re-deal the prizes')
const redraw = bodyOf(actions, 'redraw')
check('and the redraw returns the hand before it draws',
   redraw.indexOf('deck.push(card)') < redraw.indexOf('draw(7, true)'),
   'the seven cards it draws have to be able to come from the ones that went back')
check('and the redraw leaves the prizes and the turn counter alone',
   !/prizes/.test(redraw) && !/setTurn/.test(redraw),
   'a mulligan changes this player\'s hand, not the table')

/* ------------------------------------------------- a second game, and a changed seat --- */

/*
   **The deal and the start are once per game, not once per page.** The guards that make them so
   are module locals, and *New Game* does not leave the room - so without a reset the second game
   in a room deals nothing (an empty board behind a Ready button) and starts nothing (the clock
   frozen and the turn where the last game left it), while the Mulligan button still deals, which
   makes it read as a broken deal rather than a broken guard.
*/
check('starting a game again forgets the setup',
   /export function resetSetup \(\)/.test(setup) && /onNewGameStart\(\(\) => resetSetup\(\)\)/.test(actions),
   'a new game continues in the same room, so `leftRoom` never runs and the guards stay set')
check('and the flow\'s guards are cleared by it',
   /dealtFor = null/.test(bodyOf(setup, 'reset')) && /startedFor = false/.test(bodyOf(setup, 'reset')))

/*
   And a setup belongs to two *particular* players, so it is forgotten when the seats change
   hands: the ready list would otherwise name a member who has gone, and the new player would
   replay into a deal that happened before they arrived - with no cards in front of them.
*/
/*
   **A setup belongs to two particular players, in one particular room**, and the second half is the
   reported fault: leaving a room and making another one with the same opponent leaves the seats
   *identical*, so watching the seats alone had nothing to notice while the flow still held a ready
   list naming both of them. So the watcher is on the room as well, and it keys on the room id
   rather than on an event - which is also what keeps a **reload** from wiping the setup it is in
   the middle of, since resuming re-joins the same room.
*/
check('a seat changing hands forgets the setup',
   /const seatsChanged = seatPair !== null && pair !== seatPair/.test(setup) &&
   /if \(differentRoom \|\| seatsChanged\) resetSetup\(\)/.test(setup),
   'otherwise the phase belongs to somebody who is no longer in the room')
check('and so does the room changing',
   /const differentRoom = seenRoom !== null && seenRoom !== here/.test(setup),
   'the same two members in another room are a different game')
check('and it is watched on the room, not on an event, so a reload keeps its setup',
   /room\.subscribe\(watchRoom\)/.test(setup) && /seatedPlayers\.subscribe\(watchRoom\)/.test(setup) &&
   !/react\('joinedRoom', forgetRoom\)/.test(setup),
   'resuming re-joins the same room, and that is not a change')
check('and forgetting has a way to empty the union',
   /function put \(state, \{ clear = false \} = \{\}\)/.test(setup) && /\{ clear: true \}/.test(setup),
   'a union has no way out, so reset replaces rather than merges')
check('and a step that arrives late cannot put the flow back',
   /RANK\[state\.phase\] < RANK\[before\.phase\]/.test(setup))
check('and the ready list is a union, so a reload cannot lose this board\'s own press',
   /union\(before\.ready, state\.ready\)/.test(setup),
   'a client is never handed its own events back, so its own press is missing from the replay')

/* ------------------------------------------------------------------ the row --- */

check('the row offers Ready and Mulligan', /class="ready"/.test(actions) && /class="mulligan"/.test(actions))
check('and the mulligan is green rather than the grey that read as disabled',
   /\.setup-row \.mulligan \{[\s\S]{0,80}bg-green-600/.test(actions))
check('and Ready does not animate at all',
   !/class:glow=\{waiting\}/.test(actions) && !/\.ready\.glow/.test(actions),
   'the tick is the whole of the feedback; a light nobody can turn off is not')
check('and it keeps its colour when it is spent',
   /\.ready:disabled \{[\s\S]{0,40}opacity-100/.test(actions),
   'disabled is what a second press would do, not what the button is saying')

/*
   The mulligan writes both lines, in the order they are read, and counts up by one per press.
   The cards are named *after* the redraw - a line naming the hand the mulligan threw away would
   be a line about the wrong hand.
*/
const mulligan = bodyOf(setup, 'takeMulligan')
check('the mulligan counts up', /mulligans \+= 1/.test(mulligan))
check('and says how many', /publishLog\(`Player had \$\{mulligans\} mulligans`\)/.test(mulligan))

/*
   **The two lines are written in the order they are read, with the redraw between them.** One
   marker inside the function stands for the redraw, and the two lines are asserted either side
   of it: the count before, so it says how many mulligans the hand it is about took, and the
   cards after, because a line naming the hand that was thrown away would be about the wrong
   hand. Read as one string with the redraw in the middle, which is what the order is.
*/
const marked = mulligan.replace('if (redraw) redraw()', '<<REDRAW>>')
check('and the count is written before the redraw',
   marked.indexOf('Player had') < marked.indexOf('<<REDRAW>>'))
check('and the hand is named after it',
   marked.indexOf('Hand:') > marked.indexOf('<<REDRAW>>'))
check('and the hand line names the cards',
   /Hand: \$\{\(hand\(\) \|\| \[\]\)\.map\(\(card\) => card\.name\)\.join\(', '\)\}/.test(setup))
check('and a phase that is not a deal takes no mulligan',
   /phase !== 'deal'\) return 0/.test(mulligan))

/* ----------------------------------------------------------------- the dialog --- */

/*
   **The dialog is the lock, and it has two reasons to be up** - which is why it is two terms
   rather than one:

      the import   a room with two players where a deck is still missing. It says so, and it is not
                   a prompt: the opening starts by itself the moment the second deck lands
      the toss     the coin and the order, once both decks are in. Both are decisions about the
                   game rather than about a deck, and neither can be made while cards are moving

   It is **not** up for `deal` or `live`: the moment the order is settled both boards deal and both
   players are free again, which is the point of the order being decided. A phase with no lock over
   it that should have one is a board playable while the game is still being opened, and a lock over
   the deal is a board that never becomes playable at all.
*/
check('the lock is up for the import and for the two questions of the toss',
   /importing = \$gameSetup\.phase === 'idle'/.test(dialog) &&
   /tossing = \$gameSetup\.phase === 'coin' \|\| \$gameSetup\.phase === 'order'/.test(dialog),
   'the import wait, then the toss; nothing after it')
check('and it says what the room is waiting for while a deck is missing',
   /Setting up the game/.test(dialog) &&
   /Both players need to import a deck before the game can begin/.test(dialog),
   'the wording is the request, because there is no button to press')
check('and nothing of the old press remains in what it does',
   !/hasPressed\(/.test(dialog) && !/state\.pressed/.test(dialog) && !/\$gameSetup\.pressed/.test(dialog),
   'the opening is no longer gated on a press, so its list is gone from the component')
check('and the lock is on store values rather than a call',
   /\$: open = Boolean\(\$room\)/.test(dialog) && /imported/.test(dialog))
/*
   **And it is not drawn outside a room.** The phase is `idle` on a board that has never been
   anywhere, so a lock drawn on the phase alone covers the **main menu** - reported as *"Seeing
   Setting up the game when I load into the main menu"*, over the logo and the Play Solo button.
   `$room` is asked as well, and it is read in this component rather than handed down as the page's
   `onMenu`, so a page that forgets to pass it cannot bring the fault back.
*/
check('and it is never drawn outside a room',
   /\$: open = Boolean\(\$room\)/.test(dialog),
   'the main menu is phase idle with no room, and the lock was covering it')
/*
   **And the lock does not cover the Import Deck window.** They are the two things that cover the
   board in a room, and this one is *above* that one (`z-index: 46` against `45`) - so drawing it
   while a player still has to import takes that window's buttons and its textarea with it. That is
   what was reported: *"player is still unable to import the deck"*, with the import window visible
   underneath. So `open` waits on **this player's own deck** rather than on `decksReady`, and the two
   windows come in the order they were asked for - import first, the setup message after it closes.
*/
check('the lock waits for this player\'s own deck, not for both players\'',
   /importing = \$gameSetup\.phase === 'idle' && imported && !\$decksReady/.test(dialog),
   'a lock over the import window is a window that cannot be clicked')
check('and that is watched on the card list the import window itself watches',
   /\$cards\.length/.test(dialog) && /\$: if \(\$cards\.length\) imported = true/.test(dialog),
   'the two cannot disagree about what an import landing means')
check('and the lock is over the import window, which is why that matters',
   /z-index: 46/.test(dialog) && /over the Import Deck window, which is at 45/.test(dialog))

check('and covers the window rather than the board',
   /position: fixed;\s*inset: 0;/.test(dialog), 'the chat and the row are behind it too')
check('and offers Heads and Tails to the player who was picked',
   /callCoin\('heads'\)/.test(dialog) && /callCoin\('tails'\)/.test(dialog))
check('and offers First and Second to the winner',
   /chooseOrder\('first'\)/.test(dialog) && /chooseOrder\('second'\)/.test(dialog))
check('and the two are each drawn only for the player they belong to',
   /\{#if calling\}/.test(dialog) && /\{:else if !ordering\}/.test(dialog),
   'the other player is told what is happening and given nothing to press')
check('and the player who is waiting is told so rather than shown an empty dialog',
   dialog.includes('is calling the coin toss'))
check('and it cannot be waved away',
   !/setup-backdrop[^>]*on:click/.test(dialog) && !/on:keydown/.test(dialog),
   'neither a click beside it nor Escape is a call or a choice - there is no dismiss handler to find')
check('and it is a player\'s, not a spectator\'s or solo\'s',
   /!\$solo && !\$spectating/.test(dialog))

/* and it is mounted, which a dialog cannot do for itself */
check('and the dialog is on the page', /<GameSetupDialog \/>/.test(page)
   && /import GameSetupDialog from '\$lib\/play\/dialogs\/GameSetupDialog\.svelte'/.test(page))

/* --------------------------------------------------------------- solo and watchers --- */

/*
   **Solo is untouched.** It has no room, so it has no second player to toss with and no deck of
   anybody else's to wait for: its Setup button deals both halves from one press, as it always
   did. That is what `inSetupRoom` refuses, and it is the one thing about this feature that would
   be easy to apply everywhere.
*/
check('solo is refused by the flow', /!solo\.get\(\)/.test(bodyOf(setup, 'inSetupRoom')))
check('and a spectator is refused too', /!spectating\.get\(\)/.test(bodyOf(setup, 'inSetupRoom')))
check('and solo keeps its own row', /\{#if \$solo\}/.test(actions) && /on:click=\{setupSolo\}/.test(actions))
check('and solo\'s setup still writes its line', /publishLog\('Setup'/.test(bodyOf(actions, 'setupSolo')))

/* and a room left is a setup put away, or the next game starts in the last one's phase */
check('and leaving the room puts the setup away', /react\('leftRoom', reset\)/.test(setup))

console.log(failures ? `\n${failures} check(s) failed` : '\nverdict: ok - the setup flow is gated, agreed and wired')
process.exit(failures ? 1 : 0)
