/*
   The room's opening, on two real boards.

   node tools/game-setup-browser-check.mjs
   Needs the stack `tools/browser-check.mjs` documents: a dev server on BASE and browsers on
   CDP_PORTS, one per player.

   ---------------------------------------------------------------------------
   Why this is a browser check and not a store one
   ---------------------------------------------------------------------------
   `tools/game-setup-check.mjs` reads the rules out of the source and
   `tools/game-setup-rule-check.mjs` runs the store against the real board and seat stores. Both
   were green while the feature was **broken on screen**, and the reason is the same both times:

      the caller    `calling = callsCoin()` named no store, so Svelte 4 hoisted it out of the
                    component's update function and answered it once - at instance creation, when
                    the phase was `idle`. Both players were told *the other one* was calling the
                    coin, and **nobody was ever offered Heads or Tails**. A source check reads the
                    expression and finds it correct; a store check asks the store and is told the
                    truth. Only the compiled component, running, disagrees with both.
      the row       the same mistake on `waiting = isReady()`: pressing *Ready* put the player in
                    the room's ready list and the button went on drawing "Ready" with no glow.

   So what is checked here is what only two boards can answer: that the right *screen* shows the
   right thing, that a press is visible on the screen that made it, and that the two boards agree
   about the table afterwards. Anything a store or the source can answer belongs in the other two
   tools - this one is for the rendering and the round trip.

   Sections, and what each is for:

      the gate      greyed out until both decks are in, then enabled on both boards
      the toss      exactly one player is offered the call, and the other is told who is calling
      the order     exactly one player chooses first or second
      the deal      the dialog goes, the row arrives, both hands and six prizes each, veiled
      ready         the press is visible on the board that made it, and does not start the game
      the start     both ready: row gone, veil off, turn 1, one *Game started*, clock running
      mulligan      the two lines, the count, and a fresh hand that is still seven
      a new game    the second game in a room deals and starts, which is what the guards forgot
*/

import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [ alice, bob ] = await browser.pages(2)
await browser.setViewport(1277, 821)
for (const page of [ alice, bob ]) page.autoDialogs(true)

const wait = async (label, fn, { timeout = 30000, poll = 500 } = {}) => {
   const deadline = Date.now() + timeout
   for (;;) {
      const value = await fn()
      if (value) return value
      if (Date.now() > deadline) throw new Error(`${label} never happened`)
      await sleep(poll)
   }
}

/*
   One board, as a person sees it: what the setup dialog says and offers, what the row under the
   turn says and offers, the turn number, how many veils are drawn, and the game-log lines that
   belong to this feature.

   Everything here is read off the DOM, and deliberately: a check that read the stores would have
   passed while the buttons were frozen, because the stores were right.
*/
const board = (page) => page.evaluate(`(() => {
   const box = document.querySelector('.setup-dialog')
   /*
      The Game Setup button, in either of its two labels: once this player has pressed it says
      *Waiting for opponent...* and is disabled, and it is the same button.
   */
   const setupButton = [...document.querySelectorAll('button')]
      .find((b) => /^(Game Setup|Waiting for opponent\\u2026)$/.test(b.textContent.trim()))
   const row = [...document.querySelectorAll('.setup-row button')].map((b) => ({
      label: b.textContent.trim(), disabled: b.disabled, glow: b.classList.contains('glow')
   }))
   /*
      This player's own prize pile, and it needs saying which one that is: the board draws *two*
      piles wearing the same class - the near half's and the far half's - and which one comes first
      in the document is not fixed, so a plain querySelector answered with the opponent's as often
      as with this player's. The near one is the child of the board placed by grid-area prizes, and
      that is the one thing about it that is stable.
   */
   const nearPrizes = [...document.querySelectorAll('.gameboard > .prizes')]
      .find((el) => getComputedStyle(el).gridArea === 'prizes')

   return {
      dialog: box ? box.innerText.replace(/\\s+/g, ' ').trim() : null,
      buttons: box ? [...box.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
      backdrop: Boolean(document.querySelector('.setup-backdrop')),
      setupButton: setupButton
         ? { present: true, disabled: setupButton.disabled, label: setupButton.textContent.trim() }
         : { present: false },
      row,
      /* the row the game itself runs on, once it has begun */
      liveRow: [...document.querySelectorAll('.game-actions button')].map((b) => b.textContent.trim()),
      turn: (document.querySelector('.turn-row .count') || {}).innerText || null,
      veil: document.querySelectorAll('.veil.applied').length,
      hand: document.querySelectorAll('.hand .card').length,
      prizes: nearPrizes ? nearPrizes.querySelectorAll('.card').length : null,
      log: [...document.querySelectorAll('p')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim())
         .filter((l) => /Chooses|Coin flip|Decided to go|Game started|Player had|Hand:|End Turn/i.test(l))
   }
})()`)

/*
   The colour a button is actually painted, read off the document rather than the class - a check
   that asked for `bg-green-600` in the markup would pass with the rule overridden, and the whole
   point of the report was that the button *looked* disabled.
*/
const painted = (page, selector) => page.evaluate(`(() => {
   const el = document.querySelector(${JSON.stringify(selector)})
   if (!el) return null
   return getComputedStyle(el).backgroundColor
})()`)

/* a click on a button by its **exact** label, so "First" cannot land on "Second" */
const clickButton = (page, selector, label) => page.evaluate(`(() => {
   const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)})
   if (!el) return false
   el.click()
   return true
})()`)

const lobby = async (page) => {
   await page.evaluate(`(() => { try { localStorage.removeItem('pvp_session') } catch {} return true })()`).catch(() => {})
   await page.send('Page.navigate', { url: 'about:blank' }).catch(() => {})
   await sleep(600)
   await page.go(BASE, 3500)
   await page.evaluate(`(() => { localStorage.removeItem('pvp_session'); return true })()`)
   /* a hard reload, so nothing of a previous run's modules survives */
   await page.send('Page.reload', { ignoreCache: true }).catch(() => {})
   await sleep(3500)
}

console.log(`the room's opening, against ${BASE}\n`)

await lobby(alice)
await lobby(bob)

const room = await alice.createRoom('Alice')
await bob.joinRoom(room, 'Bob')
await alice.importDeck()
await bob.importDeck()
console.log(`  room ${room}\n`)

/* ------------------------------------------------------------- the lock, and the gate --- */

/*
   **The board is held from the moment a room has two players in it.** Nothing on the table is
   anybody's to touch until both have said the game may begin, so the lock is up while the phase is
   `idle` - before either has pressed - and it is the same element that later carries the toss.

   The way out is *Game Setup* itself, which is in the panel beside the board and therefore behind
   the backdrop: what is asserted is that the lock is up and that the button is still the one thing
   that answers.
*/
await wait('the lock to come up', async () => (await board(alice)).dialog !== null)
const locked = { alice: await board(alice), bob: await board(bob) }
check('the board is locked as soon as there are two players',
   /Setting up the game/.test(locked.alice.dialog) && /Setting up the game/.test(locked.bob.dialog),
   JSON.stringify([ locked.alice.dialog, locked.bob.dialog ]))
check('and both are told what to do',
   /Both players need to press Game Setup/.test(locked.alice.dialog) &&
   /Both players need to press Game Setup/.test(locked.bob.dialog))
check('and the lock is the whole window, not the board',
   locked.alice.backdrop === true, 'a click meant for a card lands on the backdrop')

/*
   Both decks, and the button comes alive on **both** boards. The second half is the assertion
   that matters: the frozen read this feature was first written with left one board's button dead
   for the life of the page, and a check that only looked at the player who pressed it would have
   passed.
*/
await wait('both decks to land', async () => (await board(alice)).setupButton.disabled === false)
const gated = { alice: await board(alice), bob: await board(bob) }
check('the button is enabled once both decks are in, on both boards',
   gated.alice.setupButton.disabled === false && gated.bob.setupButton.disabled === false,
   `alice=${gated.alice.setupButton.disabled} bob=${gated.bob.setupButton.disabled}`)

/* ------------------------------------------------------- both players press Setup --- */

/*
   **One press is half of the agreement.** It is recorded, the room is told, and nothing else
   happens: no toss, no dialog question, and the board stays locked. The press that completes the
   pair is the one that draws the caller.
*/
await clickButton(alice, 'button', 'Game Setup')
await sleep(1500)

const onePressed = { alice: await board(alice), bob: await board(bob) }
check('one press does not start the toss: no Heads or Tails anywhere',
   !onePressed.alice.buttons.includes('Heads') && !onePressed.bob.buttons.includes('Heads'),
   `alice=${onePressed.alice.buttons} bob=${onePressed.bob.buttons}`)
check('the player who pressed is told they are waiting',
   /Waiting for Bob to press Game Setup/.test(onePressed.alice.dialog || ''),
   JSON.stringify(onePressed.alice.dialog))
check('and their button says so and cannot be pressed again',
   onePressed.alice.setupButton.present === true && onePressed.alice.setupButton.disabled === true &&
   /Waiting for opponent/.test(onePressed.alice.setupButton.label || ''),
   JSON.stringify(onePressed.alice.setupButton))
check('and the other is still asked to press',
   /Both players need to press Game Setup/.test(onePressed.bob.dialog || '') &&
   onePressed.bob.setupButton.disabled === false,
   JSON.stringify(onePressed.bob.dialog))
check('and the board is still locked', /Setting up the game/.test(onePressed.bob.dialog || ''))

/* ------------------------------------------------------------------ the toss --- */

await clickButton(bob, 'button', 'Game Setup')
await wait('the coin dialog', async () => (await board(alice)).buttons.includes('Heads') ||
   (await board(bob)).buttons.includes('Heads'))
await sleep(1500)

const toss = { alice: await board(alice), bob: await board(bob) }
const aliceCalls = toss.alice.buttons.includes('Heads')
const bobCalls = toss.bob.buttons.includes('Heads')

check('the second press starts the toss', aliceCalls || bobCalls)
check('exactly one player is offered the call', aliceCalls !== bobCalls,
   `alice=${aliceCalls} bob=${bobCalls}`)
check('and that player is offered Heads and Tails',
   (aliceCalls ? toss.alice.buttons : toss.bob.buttons).join() === 'Heads,Tails',
   JSON.stringify(aliceCalls ? toss.alice.buttons : toss.bob.buttons))
check('and the other is told who is calling, with nothing to press',
   (aliceCalls ? toss.bob : toss.alice).buttons.length === 0 &&
   /is calling the coin toss/.test((aliceCalls ? toss.bob : toss.alice).dialog),
   JSON.stringify((aliceCalls ? toss.bob : toss.alice).buttons))

const caller = aliceCalls ? alice : bob
const waiter = aliceCalls ? bob : alice

/* ----------------------------------------------------------------- the call --- */

await clickButton(caller, '.setup-dialog button', 'Heads')
await sleep(2200)

const called = await board(caller)
check('the call and the flip are both written to the log',
   called.log.some((l) => /Chooses (HEADS|TAILS)/.test(l)) &&
   called.log.some((l) => /Coin flip: (HEADS|TAILS)/.test(l)),
   JSON.stringify(called.log))
check('and the line says "Chooses", not "Player chooses"',
   !called.log.some((l) => /Player chooses/.test(l)),
   'the relay already names the sender on every line it delivers, so the word was said twice')
check('and it names a coin face rather than a side of the turn order',
   !called.log.some((l) => /Chooses (First|Second)/.test(l)),
   '`side` answers First or Second, so a call of heads was written as "Chooses Second"')

/* ---------------------------------------------------------------- the order --- */

const chose = { caller: await board(caller), waiter: await board(waiter) }
check('exactly one player is asked to choose the order',
   chose.caller.buttons.includes('First') !== chose.waiter.buttons.includes('First'),
   `caller=${chose.caller.buttons} waiter=${chose.waiter.buttons}`)

const chooser = chose.caller.buttons.includes('First') ? caller : waiter
const chooserBoard = chose.caller.buttons.includes('First') ? chose.caller : chose.waiter
check('and the winner of the toss is offered First and Second',
   chooserBoard.buttons.join() === 'First,Second', JSON.stringify(chooserBoard.buttons))

await clickButton(chooser, '.setup-dialog button', 'First')

/* ----------------------------------------------------------------- the deal --- */

/*
   **Both boards, not one.** Every wait from here on asks the two of them: the deal reaches each
   board on its own poll, so a check that waited for Alice's dialog to close and then read Bob's
   board was reading it mid-flight - and failed about one run in three, on *"both boards have dealt
   seven cards and six prizes - alice=7/6 bob=0/0"*. That is the shape of a flaky check rather than
   a fault: the same run passed on the next try.
*/
const settled = (both) => async () => {
   const [ a, b ] = [ await board(alice), await board(bob) ]
   return both(a, b) ? { a, b } : null
}

await wait('both boards to deal', settled((a, b) =>
   a.dialog === null && b.dialog === null && a.hand === 7 && b.hand === 7))
await sleep(600)

const dealt = { alice: await board(alice), bob: await board(bob) }
check('the dialog is gone, and the Game Setup button with it',
   dealt.alice.dialog === null && dealt.bob.dialog === null && !dealt.alice.setupButton.present)
check('the row under the turn is Ready and Mulligan, neither disabled',
   dealt.alice.row.length === 2 && dealt.alice.row[0].label === 'Ready' &&
   dealt.alice.row[0].disabled === false && dealt.alice.row[1].label === 'Mulligan',
   JSON.stringify(dealt.alice.row))

/*
   **The mulligan is green and Ready is not.** Read off the painted colour rather than the class,
   because the report was that the mulligan *looked* disabled - which a rule overridden by
   anything later would produce with the class still in the markup.
*/
const mulliganColour = await painted(alice, '.setup-row .mulligan')
const readyColour = await painted(alice, '.setup-row .ready')
check('the mulligan is painted green rather than grey',
   /^rgb\(5, 150, 105\)$|^rgb\(22, 163, 74\)$|^rgb\(21, 128, 61\)$/.test(mulliganColour || ''), mulliganColour)
check('and Ready is a different colour from it',
   Boolean(readyColour) && readyColour !== mulliganColour, `ready=${readyColour} mulligan=${mulliganColour}`)
check('the turn order is written to the log',
   dealt.alice.log.some((l) => /Decided to go First|Decided to go Second/.test(l)),
   JSON.stringify(dealt.alice.log))
check('and the line says "Decided", not "Player decided"',
   !dealt.alice.log.some((l) => /Player decided/.test(l)))
check('both boards have dealt seven cards and six prizes',
   dealt.alice.hand === 7 && dealt.alice.prizes === 6 && dealt.bob.hand === 7 && dealt.bob.prizes === 6,
   `alice=${dealt.alice.hand}/${dealt.alice.prizes} bob=${dealt.bob.hand}/${dealt.bob.prizes}`)
check('and are veiled while the hands are being decided',
   dealt.alice.veil > 0 && dealt.bob.veil > 0, `alice=${dealt.alice.veil} bob=${dealt.bob.veil}`)

/* --------------------------------------------------------------- the mulligan --- */

/*
   The mulligan, before either player is ready: two lines, the count, and a hand that is still
   seven cards. It is checked here rather than in the store because the *count on the button* is
   a rendering, and because a redraw that quietly emptied the hand would leave the row looking
   exactly the same.
*/
const beforeMulligan = await board(alice)
check('the mulligan button starts with no count on it',
   beforeMulligan.row[1].label === 'Mulligan', beforeMulligan.row[1].label)

await clickButton(alice, '.setup-row button', 'Mulligan')
await sleep(1800)

const mulliganed = await board(alice)
check('the mulligan writes the count and the hand',
   mulliganed.log.some((l) => /Player had 1 mulligans/.test(l)) && mulliganed.log.some((l) => /Hand: /.test(l)),
   JSON.stringify(mulliganed.log))
check('and the button shows the count',
   mulliganed.row[1].label === 'Mulligan (1)', mulliganed.row[1].label)
check('and the redraw leaves seven cards in hand and six prizes',
   mulliganed.hand === 7 && mulliganed.prizes === 6,
   `${mulliganed.hand} in hand, ${mulliganed.prizes} prizes`)

/* ----------------------------------------------------------------- ready --- */

/*
   **A tick, and no animation.** The button used to pulse for as long as the other player took,
   which is a light nobody can turn off; what the tick says - *this one is done, and is waiting* -
   it says on its own. The animation is asked of the computed style, since a class left in the
   markup would pass a check that only read the markup.
*/
await clickButton(alice, '.setup-row button', 'Ready')
await sleep(1600)
const readied = await board(alice)
check('the player who pressed Ready sees a tick and a dead button',
   readied.row[0].label === 'Ready ✓' && readied.row[0].disabled === true,
   JSON.stringify(readied.row[0]))
check('and it is not animating',
   (await alice.evaluate(`getComputedStyle(document.querySelector('.setup-row .ready')).animationName`)) === 'none',
   'the continuous glow is gone')
check('and it is still painted, not dimmed',
   (await alice.evaluate(`getComputedStyle(document.querySelector('.setup-row .ready')).opacity`)) === '1')
check('and the game has not started on one press',
   (await board(alice)).row.length === 2)

/* ----------------------------------------------------------------- the start --- */

await clickButton(bob, '.setup-row button', 'Ready')
await wait('the game to start on both boards', settled((a, b) =>
   a.row.length === 0 && b.row.length === 0 && a.veil === 0 && b.veil === 0))
await sleep(800)

const started = { alice: await board(alice), bob: await board(bob) }
check('the row is gone on both boards',
   started.alice.row.length === 0 && started.bob.row.length === 0)
check('the veil is off both boards',
   started.alice.veil === 0 && started.bob.veil === 0,
   `alice=${started.alice.veil} bob=${started.bob.veil}`)
/*
   **Turn 1, and stated rather than counted.** `$turn + 1` was correct for one board and wrong for
   two: a second entry into the start advanced the counter again, and the observed turn row read
   *Turn 2* with the log saying the game had begun exactly once.
*/
check('and the opening turn is 1 on both boards',
   /Turn\s*1\b/.test(started.alice.turn || '') && /Turn\s*1\b/.test(started.bob.turn || ''),
   `alice="${started.alice.turn}" bob="${started.bob.turn}"`)
check('Game started is written exactly once',
   started.alice.log.filter((l) => /Game started/.test(l)).length === 1,
   JSON.stringify(started.alice.log))

/*
   The clock, read until it has actually ticked: a clock that has *just* been started still shows
   the fifty minutes it was set to for the first second, so a check that read it once failed on
   *"clock reads 50:00"* about one run in three. What is asserted is that it is counting down,
   which is the thing the start is for.
*/
const clockReads = async () => {
   const deadline = Date.now() + 15000
   for (;;) {
      const now = await alice.evaluate(`(document.querySelector('.timer-row .clock') || {}).innerText || null`)
      if (/4[0-9]:/.test(now || '')) return now
      if (Date.now() > deadline) return now
      await sleep(500)
   }
}
const clock = await clockReads()
check('and the clock is running', /4[0-9]:/.test(clock || ''), `clock reads ${clock}`)

/* -------------------------------------------------- the row the game runs on --- */

/*
   **Flip Coin and End Turn come back when the game does.** They are the two actions a room has
   always had, and they had no button at all while the setup row was the only row there was; they
   were on `F` and `Enter` alone. What is checked is that they are *painted*, and that they answer
   - a button that is drawn but dead is the fault this row exists to avoid.
*/
check('the game row offers Flip Coin and End Turn',
   started.alice.liveRow.join() === 'Flip Coin,End Turn', JSON.stringify(started.alice.liveRow))
check('and it is up on both boards',
   started.bob.liveRow.join() === 'Flip Coin,End Turn', JSON.stringify(started.bob.liveRow))
check('and the setup row is not drawn beside it',
   started.alice.row.length === 0 && started.alice.liveRow.length === 2)

const turnBefore = (await board(alice)).turn
await clickButton(alice, '.game-actions button', 'End Turn')
await sleep(1500)
const ended = await board(alice)
check('and End Turn ends the turn',
   /Turn\s*2\b/.test(ended.turn || '') && ended.log.some((l) => /End Turn/.test(l)),
   `turn "${turnBefore}" -> "${ended.turn}"`)

await clickButton(alice, '.game-actions button', 'Flip Coin')
await sleep(1500)
const flipped = await board(alice)
check('and Flip Coin flips and logs one',
   flipped.log.some((l) => /Coin flip: (HEADS|TAILS)/.test(l)) &&
   flipped.log.filter((l) => /Coin flip: (HEADS|TAILS)/.test(l)).length === 2,
   JSON.stringify(flipped.log))

/* ------------------------------------------- leaving, and making another room --- */

/*
   **The reported fault.** A player plays a game, leaves the room, makes another one with somebody
   else - and *Game Setup* is not there at all, so the second room cannot be started.

   The page is never reloaded across that, so `stores/gameSetup.js` keeps its state across both
   rooms, and the reset it had covered only *leaving* and *a seat changing hands*. Neither is what
   happens here: the new room's seats are the same two members in the same order, so the seat
   watcher had nothing to notice, and the flow still held a `ready` list naming two members that
   the new room's seats then satisfied - `bothReady()` on a room that had not dealt, which is what
   put the phase at `live` and took the button away.

   What the fix adds is a reset on *entering* a room, registered on `createdRoom` and `joinedRoom`,
   which is the pair of halves a board knows about itself.
*/
console.log('\n  --- leaving the room, and making another one ---')

/* out through the Leave Room button, whose "Sure?" the harness answers for us */
await alice.evaluate(`(() => {
   const el = [...document.querySelectorAll('button')].find((b) => /^Leave Room$/.test(b.textContent.trim()))
   if (!el) return false
   el.click()
   return true
})()`)
await sleep(2000)

const left = await alice.evaluate(`document.body.innerText.includes('Play Solo')`)
check('the player is back at the main menu', left === true)

/*
   **And the menu is the menu.** The lock draws on a phase of `idle`, and a board that is *at the
   menu* is in exactly that phase - so a lock drawn on the phase alone covers the lobby: reported
   as *"Seeing Setting up the game when I load into the main menu"*, over the logo and the Play Solo
   button. What is asserted is that nothing of the opening is on screen once the room is gone.
*/
const atMenu = await board(alice)
check('and the opening is not drawn over the menu',
   atMenu.dialog === null && atMenu.backdrop === false &&
   (await alice.evaluate(`document.body.innerText.includes('Setting up the game')`)) === false,
   `dialog=${JSON.stringify(atMenu.dialog)}`)

/*
   And the other one, who was *in* that room when it closed: leaving ends the game for whoever is
   left, so this board is sent back to the menu too - which is the state a second room is made
   from, and the one the report was about.
*/
await wait('the other player to be back at the menu',
   async () => (await bob.evaluate(`document.body.innerText.includes('Play Solo')`)) === true)
check('and so is the other player', true)

/* and a new room, with the two of them in it */
await lobby(alice)
await lobby(bob)
const secondRoom = await alice.createRoom('Alice')
await bob.joinRoom(secondRoom, 'Bob')
console.log(`  second room ${secondRoom}`)
await alice.importDeck()
await bob.importDeck()
await sleep(2500)

const rebuilt = { alice: await board(alice), bob: await board(bob) }
check('the Game Setup button is there in the new room',
   rebuilt.alice.setupButton.present === true && rebuilt.bob.setupButton.present === true,
   `alice=${JSON.stringify(rebuilt.alice.setupButton)} bob=${JSON.stringify(rebuilt.bob.setupButton)}`)
check('and it is enabled, so the opening can begin',
   rebuilt.alice.setupButton.disabled === false && rebuilt.bob.setupButton.disabled === false,
   `alice=${rebuilt.alice.setupButton.disabled} bob=${rebuilt.bob.setupButton.disabled}`)
check('and nothing of the old game is left in the new one',
   rebuilt.alice.hand === 0 && rebuilt.alice.turn === 'Turn 0' &&
   !rebuilt.alice.log.some((l) => /Game started/.test(l)),
   `hand=${rebuilt.alice.hand} turn="${rebuilt.alice.turn}" log=${JSON.stringify(rebuilt.alice.log)}`)

/* and the whole opening runs again, which is the point of the button being there */
await clickButton(alice, 'button', 'Game Setup')
await sleep(1200)
await clickButton(bob, 'button', 'Game Setup')
await wait('the toss in the new room',
   async () => (await board(alice)).buttons.includes('Heads') || (await board(bob)).buttons.includes('Heads'))
await sleep(1200)

const toss2 = { alice: await board(alice), bob: await board(bob) }
check('the toss runs in the new room',
   toss2.alice.buttons.includes('Heads') !== toss2.bob.buttons.includes('Heads'),
   `alice=${JSON.stringify(toss2.alice.buttons)} bob=${JSON.stringify(toss2.bob.buttons)}`)
console.log('  new room dialogs:',
   JSON.stringify([ toss2.alice.dialog?.slice(0, 45), toss2.bob.dialog?.slice(0, 45) ]))

const caller2 = toss2.alice.buttons.includes('Heads') ? alice : bob
await clickButton(caller2, '.setup-dialog button', 'Heads')
await sleep(2200)

const order2 = { alice: await board(alice), bob: await board(bob) }
const picker2 = order2.alice.buttons.includes('First') ? alice : bob
console.log('  new room order buttons:',
   JSON.stringify([ order2.alice.buttons, order2.bob.buttons ]))
await clickButton(picker2, '.setup-dialog button', 'First')
await wait('the new room to deal on both boards', settled((a, b) =>
   a.row.length === 2 && b.row.length === 2 && a.hand === 7 && b.hand === 7))
await sleep(800)

const newDeal = await board(alice)
check('and the new room deals: seven cards and six prizes',
   newDeal.hand === 7 && newDeal.prizes === 6,
   `${newDeal.hand} in hand, ${newDeal.prizes} prizes`)

browser.detach()

console.log(failures
   ? `\n${failures} check(s) failed`
   : "\nverdict: ok - the room's opening runs on two boards, and a new room offers it again")
process.exit(failures ? 1 : 0)
