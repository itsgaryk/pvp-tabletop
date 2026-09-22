/*
   Reveal and Look, in a real browser, between two real players.

   This is the half of the feature that `tools/render-check.mjs` cannot reach: a
   render to a string can hold the permission rule and draw both windows, and it
   cannot click a menu entry, answer a prompt, or see a window appear on the *other*
   browser. Four things are asserted here, and each needs two pages:

     1. Reveal on the player's own deck opens a window on BOTH boards, with the
        same cards in the same order
     2. Look on the opponent's deck opens a window on the acting board only, and
        the other player is not told about it - it is not a window that failed to
        render there, it is one that was never sent
     3. either player may act on a revealed card, and the action lands on the
        OWNER's board: a card of the opponent's sent to discard turns up in the
        opponent's discard, on the opponent's screen
     4. both windows carry Close and Close & Shuffle, and the shuffle reaches the
        deck's owner

   The cards are not asserted by name: the deck the app is dealt is the stand-in
   deck API's, and what matters here is that the two boards agree about *which*
   cards are on show, which is compared by the images both windows draw.

      powershell -File tools\dev-servers.ps1 -Browsers 2
      node tools/reveal-check.mjs

   The browsers must be started by hand (see the header of tools/browser.mjs): a
   helper that spawns its own has put an error dialog on somebody's screen.
*/

import { attach, sleep } from './browser.mjs'

const BASE = process.env.BASE || 'http://localhost:3005'

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [alice, bob] = await browser.pages(2)
await browser.setViewport(1277, 821)

/*
   The next `prompt` is answered with this. Every "X" on the board is asked for with
   the browser's own prompt (Draw X, View Top X, Order Top X, Reveal Top X, Look at
   Top X), and a headless page that raises one and nobody answers sits blocked for
   ever - so this is set *before* the click that asks.
*/
async function answerNextPrompt (page, value) {
   await page.evaluate(`(() => {
      window.prompt = () => ${JSON.stringify(String(value))}
      return true
   })()`)
}

/*
   One entry of an open context menu, found by the words it shows.

   `ContextMenuOption` renders `<div class="item"><div>Text<span>shortcut</span></div></div>`,
   so the *child's* text is the label: matching on the item's own `textContent`
   would also match a menu whose other entries happen to spell it.

   `rightClick` is dispatched by pointer position rather than by a real mouse, so
   the menu is opened with a synthetic `contextmenu` event; the entries are then
   clicked with `element.click()`, which is what `browser.mjs`'s own `clickText`
   does. What is *not* synthetic is the state: the click runs the real handler.
*/
async function clickMenuItem (page, text) {
   const found = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('.item')]
      const hit = items.find((el) => (el.firstElementChild?.textContent || el.textContent).trim().startsWith(${JSON.stringify(text)}))
      if (!hit) return false
      hit.click()
      return true
   })()`)
   await sleep(900)
   return found
}

async function menuText (page) {
   return page.evaluate(`(() => [...document.querySelectorAll('.item')].map((el) => (el.firstElementChild?.textContent || el.textContent).trim()))()`)
}

/* the words and the card images of whichever pile-style window is open, by kind */
function windowShape (page, kind = null) {
   return page.evaluate(`(() => {
      const want = ${JSON.stringify(kind)}
      const boxes = [...document.querySelectorAll('.popup')]
         .filter((p) => /Revealed|Look —/.test(p.innerText))
         .filter((p) => !want || (want === 'look' ? /Look —/.test(p.innerText) : /Revealed/.test(p.innerText)))
      const pop = boxes[boxes.length - 1]
      if (!pop) return null
      return {
         text: pop.innerText.replace(/\\s+/g, ' ').trim(),
         cards: [...pop.querySelectorAll('img.card')].map((img) => img.getAttribute('src')),
         buttons: [...pop.querySelectorAll('button')].map((b) => b.textContent.trim()),
         centred: (() => {
            const r = pop.getBoundingClientRect()
            return Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4
         })()
      }
   })()`)
}

/* every pile-style window on a board, by kind - so "no window" can be asserted of both */
function windows (page) {
   return page.evaluate(`(() => [...document.querySelectorAll('.popup')]
      .filter((p) => /Revealed|Look —/.test(p.innerText))
      .map((p) => ({
         kind: /Look —/.test(p.innerText) ? 'look' : 'reveal',
         cards: p.querySelectorAll('img.card').length,
         buttons: [...p.querySelectorAll('button')].map((b) => b.textContent.trim())
      })))()`)
}

/*
   The pile counts of one board, read off the *badges* rather than off the card
   images: a pile draws one cardback however many cards it holds, so `.deck img.card`
   is 1 for a deck of 49. The badged piles are the ones with a number in the corner
   (deck, hand, discard, lost zone, prizes - see docs/board.md), which is exactly what
   a move between them is checked with.
*/
function badges (page) {
   return page.evaluate(`(() => {
      const b = (sel) => {
         const el = document.querySelector(sel + ' .count')
         return el ? parseInt(el.textContent.trim(), 10) : null
      }
      return {
         myDeck: b('.gameboard > .deck'),
         theirDeck: b('.gameboard > .deck2'),
         myDiscard: b('.gameboard > .discard'),
         theirDiscard: b('.gameboard > .discard2'),
         myHand: b('.gameboard > .hand'),
         theirHand: b('.gameboard > .hand2')
      }
   })()`)
}

/* the two decks' own pile elements - where the context menu is listened for */
const MY_DECK = '.gameboard > .deck .pile'
const THEIR_DECK = '.gameboard > .deck2 .pile'

/*
   Wait until a reveal or a look window is on screen with `count` cards, or give up.

   A reveal is a relay round trip, so how long it takes is not this check's to
   choose - and reading the window too early does not look like "it is still
   arriving", it looks like a window with the wrong number of cards in it, which is
   exactly the shape of a real fault. So a count is waited *for* rather than slept
   past, and the wait returns what it saw either way.
*/
async function waitForWindow (page, count, { kind = null, timeout = 12000, poll = 250 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      const shape = await windowShape(page, kind)
      if (shape && shape.cards.length === count) return shape
      if (Date.now() > deadline) return shape
      await sleep(poll)
   }
}

/* and the same for a count that changes on the *other* board, through the mirror */
async function waitForCount (page, read, expected, { timeout = 12000, poll = 250 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      const value = await read(page)
      if (value === expected) return value
      if (Date.now() > deadline) return value
      await sleep(poll)
   }
}

/*
   Let both boards catch up before the next act.

   Every step here is a relay round trip - several, in fact, because a shuffle on one
   board has to land on the other - and the next step opens a *menu* over the board,
   so a window still arriving from the previous step would be a menu opened behind it
   or a click that lands on the wrong element. Two seconds is not a timing assumption
   about any one event: it is the pause before a step that begins with a right-click.
*/
const settle = () => sleep(2000)

/*
   A fresh page, sitting in the lobby and *hydrated*.

   The second load is what matters: the first visit to a cold dev server can lose a
   dynamic import while Vite is still warming up, and a page that did not hydrate
   looks exactly like a board with nothing on it - every later check reads a null
   badge and the failures all point at the feature rather than at the harness. So
   this waits for the app's own client code to have run before it returns, and says
   so if it never does.

   `globalThis.__pvp` is set by `$lib/util/dev-debug.js`, which is imported behind
   `devDebug()` in the page: development only, and a read of the stores rather than
   a way to drive them (see that file).
*/
async function reset (page) {
   await page.go(BASE)
   await page.evaluate(`(() => { localStorage.removeItem('pvp_session'); return true })()`)
   await page.go(BASE)

   for (let i = 0; i < 40; i++) {
      if (await page.evaluate(`Boolean(globalThis.__pvp && document.body.innerText.includes('Create Room'))`)) return true
      await sleep(500)
   }

   check('the page hydrated', false, 'the app\'s own client code never ran - see the console')
   return false
}

/*
   Answer the room's "Still playing?" while the check works.

   This check spends about a minute reading two boards - opening menus, revealing,
   looking, acting - and appending almost nothing to the relay, because a reveal is a
   view and a look is not even sent. At the dev servers' shortened idle window that is
   long enough for the room to prompt and then to *close*, and a closed room is not a
   failed assertion three sections later: it is an empty board and a lobby, so the
   cascade starts with "2 cards where 3 were revealed" and ends with every board
   reading 0. Measured here: the step-5 diagnostic reported `mode not a room, own deck
   0`, which is the room being gone rather than a reveal that did not arrive.

   `browser-check.mjs`'s panel section answers the same prompt for the same reason, and
   its note says the same thing: the idle windows are the room's clock rather than one
   section's.
*/
function keepAlive (pages) {
   return setInterval(() => {
      for (const page of pages) {
         page.evaluate(`(() => { const go = document.querySelector('.idle-go'); if (go) go.click(); return true })()`).catch(() => {})
      }
   }, 1500)
}

try {
   console.log('setting up two players\n')

   await reset(alice)
   await reset(bob)

   const room = await alice.createRoom('Alice')
   check('a room was created', Boolean(room), room || 'no room code')

   const answering = keepAlive([ alice, bob ])

   await bob.joinRoom(room, 'Bob')
   check('and the opponent is in it', (await bob.counts()).mode === 'room')

   await alice.importDeck()
   await alice.setup()
   await bob.importDeck()
   await bob.setup()

   await alice.waitForText('Leave Room')
   await sleep(1200)

   /* both boards have a deck and a hand before anything is revealed */
   const start = await badges(alice)
   const startBob = await badges(bob)
   check('both boards have a deck', start.myDeck > 3 && start.theirDeck > 3,
      `alice deck ${start.myDeck}, bob's deck as she sees it ${start.theirDeck}`)
   check('and the two boards agree about both decks',
      startBob.myDeck === start.theirDeck && startBob.theirDeck === start.myDeck,
      `alice sees ${start.myDeck}/${start.theirDeck}, bob sees ${startBob.myDeck}/${startBob.theirDeck}`)
   check('and both were dealt a hand', start.myHand === 7 && startBob.myHand === 7,
      `${start.myHand} and ${startBob.myHand}`)

   /* ------------------------------------------------------------------ 1. reveal -- */

   console.log('\nreveal: the player\'s own deck\n')

   await alice.rightClick(MY_DECK)
   const deckMenu = await menuText(alice)
   check('the deck menu offers Reveal Top X', deckMenu.some((t) => t.startsWith('Reveal Top X')), deckMenu.join(' | '))
   check('and no Look at the player\'s own deck', !deckMenu.some((t) => t.startsWith('Look at Top X')))

   await answerNextPrompt(alice, 3)
   const revealed = await clickMenuItem(alice, 'Reveal Top X')
   check('and clicking it asks how many and reveals them', revealed)

   const aliceReveal = await waitForWindow(alice, 3)
   check('the reveal window opens on the revealer\'s board', Boolean(aliceReveal), aliceReveal?.text || 'no window')
   check('and it shows three cards', aliceReveal?.cards.length === 3, `${aliceReveal?.cards.length} cards`)
   check('and it names the deck it is showing', Boolean(aliceReveal?.text.includes('Your deck')), aliceReveal?.text)
   check('and it says both players can see them', Boolean(aliceReveal?.text.includes('both players can see these')))

   const bobReveal = await waitForWindow(bob, 3)
   check('and it opens on the opponent\'s board too', Boolean(bobReveal), bobReveal?.text || 'no window')
   check('with the same cards in the same order',
      Boolean(bobReveal) && JSON.stringify(bobReveal.cards) === JSON.stringify(aliceReveal?.cards),
      `${bobReveal?.cards.length} vs ${aliceReveal?.cards.length} cards`)
   check('and the other board names the same deck from its own side',
      Boolean(bobReveal?.text.includes("Your opponent's deck")), bobReveal?.text)
   check('and it carries Close and Close & Shuffle',
      Boolean(aliceReveal?.buttons.includes('Close')) && Boolean(aliceReveal?.buttons.includes('Close & Shuffle')),
      aliceReveal?.buttons.join(' | '))

   /* ------------------------------------------- 3. an action on the other player -- */

   console.log('\nacting on a revealed card of the other player\'s\n')

   /*
      Alice revealed her own deck, so the cards on show are *hers*. Bob acting on one
      is the whole of what the "allowed to take action" property is for, and the card
      has to land in Alice's discard - her board, her card, her pile - with Bob's own
      discard untouched and his mirror of her discard following.
   */
   const before = await badges(alice)
   const beforeBob = await badges(bob)

   const acted = await bob.evaluate(`(() => {
      const pop = [...document.querySelectorAll('.popup')].find((p) => /Revealed/.test(p.innerText))
      const card = pop?.querySelector('img.card')
      if (!card) return false
      const r = card.getBoundingClientRect()
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + 5), clientY: Math.round(r.top + 5) }))
      return true
   })()`)
   check('a revealed card can be right-clicked by the other player', acted)

   await sleep(900)
   const cardMenu = await menuText(bob)
   check('and its menu is the menu for somebody else\'s card',
      cardMenu.some((t) => t.startsWith('To Discard')) && cardMenu.some((t) => t.startsWith('Attach to Their Active')),
      cardMenu.join(' | '))

   const moved = await clickMenuItem(bob, 'To Discard')
   check('and an entry can be taken', moved)

   const landed = await waitForCount(alice, (p) => badges(p).then((b) => b.myDiscard), before.myDiscard + 1)
   check('the card lands in the OWNER\'s discard, not the acting player\'s',
      landed === before.myDiscard + 1,
      `alice's discard ${before.myDiscard} -> ${landed}`)

   const afterBob = await badges(bob)
   check('and the acting player\'s own discard is untouched',
      afterBob.myDiscard === beforeBob.myDiscard,
      `${beforeBob.myDiscard} -> ${afterBob.myDiscard}`)

   const seen = await waitForCount(bob, (p) => badges(p).then((b) => b.theirDiscard), beforeBob.theirDiscard + 1)
   check('and the acting board sees it in the far half\'s discard',
      seen === beforeBob.theirDiscard + 1,
      `${beforeBob.theirDiscard} -> ${seen}`)

   /* the card has left the window, because a batch is a live view of the deck */
   const afterReveal = await waitForWindow(alice, 2)
   check('and the card leaves the reveal window, on the owner\'s board',
      Boolean(afterReveal) && afterReveal.cards.length === 2,
      `${afterReveal?.cards.length} still on show on the owner's board`)
   const afterRevealBob = await waitForWindow(bob, 2)
   check('and on the board that acted on it',
      Boolean(afterRevealBob) && afterRevealBob.cards.length === 2,
      `${afterRevealBob?.cards.length} still on show on the acting board`)

   /* ---------------------------------------------------------------- 2. look -- */

   console.log('\nlook: the opponent\'s deck, privately\n')

   /* close both reveal windows so nothing else is on screen */
   await alice.clickText('Close', { kinds: 'button' })
   await bob.clickText('Close', { kinds: 'button' })
   await sleep(900)

   await alice.rightClick(THEIR_DECK)
   const oppMenu = await menuText(alice)
   check('the opponent\'s deck menu offers Reveal Top X', oppMenu.some((t) => t.startsWith('Reveal Top X')), oppMenu.join(' | '))
   check('and Look at Top X', oppMenu.some((t) => t.startsWith('Look at Top X')))

   await answerNextPrompt(alice, 2)
   const looked = await clickMenuItem(alice, 'Look at Top X')
   check('and clicking it shows two cards', looked)

   const aliceLook = await waitForWindow(alice, 2, { kind: 'look' })
   check('the look window opens on the looking player\'s board', Boolean(aliceLook), aliceLook?.text || 'no window')
   check('and it shows the cards', aliceLook?.cards.length === 2, `${aliceLook?.cards.length} cards`)
   check('and it says only this player can see them', Boolean(aliceLook?.text.includes('only you can see these')))
   check('and it carries Close and Close & Shuffle',
      Boolean(aliceLook?.buttons.includes('Close')) && Boolean(aliceLook?.buttons.includes('Close & Shuffle')),
      aliceLook?.buttons.join(' | '))

   /*
      The look is private: nothing was sent, so nothing can open over there - and the
      assertion is about the *kind* of window rather than about whether one is on
      screen. A reveal's window is the one the other board is looking at when a look is
      taken, and "no window at all" would be a claim about that one instead of about
      the look.
   */
   await sleep(1500)
   const bobWindows = await windows(bob)
   check('and NO look window opens on the other player\'s board',
      !bobWindows.some((w) => w.kind === 'look'),
      bobWindows.map((w) => w.kind).join(', ') || 'no window')

   /*
      And nothing was sent: the other board's log has the shuffle a look can end
      with, and no line about a look having been taken. A spectator is not checked
      here - `canReveal` refuses one before any of this, and a spectator gets no
      deck menu at all.
   */
   const bobLog = await bob.evaluate(`[...document.querySelectorAll('.chat p')].map((p) => p.innerText.trim())`)
   check('and the other player is not told the cards were seen',
      !bobLog.some((line) => /^Looked at the top/.test(line)),
      bobLog.filter((l) => /[Ll]ook/.test(l)).join(' | ') || 'no look line')

   /* ---------------------------------------- 4. close and shuffle on both windows -- */

   console.log('\nclose and shuffle\n')

   const aliceDeckBefore = (await badges(alice)).theirDeck
   const shuffled = await alice.clickText('Close & Shuffle', { kinds: 'button' })
   check('the look window closes with a shuffle', shuffled)
   await sleep(1400)

   const bobDeck = (await badges(bob)).myDeck
   check('and the deck it shuffles is the one the batch named, on its owner\'s board',
      bobDeck === aliceDeckBefore,
      `alice saw ${aliceDeckBefore} in bob's deck, bob's own board has ${bobDeck}`)
   check('and the look window is gone', (await windowShape(alice)) === null)

   /*
      The shuffle reaches the deck's owner, and it arrives as a shuffle alone: a Look
      writes no line for the other player, so what their log shows is the deck
      rearranging itself and nothing about why. Waited for rather than slept past,
      because it is a relay and a mirror update behind the click.
   */
   const sawShuffle = await waitForCount(
      bob,
      (p) => p.evaluate(`[...document.querySelectorAll('.chat p')].filter((x) => /Shuffled Deck/.test(x.innerText)).length`),
      1)
   check('and the owner sees the shuffle, without being told about a look', sawShuffle === 1, `${sawShuffle} shuffle lines`)

   const bobLookLines = await bob.evaluate(`[...document.querySelectorAll('.chat p')].filter((x) => /^Looked at the top/.test(x.innerText)).length`)
   check('and no look line was written on their board', bobLookLines === 0, `${bobLookLines} look lines`)

   /* ------------------------- 5. one shuffle between the two of them -- */

   /*
      The reveal is one act with one deck and one ending, so the shuffle belongs to the
      pair of them rather than to whoever presses first. Pressing it must not take the
      *other* player's window away with it - the cards were revealed and they are still
      reading them - and must not leave them a second shuffle of a deck that has
      already been shuffled.
   */
   console.log('\none shuffle between the two of them\n')

   await settle()

   /*
      The board is checked before the menu is opened, because everything below depends
      on it: a `badges()` of null is a board that is not there, and a null badge would
      otherwise surface three assertions later as "the deck has 1 card".
   */
   const beforeShuffle = await badges(alice)
   const state = await alice.evaluate(`(() => ({
      mode: document.body.innerText.includes('Leave Room') ? 'room' : 'not a room',
      deck: globalThis.__pvp.player.deck.get().length,
      theirDeck: globalThis.__pvp.opponent.defaultOpponent.deck.get().length
   }))()`)
   check('the revealer still has a dealt board to reveal from',
      beforeShuffle.myDeck > 3 && state.mode === 'room',
      `${beforeShuffle.myDeck} cards, mode ${state.mode}, own deck ${state.deck}, far deck ${state.theirDeck}`)

   const beforeShuffleIds = await alice.evaluate(`globalThis.__pvp.opponent.defaultOpponent.deck.get().map((c) => c._id).sort((a, b) => a - b).join(',')`)
   await alice.rightClick(MY_DECK)
   const freshMenu = await menuText(alice)
   check('and its deck menu still opens', freshMenu.some((t) => t.startsWith('Reveal Top X')), freshMenu.join(' | '))

   await answerNextPrompt(alice, 3)
   check('and Reveal Top X can still be taken', await clickMenuItem(alice, 'Reveal Top X'))
   await waitForWindow(alice, 3, { kind: 'reveal' })
   const bobSaw = await waitForWindow(bob, 3, { kind: 'reveal' })
   check('a fresh reveal is on both boards again', Boolean(bobSaw), bobSaw?.text || 'no window')
   check('and both windows offer the shuffle',
      Boolean(bobSaw?.buttons.includes('Close & Shuffle')), bobSaw?.buttons.join(' | '))

   await alice.clickText('Close & Shuffle', { kinds: 'button' })
   await sleep(2500)
   const bobAfter = await waitForWindow(bob, 3, { kind: 'reveal' })
   check('the other player keeps the window, and the cards',
      Boolean(bobAfter) && bobAfter.cards.length === 3,
      `${bobAfter?.cards.length} still on show`)
   check('and their shuffle is gone - one shuffle, one ending',
      Boolean(bobAfter) && !bobAfter.buttons.includes('Close & Shuffle') && bobAfter.buttons.includes('Close'),
      `${bobAfter?.buttons.join(' | ')} :: ${JSON.stringify(await bob.evaluate(`globalThis.__pvp.batches()`))}`)

   const settled = await waitForCount(alice, (p) => badges(p).then((b) => b.theirDeck), beforeShuffle.theirDeck)
   check('and the deck still holds what it did, because it was only ever shuffled once',
      settled === beforeShuffle.theirDeck,
      `${beforeShuffle.theirDeck} -> ${settled} cards, as the revealer sees it`)

   await sleep(2500)
   const shuffles = await bob.evaluate(`[...document.querySelectorAll('.chat p')].filter((p) => /Shuffled Deck/.test(p.innerText)).length`)
   check('and one press of the button wrote one shuffle, which both boards show',
      shuffles === 2,
      `${shuffles} shuffle lines (the shuffle's own line is written by Alice and relayed to Bob)`)

   /*
      "One shuffle, not two" is asked of the *cards*, because the count cannot tell the
      two apart: a deck holds the same 47 either way, and what a second shuffle would
      change is the order. The order is the one thing no mirror is promised - a mirror
      follows the events that *move* cards, and a shuffle writes none, so each board
      puts its own deck in its own order and only the owner's is the real one (which is
      why `shareShuffle` shuffles a mirror rather than mirroring a shuffle). So what is
      asserted is the invariant that does hold: the shuffle changed the order of the
      deck and moved nothing in or out of it.
   */
   const aliceDeckIds = await alice.evaluate(`globalThis.__pvp.opponent.defaultOpponent.deck.get().map((c) => c._id).sort((a, b) => a - b).join(',')`)
   const beforeIds = beforeShuffleIds
   check('and the shuffle moved nothing in or out of the deck',
      aliceDeckIds === beforeIds && aliceDeckIds.length > 0,
      `${aliceDeckIds.split(',').length} cards before and after`)

   const closed = await bob.clickText('Close', { kinds: 'button' })
   check('and their Close still closes it', closed)
   await sleep(1000)
   check('and then it is gone', (await windows(bob)).length === 0)

   clearInterval(answering)
} catch (err) {
   check('the check ran to the end', false, `${err.name}: ${err.message}`)
   console.error(err)
} finally {
   browser.detach()
}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - see the lines above`)
   process.exit(1)
}
console.log('verdict: ok - a reveal is on both boards, a look is on one, and an action on the other player\'s card lands on their board')
