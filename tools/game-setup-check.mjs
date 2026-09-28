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

/*
   *Game Setup* is greyed out until the game **can** be set up, and the whole of that rule is
   one function. Every term is asked of it, because dropping any one of them is a button that
   deals from a deck that is not on the table - a room with one player, or a player who has not
   imported - and none of those throws.
*/
const canStart = bodyOf(setup, 'canStartSetup')
check('the button asks to be in a room with both seats taken', canStart.includes('seats().length >= 2'))
check('and asks for a deck on both boards', canStart.includes('decksReady.get()'))
check('and asks that no setup is already under way', canStart.includes("phase === 'idle'"))

/*
   **And the button is *bound* to that rule reactively, which is not the same claim.** Svelte 4
   evaluates a plain function call in an expression once, when the block is created, and emits no
   update for it: `disabled={!canStartSetup()}` compiles to a `c()` that sets `disabled` with no
   `p()` beside it. So a player who entered a room before a deck existed had a permanently greyed
   out *Game Setup* button and could never start the setup at all - and a player who had pressed
   *Ready* got no glow, because `class:glow={isReady()}` was frozen the same way.

   The binding is therefore a **named reactive value**, and what is asserted is that the values
   exist and that neither call appears in the markup - because a call left in the markup beside
   the named value is the same frozen read, and would read as fixed.
*/
const markup = actions.slice(actions.indexOf('</script>'))

check('the gating rule is bound to a reactive value rather than called in the markup',
   /^\s*\$: canSetup = .*canStartSetup\(\)$/m.test(actions),
   'a bare call in `disabled=` is evaluated once and never updated')
check('and that value names a store, or it would be frozen in the same way',
   /^\s*\$: canSetup = \$decksReady && \$gameSetup\.phase/m.test(actions),
   'the expression has to read a store for Svelte to re-run it')
check('and the Ready button\'s own state is bound the same way',
   /^\s*\$: waiting = isReady\(\)$/m.test(actions))
check('and neither call is left in the markup beside it',
   !/disabled=\{[^}]*canStartSetup\(\)/.test(markup) && !/isReady\(\)/.test(markup),
   'the markup reads the named values, so there is one answer to re-run rather than two')
check('and the button is drawn disabled from that value',
   /class="game-setup"[\s\S]{0,120}disabled=\{!canSetup\}/.test(markup))
check('and Ready glows, disables and renames itself from its own',
   /class:glow=\{waiting\}/.test(markup) && /disabled=\{waiting\}/.test(markup) && /Ready ✓/.test(markup))

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
   The player who calls the coin is picked **once**, by the board that pressed the button, and
   named in the event. Two boards each drawing for themselves is the fault this rules out: they
   disagree about half the time, and the player who did not draw one is then asked to call a
   toss that was already decided somewhere else.
*/
const start = bodyOf(setup, 'startSetup')
check('the caller of the coin is picked by the board that starts the setup',
   /const chooser = players\[Math\.floor\(Math\.random\(\) \* players\.length\)\]/.test(start))
check('and the choice travels with the event rather than being drawn again',
   /share\('setupStarted', agreed\)/.test(start) && /chooser/.test(start))
check('and a board does not start a setup it may not start', /if \(!canStartSetup\(\)\) return false/.test(start))

/*
   The call is the player's own act and is logged before the coin is flipped; the flip is in the
   same function, because a call whose result is undecided is a dialog with nothing behind it.
*/
const call = bodyOf(setup, 'callCoin')
check('the call is written to the log as the player makes it',
   /publishLog\(`Player chooses \$\{side\(call\)\}`\)/.test(call))
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
   /publishLog\(`Player decided to go \$\{side\(order\)\}`\)/.test(order))

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
check('and moves the turn on by one', /setTurn\(\$turn \+ 1\)/.test(startGame))
check('and the row is drawn only before the game is live',
   /\$gameSetup\.phase === 'deal'/.test(actions) && !/phase === 'live'/.test(actions),
   'a live game draws neither the button nor the row')

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
check('and the seats changing hands forgets it too',
   /if \(pair\) resetSetup\(\)/.test(setup),
   'otherwise the phase belongs to somebody who is no longer in the room')
check('and a step that arrives late cannot put the flow back',
   /RANK\[state\.phase\] < RANK\[before\.phase\]/.test(setup))
check('and ready is a union, so a reload cannot lose this board\'s own press',
   /new Set\(\[ \.\.\.before\.ready, \.\.\.state\.ready/.test(setup),
   'a client is never handed its own events back, so its own press is missing from the replay')

/* ------------------------------------------------------------------ the row --- */

check('the row offers Ready and Mulligan', /class="ready"/.test(actions) && /class="mulligan"/.test(actions))
check('and Ready glows while it is waiting on the other player',
   new RegExp('\\.ready\\.glow \\{\\s*animation: hide-glow 1s ease-in-out infinite').test(actions.replace(/\n\s*/g, ' ')),
   'a continuous pulse, and it stays until the other player presses theirs')
check('and the setup button is gone once the row is up',
   /!\$solo && \$gameSetup\.phase === 'idle'/.test(actions),
   'the two are phases of one slot above the turn, never both at once')

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
   The dialog is the lock: it covers the board *and* the panel, and it is up for exactly the two
   phases that are a decision. A phase with no dialog over it is the game stopping with nothing
   on screen to say why.
*/
check('the dialog is up for the toss and for the choice',
   /state\.phase === 'coin' \|\| state\.phase === 'order'/.test(dialog))
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
