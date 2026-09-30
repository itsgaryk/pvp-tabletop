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
      the order     exactly one player is chosen to choose first or second
      the deal      the dialog goes, the prompt arrives in the middle of the window, both hands
                    and six prizes each, veiled
      ready         the press is visible on the board that made it, and does not start the game
      the start     both ready: prompt gone, veil off, turn 1, one *Game started*, clock running
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
   One board, as a person sees it: what the setup dialog says and offers, what the opening-hand
   prompt says and offers, the turn number, how many veils are drawn, and the game-log lines that
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
      The opening-hand prompt, and where it actually is.

      "In the middle of the screen" is the whole of what was asked for, and it is not something a
      source check can answer: the layer is positioned by the CSS, so what is read here is the
      painted box of the card against the window. pointerEvents is the other half - the prompt is
      over a hand the player has to read, so it must not be taking the board's clicks.

      Measured as a distance from the centre rather than as a rect, so the assertion is "centred"
      and not "at these coordinates on a 1277x821 viewport".

      No backticks anywhere in this string - it is a template literal, and the first one would end
      it. That is what the comment in the component's own file is for; this is one line of it.
   */
   const promptLayer = document.querySelector('.setup-prompt')
   const promptCard = document.querySelector('.setup-card')
   const prompt = promptCard ? (() => {
      const r = promptCard.getBoundingClientRect()
      return {
         up: true,
         offCentreX: Math.round(Math.abs((r.left + r.width / 2) - window.innerWidth / 2)),
         offCentreY: Math.round(Math.abs((r.top + r.height / 2) - window.innerHeight / 2)),
         pointerEvents: promptLayer ? getComputedStyle(promptLayer).pointerEvents : null
      }
   })() : { up: false, offCentreX: null, offCentreY: null, pointerEvents: null }
   /*
      The room's code, as the window that is up carries it - the panel's own copy is behind that
      window, so the search is scoped to the dialog rather than to the document. Asking the whole
      document would find the panel's copy button first (the sidebar is later in the DOM than the
      Import Deck window) and report a button nobody can reach as if it were the one on screen.

      hit is the real question and not whether the code is drawn: the reported fault was that the
      code **could not be copied** during setup, so what is asked is whether the element under the
      middle of the copy button is the button.
   */
   const codeOwner = document.querySelector('.setup-dialog') || document.querySelector('.import-window')
   const codeButton = codeOwner ? codeOwner.querySelector('.room-code-copy') : null
   const code = codeButton ? (() => {
      const r = codeButton.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const value = codeOwner.querySelector('.room-code-value')
      return { value: value ? value.textContent.trim() : null, hit: codeButton.contains(top) || top === codeButton }
   })() : { value: null, hit: false }
   /*
      This player's own prize pile, and it needs saying which one that is: the board draws *two*
      piles wearing the same class - the near half's and the far half's - and which one comes first
      in the document is not fixed, so a plain querySelector answered with the opponent's as often
      as with this player's. The near one is the child of the board placed by grid-area prizes, and
      that is the one thing about it that is stable.
   */
   const nearPrizes = [...document.querySelectorAll('.gameboard > .prizes')]
      .find((el) => getComputedStyle(el).gridArea === 'prizes')

   /*
      The labelled buttons only. The room code's copy button is an icon with an aria-label and no
      text, and counting it among the things a dialog "offers" is what would make "this window asks
      for nothing" fail on a window that asks for nothing - it is read separately, as code and as
      iconButtons, which is where it can be asserted properly.
   */
   const allButtons = box ? [ ...box.querySelectorAll('button') ] : []

   return {
      dialog: box ? box.innerText.replace(/\\s+/g, ' ').trim() : null,
      buttons: allButtons.filter((b) => b.textContent.trim()).map((b) => b.textContent.trim()),
      iconButtons: allButtons.filter((b) => !b.textContent.trim()).map((b) => b.getAttribute('aria-label')),
      code,
      backdrop: Boolean(document.querySelector('.setup-backdrop')),
      setupButton: setupButton
         ? { present: true, disabled: setupButton.disabled, label: setupButton.textContent.trim() }
         : { present: false },
      row,
      prompt,
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

/*
   Answer the room's "Still playing?" while the check works.

   **This check takes about forty seconds and appends very little to the relay**, and the dev stack
   runs the relay's idle window at eight seconds with a twelve-second prompt (`RELAY_IDLE_MS` in
   `tools/dev-servers.ps1`) so the lifecycle can be tested at all. That is long enough for the room
   to prompt and then to **close**, and a closed room is not a failed assertion three sections
   later: it is a lobby, so the turn row, the clock, the game row and the log all read `null` and
   every assertion after the start fails at once - measured, and it is what *"after the start,
   alice: turn null ... Room closed: nobody answered the idle prompt"* was.

   `reveal-check.mjs` and the panel section of `browser-check.mjs` answer the same prompt for the
   same reason: those windows are the *room's* clock, not one check's.
*/
function keepAlive (pages) {
   return setInterval(() => {
      for (const page of pages) {
         page.evaluate(`(() => { const go = document.querySelector('.idle-go'); if (go) go.click(); return true })()`).catch(() => {})
      }
   }, 1500)
}

const alive = keepAlive([ alice, bob ])

const room = await alice.createRoom('Alice')
await bob.joinRoom(room, 'Bob')
console.log(`  room ${room}\n`)

/* ------------------------------------------------------------- the lock, and the start --- */

/*
   **The Import Deck window is the thing covering the board while a deck is missing, and this check
   is that it is reachable.**

   The setup dialog is at `z-index: 46` and the import window at `45`, so a lock drawn before a deck
   has landed sits *over* the window - every button, the textarea, all of it. That is the reported
   fault: *"player is still unable to import the deck"*, with the window visible underneath. The
   setup dialog therefore does not draw until this player has imported, and the two come in the order
   they were asked for.
*/
await wait('the import window', async () =>
   (await alice.evaluate(`document.body.innerText.includes('Import Random Deck')`)) === true)

const importing = await board(alice)
check('the import window is up, and the setup dialog is not over it',
   importing.dialog === null && importing.backdrop === false,
   `dialog=${JSON.stringify(importing.dialog)} - a lock here would take the window's clicks`)

/*
   What "reachable" means, asked properly: the element at the centre of the import button **is** that
   button, rather than something drawn over it. Clicking and hoping would pass on a button that
   happened to be hit-testable and fail confusingly when it was not.
*/
const topOfImport = await alice.evaluate(`(() => {
   const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Import Random Deck')
   if (!button) return 'no button'
   const box = button.getBoundingClientRect()
   const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
   return { topIsTheButton: button.contains(top) || top === button, top: top ? top.className || top.tagName : null }
})()`)
check('and nothing is drawn over the import buttons',
   topOfImport.topIsTheButton === true, JSON.stringify(topOfImport))

/*
   **And the room's code is on this window, and its copy button can actually be clicked.**

   This is the reported fault: *"during game setup the game room code cannot be copied"*. The code
   has always been in the panel beside the board, and this window is `position: fixed; inset: 0`,
   so for the whole of the setup it is behind a backdrop - and this window is the first of the two
   that does it. The assertion is the hit test rather than the presence, because a code that is
   drawn but under something reads exactly like a code that is clickable.
*/
check('the room code is on the import window, and its copy button is the thing under the pointer',
   importing.code.value === room && importing.code.hit === true,
   `code=${JSON.stringify(importing.code)} room=${room}`)

/* and the deck actually goes in, which is the thing the player could not do */
await alice.importDeck()
await sleep(2000)

const afterImport = await board(alice)
check('and the import lands',
   afterImport.hand > 0 || afterImport.prizes !== null || afterImport.dialog !== null,
   'the window closed, so the deck arrived')
check('and the setup dialog is up now, for the player who has imported',
   /Setting up the game/.test(afterImport.dialog || '') &&
   /Both players need to import a deck before the game can begin/.test(afterImport.dialog || ''),
   JSON.stringify(afterImport.dialog))
check('and it says nothing about pressing anything',
   afterImport.buttons.length === 0 && !/Game Setup/.test(afterImport.dialog || ''),
   'the opening is not gated on a press')
/*
   The one button this window does carry is the room code's copy, which is not about the opening -
   and it is the second window to cover the panel, so the same question as above is asked of it.
*/
check('and the only thing on it is the room code, with its copy button reachable',
   afterImport.iconButtons.join() === 'Copy room code' &&
   afterImport.code.value === room && afterImport.code.hit === true,
   `iconButtons=${JSON.stringify(afterImport.iconButtons)} code=${JSON.stringify(afterImport.code)}`)
check('and the lock is the whole window, not the board',
   afterImport.backdrop === true, 'a click meant for a card lands on the backdrop')
check('and no Game Setup button is drawn at all',
   afterImport.setupButton.present === false)

/*
   **Both decks, and the opening starts on its own.** The button this used to be gated on is gone -
   the deal cannot be built from a deck that is not there, and the room can see that for itself, so
   there was nothing left for a press to decide.
*/
await bob.importDeck()

/* ------------------------------------------------------------------ the toss --- */

await wait('the coin dialog, with no press of any kind',
   async () => (await board(alice)).buttons.includes('Heads') || (await board(bob)).buttons.includes('Heads'))
await sleep(1500)

const toss = { alice: await board(alice), bob: await board(bob) }
const aliceCalls = toss.alice.buttons.includes('Heads')
const bobCalls = toss.bob.buttons.includes('Heads')

check('the second deck starts the toss by itself', aliceCalls || bobCalls)
check('and the import lock is gone',
   !/Setting up the game/.test(toss.alice.dialog || '') && !/Setting up the game/.test(toss.bob.dialog || ''))
check('exactly one player is offered the call', aliceCalls !== bobCalls,
   `alice=${aliceCalls} bob=${bobCalls}`)
check('and that player is offered Heads and Tails',
   (aliceCalls ? toss.alice.buttons : toss.bob.buttons).join() === 'Heads,Tails',
   JSON.stringify(aliceCalls ? toss.alice.buttons : toss.bob.buttons))
check('and the other is told who is calling, with nothing to press',
   (aliceCalls ? toss.bob : toss.alice).buttons.length === 0 &&
   /is calling the coin toss/.test((aliceCalls ? toss.bob : toss.alice).dialog),
   JSON.stringify((aliceCalls ? toss.bob : toss.alice).buttons))
check('and the board is locked while the toss is open',
   toss.alice.backdrop === true && toss.bob.backdrop === true,
   'the cards are not anybody\'s until the order is settled')
/*
   And the code travels with it: the setup dialog is the second window to cover the panel, and the
   toss is the longest wait in the opening - the one where a player is most likely to be telling
   somebody else the code.
*/
check('and the room code is on the toss dialog, with its copy button reachable',
   toss.alice.code.value === room && toss.alice.code.hit === true &&
   toss.bob.code.value === room && toss.bob.code.hit === true,
   `alice=${JSON.stringify(toss.alice.code)} bob=${JSON.stringify(toss.bob.code)}`)

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
check('the dialog is gone, and the board is the players\' own again',
   dealt.alice.dialog === null && dealt.bob.dialog === null &&
   dealt.alice.backdrop === false && dealt.bob.backdrop === false,
   'the order being settled is what unlocks it')
check('and no Game Setup button is drawn at any point',
   dealt.alice.setupButton.present === false && dealt.bob.setupButton.present === false)
/*
   **The two buttons are in a prompt in the middle of the window**, rather than the last row of the
   sidebar - which is where they were, at the opposite end of the screen from the seven cards they
   are about. Both halves are asked: where the card is painted, and that the layer over the board
   is not taking the clicks the player needs to read that hand with.
*/
check('the opening hand is asked for in a prompt, and it is the middle of the window',
   dealt.alice.prompt.up === true && dealt.alice.prompt.offCentreX <= 2 && dealt.alice.prompt.offCentreY <= 2,
   JSON.stringify(dealt.alice.prompt))
check('and the prompt is not a lock: the board behind it stays reachable',
   dealt.alice.prompt.pointerEvents === 'none',
   `pointer-events=${dealt.alice.prompt.pointerEvents} - a prompt that answered everywhere would hide the hand it is about`)
check('the prompt offers Ready and Mulligan, neither disabled',
   dealt.alice.row.length === 2 && dealt.alice.row[0].label === 'Ready' &&
   dealt.alice.row[0].disabled === false && dealt.alice.row[1].label === 'Mulligan',
   JSON.stringify(dealt.alice.row))
check('and it is up on both boards',
   dealt.bob.prompt.up === true && dealt.bob.row.length === 2, JSON.stringify(dealt.bob.row))

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
   a.liveRow.length === 2 && b.liveRow.length === 2 && a.veil === 0 && b.veil === 0))
await sleep(800)

const started = { alice: await board(alice), bob: await board(bob) }
/*
   **The prompt goes when the game does**, which is the one moment both of its buttons stop meaning
   anything: the hand is decided, both players have said so, and *Ready* has already done its job -
   both presses are *why* the game started. What is left under the log is the game's own row.

   Asserted on both boards, because the prompt is driven by the phase and the two of them reach
   `live` from different events.
*/
check('the opening-hand prompt is gone on both boards once both are ready',
   started.alice.prompt.up === false && started.bob.prompt.up === false &&
   started.alice.row.length === 0 && started.bob.row.length === 0,
   JSON.stringify([ started.alice.row, started.bob.row ]))
check('and the veil is off both boards',
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

/*
   **The report this section is here for**: the new room has the *same two members in the same
   order*, so a setup left over from the room before it used to satisfy `bothReady()` on a room that
   had not dealt a card - and the opening was never offered again. What is asserted is that the lock
   is up asking for decks, that nothing of the old game is on the board, and that the whole opening
   runs from there.
*/
const rebuilt = { alice: await board(alice), bob: await board(bob) }
/*
   **The new room asks for a deck again, and the import window is how it asks.**
   The setup dialog is deliberately *down* here - it is over the import window (`z-index: 46` against
   `45`) and does not draw until this player has a deck - so what says the room is waiting is the
   window itself. Asserting the dialog's words here would be asserting a screen that must not be up.
*/
const importUp = await alice.evaluate(`document.body.innerText.includes('Import Random Deck')`)
check('the new room asks for a deck again',
   importUp === true && rebuilt.alice.dialog === null,
   `import window=${importUp} dialog=${JSON.stringify(rebuilt.alice.dialog)}`)
check('and nothing of the old game is left in the new one',
   rebuilt.alice.hand === 0 && rebuilt.alice.turn === 'Turn 0' &&
   !rebuilt.alice.log.some((l) => /Game started/.test(l)),
   `hand=${rebuilt.alice.hand} turn="${rebuilt.alice.turn}" log=${JSON.stringify(rebuilt.alice.log)}`)

/* and the whole opening runs again, from the decks alone */
await alice.importDeck()
await bob.importDeck()
await wait('the toss in the new room',
   async () => (await board(alice)).buttons.includes('Heads') || (await board(bob)).buttons.includes('Heads'))
await sleep(1500)

const toss2 = { alice: await board(alice), bob: await board(bob) }
check('the toss runs in the new room',
   toss2.alice.buttons.includes('Heads') !== toss2.bob.buttons.includes('Heads'),
   `alice=${JSON.stringify(toss2.alice.buttons)} bob=${JSON.stringify(toss2.bob.buttons)}`)

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

clearInterval(alive)
browser.detach()

console.log(failures
   ? `\n${failures} check(s) failed`
   : "\nverdict: ok - the room's opening runs on two boards, and a new room offers it again")
process.exit(failures ? 1 : 0)
