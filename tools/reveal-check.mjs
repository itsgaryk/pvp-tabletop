/*
   Reveal and Look, in a real browser, between two real players - and, where a third
   browser is available, a watcher.

   This is the half of the feature that `tools/render-check.mjs` cannot reach: a
   render to a string can hold the permission rule and draw both windows, and it
   cannot click a menu entry, answer a prompt, or see a window appear on the *other*
   browser. Five things are asserted here, and each needs two pages:

     1. Reveal on the player's own deck opens a window on BOTH boards, with the
        same cards in the same order
     2. Look on the opponent's deck opens a window on the acting board, and on a
        watcher's, and NOT on the opponent's - the deck's owner is never sent the
        ids of cards out of its own face-down deck
     3. either player may act on a revealed card, and the action lands on the
        OWNER's board: a card of the opponent's sent to discard turns up in the
        opponent's discard, on the opponent's screen
     4. both windows carry Close and Close & Shuffle, and the shuffle reaches the
        deck's owner
     5. a card out of either window cannot be dropped on the player's own side,
        the table or the Stadium - and can still be dropped on the owner's zones

   The cards are not asserted by name: the deck the app is dealt is the stand-in
   deck API's, and what matters here is that the two boards agree about *which*
   cards are on show, which is compared by the images both windows draw.

      powershell -File tools\dev-servers.ps1 -Browsers 3
      node tools/reveal-check.mjs

   The browsers must be started by hand (see the header of tools/browser.mjs): a
   helper that spawns its own has put an error dialog on somebody's screen.

   Section 2b is the only part that needs the third browser. With two it says so and
   skips, rather than failing for a browser nobody started.
*/

import { attach, sleep } from './browser.mjs'

const BASE = process.env.BASE || 'http://localhost:3005'

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const pages = await browser.pages(browser.ports.length >= 3 ? 3 : 2)
const [ alice, bob ] = pages
const watcher = pages[2] || null
await browser.setViewport(1277, 821)

/*
   The next `prompt` is answered with this. Every "X" on the board is asked for with
   the browser's own prompt (Draw X, View Top X, Order Top X, Reveal Top X, the
   opponent's View Top X, and the two Discard Top X entries), and a headless page that
   raises one and nobody answers sits blocked for ever - so this is set *before* the
   click that asks.
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
         .filter((p) => /Revealed|Look /.test(p.innerText))
         .filter((p) => !want || (want === 'look' ? /Look /.test(p.innerText) : /Revealed/.test(p.innerText)))
      const pop = boxes[boxes.length - 1]
      if (!pop) return null
      return {
         text: pop.innerText.replace(/\\s+/g, ' ').trim(),
         /* the panel's own heading, which is where a window names whose deck it shows */
         heading: (pop.querySelector('.font-bold') || {}).textContent?.trim() || null,
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
      .filter((p) => /Revealed|Look /.test(p.innerText))
      .map((p) => ({
         kind: /Look /.test(p.innerText) ? 'look' : 'reveal',
         cards: p.querySelectorAll('img.card').length,
         text: p.innerText.replace(/\\s+/g, ' ').trim(),
         /* the panel's own heading, which is where a watcher's window names the seat */
         heading: (p.querySelector('.font-bold') || {}).textContent?.trim() || null,
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
   Close whatever panel is open, the way the app offers when a panel has no button of its
   own: Escape, which `Popup` answers with `closed` (`use:escape`). A reveal before its
   shuffle has one button and it is not *Close*, so a check that wants the windows out of
   the way has to close them the way a player would.
*/
function closeWindow (page) {
   return page.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
}

/*
   A real drag, through the browser's own input rather than through dispatched DOM
   events: the board's drag is `pointerdown` on the card, past a five-pixel threshold,
   over the target and `pointerup` on it (`$lib/dnd/pointer.js`), and a synthesized
   `pointerdown` does not drive that - the stores are wired to the body's listeners,
   which only the browser's own input events reach.

   `from` and `to` are expressions evaluated *on the page*, so the caller can walk a
   window's own markup.

   What it returns is what actually happened, not that the events were dispatched: a drag
   that never started and a drop that landed on nothing both look like a successful call if
   the only thing asked is "did the coordinates exist". So it reports whether the drag store
   was carrying a card, and how many zones had highlighted for it by the time the pointer
   was over the target.
*/
async function dragBetween (page, fromExpr, toExpr) {
   const centre = (expr) => page.evaluate(`(() => {
      const el = ${expr}
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
   })()`)

   const from = await centre(fromExpr)
   const to = await centre(toExpr)
   if (!from || !to) return { started: false, highlighted: 0, why: 'an endpoint was not on screen' }

   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' })
   await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 })
   /* past the threshold first, or the drag never starts */
   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 12, y: from.y + 12, button: 'left' })
   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left' })
   await sleep(80)

   const carrying = await page.evaluate(`globalThis.__pvp.drag()`)
   const highlighted = await page.evaluate(`document.querySelectorAll('.dragover').length`)

   await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 })

   return {
      started: Boolean(carrying.card),
      card: carrying.card,
      highlighted,
      why: carrying.card ? (highlighted ? 'ok' : 'nothing under the pointer accepted it') : 'the drag never started'
   }
}

/*
   A fresh page, sitting in the lobby and *hydrated*.

   The second load is what matters: the first visit can lose a dynamic import while the
   app is still warming up, and a page that did not hydrate looks exactly like a board
   with nothing on it - every later check reads a null badge and the failures all point
   at the feature rather than at the harness. So this waits for the app's own client
   code to have run before it returns, and says so if it never does.

   What proves that differs by target, and the obvious probe is wrong in both
   directions: `document.body.innerText` **includes the server-rendered markup**, so
   "Create Room" is on screen before any client code has run, and a check that waits for
   that text is satisfied instantly by a page that is still inert. So this waits for
   `data-hydrated`, which `+page.svelte` sets in its `onMount` - the one mark that means
   the same thing on a dev server and on a deployment, and the reason it exists.
*/
async function reset (page) {
   await page.go(BASE)
   await page.evaluate(`(() => { localStorage.removeItem('pvp_session'); return true })()`)
   await page.go(BASE)

   for (let i = 0; i < 40; i++) {
      const ready = await page.evaluate(`Boolean(document.documentElement.dataset.hydrated) && document.body.innerText.includes('Create Room')`)
      if (ready) return true
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
   if (watcher) await reset(watcher)

   const room = await alice.createRoom('Alice')
   check('a room was created', Boolean(room), room || 'no room code')

   const answering = keepAlive(watcher ? [ alice, bob, watcher ] : [ alice, bob ])

   await bob.joinRoom(room, 'Bob')
   check('and the opponent is in it', (await bob.counts()).mode === 'room')

   await alice.importDeck()
   await alice.setup()
   await bob.importDeck()
   await bob.setup()

   /*
      A watcher, when a third browser was started. A Look is shown to the room's
      watchers and not to the deck's owner, and only a third page can tell those two
      apart - the opponent's board is the one that must stay empty, and a check with
      two pages cannot see the difference between "sent to nobody" and "not sent
      here".
   */
   if (watcher) {
      await watcher.spectate(room, 'Watcher')
      await sleep(3000)
      check('and a spectator is watching it', (await watcher.counts()).mode === 'spectating',
         (await watcher.counts()).mode)
   } else {
      console.log('  skip  the spectator half of the look rules - start three browsers to run it')
   }

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

   /*
      Nothing on the far half wears a ring while nothing is on show.

      This is the one to keep: `opponent/Card.svelte`'s wrapper needs Windi's
      `border-transparent` or `border-2` draws in `currentColor`, and the symptom is a
      pale ring on **every** card of the other half - the opponent's hand included, which
      is exactly how it was reported. A border colour can be read, so it is asserted
      rather than looked at, and it is asserted here, before any window is open, so that
      a live pulse cannot be mistaken for it.
   */
   const idleFaces = await bob.evaluate(`(() => {
      const out = {}
      for (const [ name, sel ] of [ [ 'hand', '.gameboard > .hand2' ], [ 'prizes', '.gameboard > .prizes2' ], [ 'deck', '.gameboard > .deck2' ], [ 'discard', '.gameboard > .discard2' ] ]) {
         const w = document.querySelector(sel + ' div.border-2')
         out[name] = w ? getComputedStyle(w).borderTopColor : 'no card'
      }
      return out
   })()`)
   const clearish = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
   /*
      `no card` is a pass: a deck and a discard draw one face-down front, and whether it
      is there at all depends on the pile being non-empty at this instant. What is being
      asserted is the border of the cards that *are* on screen.
   */
   check('no card of the far half wears a ring while nothing is on show',
      Object.values(idleFaces).every((c) => clearish(c) || c === 'no card'),
      JSON.stringify(idleFaces))

   /* ------------------------------------------------------------------ 1. reveal -- */

   console.log('\nreveal: the player\'s own deck\n')

   await alice.rightClick(MY_DECK)
   const deckMenu = await menuText(alice)
   check('the deck menu offers Reveal Top X', deckMenu.some((t) => t.startsWith('Reveal Top X')), deckMenu.join(' | '))
   /*
      *View Top X* is the name the **Look** entry wears on the opponent's deck, and the
      player's own deck must not grow one: the entry the player's own deck has is *View Top
      X Alt+1...9*, which is the search ("look at the top of my own deck"), and a bare *View
      Top X* on the same menu would be a second entry with the same name and a different
      verb. The two are told apart by the shortcut, which is the only difference the menu
      shows.
   */
   check('and no View Top X beside the search: the player can read their own deck',
      !deckMenu.some((t) => /^View Top X(?! Alt)/.test(t)),
      deckMenu.filter((t) => t.startsWith('View')).join(' | '))
   check('and it offers both discards, the X one under the single card',
      deckMenu.findIndex((t) => t.startsWith('Discard Top X')) === deckMenu.findIndex((t) => t.startsWith('Discard Top Card')) + 1,
      deckMenu.filter((t) => t.startsWith('Discard')).join(' | '))

   await answerNextPrompt(alice, 3)
   const revealed = await clickMenuItem(alice, 'Reveal Top X')
   check('and clicking it asks how many and reveals them', revealed)

   const aliceReveal = await waitForWindow(alice, 3)
   check('the reveal window opens on the revealer\'s board', Boolean(aliceReveal), aliceReveal?.text || 'no window')
   check('and it shows three cards', aliceReveal?.cards.length === 3, `${aliceReveal?.cards.length} cards`)
   check('and it names the deck it is showing', Boolean(aliceReveal?.text.includes('Your deck')), aliceReveal?.text)
   check('and it says both players can see them', Boolean(aliceReveal?.text.includes('both players can see these')))

   /*
      **Both players get the window and a spectator does not.** The cards travel to every
      board as a batch - that is the permission - but the window is what puts those cards
      *on* a board: a revealed card stays in a face-down deck, and a face-down deck is one
      pile image, so a player with no window has nothing to right-click. A spectator is
      told what was shown by the game log, which names the cards.
   */
   const bobReveal = await waitForWindow(bob, 3)
   check('and it opens on the other player\'s board too, because they may act on it',
      Boolean(bobReveal), bobReveal?.text || 'no window')
   check('with the same cards in the same order',
      Boolean(bobReveal) && JSON.stringify(bobReveal.cards) === JSON.stringify(aliceReveal?.cards),
      `${bobReveal?.cards.length} vs ${aliceReveal?.cards.length} cards`)
   check('and the other board names the same deck from its own side',
      Boolean(bobReveal?.text.includes("Your opponent's deck")), bobReveal?.text)

   /*
      One ending, and it is the shuffle. A reveal whose window offered *Close* beside it
      offered the player a way to put the deck back exactly as it was - which is the one
      ending a reveal is not, since reading the top of a deck is the whole of why it was
      shuffled. Escape and a click outside still close it without shuffling, and the
      *Close* that appears after a shuffle is asserted in section 5.
   */
   check('and its only action is Close & Shuffle',
      JSON.stringify(aliceReveal?.buttons) === JSON.stringify([ 'Close & Shuffle' ]),
      aliceReveal?.buttons.join(' | '))
   check('and that is what the table was told, with the cards named',
      (await alice.evaluate(`[...document.querySelectorAll('.chat p')].map((p) => p.innerText.trim())`))
         .some((line) => /Revealed \[Card\d+, Card\d+, Card\d+\] from the top of their deck/.test(line)),
      (await alice.evaluate(`[...document.querySelectorAll('.chat p')].map((p) => p.innerText.trim())`)).filter((l) => /Revealed/.test(l)).join(' | ') || 'no reveal line')

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
   check('and it offers nothing that would put the card on a shared zone',
      !cardMenu.some((t) => t.trim() === 'To Stadium' || t.trim() === 'To Table'),
      cardMenu.join(' | '))

   const moved = await clickMenuItem(bob, 'To Discard')
   check('and an entry can be taken', moved)

   /*
      The card leaves the *acting* board at once, before the round trip.

      This is what a player feels as "the action is slow": the relay's own round trip is
      about 1.7s here, measured on a plain move between the same two boards, so waiting
      for it means the card sits where it was for two seconds after the button is
      pressed. The move is applied on the acting board's mirror as it is requested
      (`optimisticMove`), so this has to be true within a few hundred milliseconds - and
      the point of asserting it *here*, before the owner's count is waited for, is that a
      5s relay would fail it.
   */
   const actedFast = await waitForCount(bob, (p) => badges(p).then((b) => b.theirDiscard), beforeBob.theirDiscard + 1, { timeout: 700, poll: 40 })
   check('and the acting board sees it move at once, without waiting for the relay',
      actedFast === beforeBob.theirDiscard + 1,
      `${beforeBob.theirDiscard} -> ${actedFast} within 700ms`)

   const landed = await waitForCount(alice, (p) => badges(p).then((b) => b.myDiscard), before.myDiscard + 1)
   check('the card lands in the OWNER\'s discard, not the acting player\'s',
      landed === before.myDiscard + 1,
      `alice's discard ${before.myDiscard} -> ${landed}`)

   const afterBob = await badges(bob)
   check('and the acting player\'s own discard is untouched',
      afterBob.myDiscard === beforeBob.myDiscard,
      `${beforeBob.myDiscard} -> ${afterBob.myDiscard}`)

   const seen = await waitForCount(bob, (p) => badges(p).then((b) => b.theirDiscard), beforeBob.theirDiscard + 1)
   check('and the acting board still shows it after the owner answers',
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

   console.log('\nlook: the opponent\'s deck, shown to the looker and the watchers\n')

   /*
      Close both reveal windows so nothing else is on screen - with **Escape**, which is
      what a reveal without a *Close* button offers, and which closes a `Popup` without
      shuffling anything. Clicking *Close* here was how this section used to do it, and
      that button is now only on a window whose shuffle has already happened.
   */
   await closeWindow(alice)
   await closeWindow(bob)
   await sleep(900)

   await alice.rightClick(THEIR_DECK)
   const oppMenu = await menuText(alice)
   check('the opponent\'s deck menu offers Reveal Top X', oppMenu.some((t) => t.startsWith('Reveal Top X')), oppMenu.join(' | '))
   check('and View Top X, which is the Look entry\'s name', oppMenu.some((t) => t.startsWith('View Top X')))
   check('and Discard Top Card', oppMenu.some((t) => t.startsWith('Discard Top Card')))
   check('and Discard Top X', oppMenu.some((t) => t.startsWith('Discard Top X')))

   /*
      **A reveal of the *opponent's* deck is the case the report named**, and it is
      checked on its own rather than folded into section 1: there the revealer shows
      their own deck and the other board reads "Your opponent's deck", which is a
      different flip from this one. Here the deck that is on show belongs to the board
      being *told*, so the window has to open there and say "Your deck" - and both
      cases are the same rule, which is why both are asserted.

      The menu is still open from the right-click above, so this is one entry taken
      from it. It is closed again afterwards - with Escape, which shuffles nothing -
      because the look below needs a menu of its own to be the thing that is open.
   */
   await answerNextPrompt(alice, 2)
   await clickMenuItem(alice, 'Reveal Top X')
   const theirRevealAlice = await waitForWindow(alice, 2, { kind: 'reveal' })
   const theirRevealBob = await waitForWindow(bob, 2, { kind: 'reveal' })
   check('a reveal of the opponent\'s deck opens on the revealer too',
      Boolean(theirRevealAlice), theirRevealAlice?.text || 'no window')
   check('and on the board whose deck it is',
      Boolean(theirRevealBob), theirRevealBob?.text || 'no window')
   check('and that board names it as its own deck',
      theirRevealBob?.heading === 'Revealed — Your deck', String(theirRevealBob?.heading))

   await closeWindow(alice)
   await closeWindow(bob)
   await sleep(1200)
   await alice.rightClick(THEIR_DECK)

   /*
      Three cards are looked at, and the *last* one is what the drag section below uses.
      The `2` here is the number of cards this section asserts on, not the size of the
      batch: the bulk move below takes two of them at once - which is the assertion it
      exists for - and the drag then needs a card of its own still in the window. A batch
      of exactly two left the drag asserting against an empty window, and reporting "the
      drag failed" for "there was nothing to drag".
   */
   await answerNextPrompt(alice, 3)
   const looked = await clickMenuItem(alice, 'View Top X')
   check('and clicking it shows two cards', looked)

   const aliceLook = await waitForWindow(alice, 2, { kind: 'look' })
   check('the look window opens on the looking player\'s board', Boolean(aliceLook), aliceLook?.text || 'no window')
   check('and it shows the cards', aliceLook?.cards.length === 3, `${aliceLook?.cards.length} cards`)
   check('and it says only this player can see them', Boolean(aliceLook?.text.includes('only you can see these')))

   /*
      One action, and it is Close & Shuffle: a look at the other player's deck that put it
      back in the order it was found is the one ending that is not the point of it. A
      second button that only closed the window was a choice between the same thing and
      less.
   */
   check('and its only action is Close & Shuffle',
      Boolean(aliceLook) && aliceLook.buttons.length === 1 && aliceLook.buttons[0] === 'Close & Shuffle',
      aliceLook?.buttons.join(' | ') || 'no buttons')

   /*
      And its cards do not pulse. The outline animation is a *Reveal's* affordance - one
      or two cards of the other player's among cards of the player's own, with nothing
      else to say which reply - while in a Look every card answers, so a glow on all of
      them is decoration that makes a chosen card unreadable. Read off the wrapper rather
      than the stylesheet, because the class is what the card wears.
   */
   const lookCards = await alice.evaluate(`(() => {
      const pop = [...document.querySelectorAll('.popup')].find((x) => /Look /.test(x.innerText))
      if (!pop) return null
      const ws = [...pop.querySelectorAll('div.border-2')]
      return {
         n: ws.length,
         pulsing: ws.filter((w) => getComputedStyle(w).animationName !== 'none').length,
         borders: [ ...new Set(ws.map((w) => getComputedStyle(w).borderTopColor)) ]
      }
   })()`)
   check('and its cards do not pulse',
      Boolean(lookCards) && lookCards.pulsing === 0,
      `${lookCards?.pulsing} of ${lookCards?.n} pulsing`)
   check('and they carry no ring of their own',
      Boolean(lookCards) && lookCards.borders.every((c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'),
      JSON.stringify(lookCards?.borders))

   /*
      And a card in it can be picked out, which is the report this answers: with the pulse
      gone there is nothing on screen that says a click does anything, so the ring after
      the click and the line in the header are the whole of the feedback.
   */
   const picked = await alice.evaluate(`(() => {
      const pop = [...document.querySelectorAll('.popup')].find((x) => /Look /.test(x.innerText))
      const imgs = [...pop.querySelectorAll('img.card')]
      imgs[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      imgs[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
      return true
   })()`)
   await sleep(500)
   const pickedNow = await alice.evaluate(`(() => {
      const pop = [...document.querySelectorAll('.popup')].find((x) => /Look /.test(x.innerText))
      return {
         selected: [...pop.querySelectorAll('div.border-2')].filter((w) => w.className.includes('selected')).length,
         says: /picked out/i.test(pop.innerText) || /2 cards/.test(pop.innerText)
      }
   })()`)
   check('and its cards can be picked out, one and then two',
      picked && pickedNow.selected === 2,
      `${pickedNow?.selected} wearing the selection ring`)

   /*
      And the menu acts on all of them at once. This is the multi-card half: the picked-up
      cards are what an entry carries, the same as every other card menu on the board.
   */
   const beforeBulk = await badges(alice)
   await alice.evaluate(`(() => {
      const pop = [...document.querySelectorAll('.popup')].find((x) => /Look /.test(x.innerText))
      const w = [...pop.querySelectorAll('div.border-2')].find((x) => x.className.includes('selected'))
      w.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))
      return true
   })()`)
   await sleep(700)
   const bulkMenu = await menuText(alice)
   const heading = await alice.evaluate(`(() => { const h = document.querySelector('.heading'); return h ? h.textContent.trim() : null })()`)
   check('and the menu says it will act on both',
      heading === '2 cards',
      `heading "${heading}": ${bulkMenu.slice(0, 4).join(' | ')}`)

   const bulkMoved = await clickMenuItem(alice, 'To Discard')
   check('and one entry carries both cards', bulkMoved)
   const bulkLanded = await waitForCount(
      alice,
      async (p) => p.evaluate(`globalThis.__pvp.opponent.defaultOpponent.discard.get().length`),
      beforeBulk.theirDiscard + 2,
      { timeout: 4000, poll: 60 })
   check('and both land in the owner\'s discard from one entry',
      bulkLanded === beforeBulk.theirDiscard + 2,
      `${beforeBulk.theirDiscard} -> ${bulkLanded} in bob's discard`)

   /*
      The look reaches the watcher and never the deck's owner, and this is the pair of
      assertions the whole of that rule comes down to. The owner is the one player the
      face-down deck withholds, so the *ids* may not be sent there at all - which is why
      the check reads the owner's own batch store rather than looking for a window: "no
      window" would pass on a board that had been handed the cards and declined to draw
      them.

      The assertion about the other board is about the *kind* of window rather than about
      whether one is on screen: a reveal's window is the one that board is looking at when
      a look is taken, and "no window at all" would be a claim about that one instead.
   */
   await sleep(1500)
   const bobWindows = await windows(bob)
   check('and NO look window opens on the other player\'s board',
      !bobWindows.some((w) => w.kind === 'look'),
      bobWindows.map((w) => w.kind).join(', ') || 'no window')

   if (bob.evaluate && await bob.evaluate(`Boolean(globalThis.__pvp)`)) {
      const ownerBatch = await bob.evaluate(`JSON.stringify(globalThis.__pvp.batches().look)`)
      check('and the deck\'s owner is not sent the cards at all', ownerBatch === 'null', ownerBatch)
   }

   /*
      A watcher's window: the same cards, read-only.

      The audience is the reason this window exists - a table where a look happens should
      show that something is happening - and the limit on it is the reason the cards are
      still the looker's. Both are asserted off the watcher's own board, and the *name* in
      the heading is asserted too: a watcher's board mirrors both players, so "your
      opponent's deck" names no half of its screen and the window has to be told which
      seat the look was of.
   */
   if (watcher) {
      const watchWindows = await windows(watcher)
      const watchLook = watchWindows.find((w) => w.kind === 'look')
      check('and the look window opens on the WATCHER', Boolean(watchLook), JSON.stringify(watchWindows.map((w) => w.kind)))
      check('and it shows the same number of cards as the looker\'s window',
         Boolean(watchLook) && watchLook.cards === aliceLook.cards.length,
         `${watchLook?.cards} on the watcher's board, ${aliceLook.cards.length} on the looker's`)
      check('and it is read-only: Close and nothing else',
         Boolean(watchLook) && JSON.stringify(watchLook.buttons) === JSON.stringify([ 'Close' ]),
         watchLook?.buttons.join(' | ') || 'no window')
      check('and it names whose deck is being read, by the seat the look is of',
         Boolean(watchLook?.heading?.includes("Alice's deck")), String(watchLook?.heading))

      const watchInert = await watcher.evaluate(`(() => {
         const pop = [...document.querySelectorAll('.popup')].find((p) => /Look /.test(p.innerText))
         if (!pop) return null
         const ws = [...pop.querySelectorAll('div.border-2')]
         return {
            n: ws.length,
            pulsing: ws.filter((w) => getComputedStyle(w).animationName !== 'none').length,
            selected: (() => {
               const img = pop.querySelector('img.card')
               if (img) img.dispatchEvent(new MouseEvent('click', { bubbles: true }))
               return [...pop.querySelectorAll('div.border-2')].filter((w) => w.className.includes('selected')).length
            })()
         }
      })()`)
      check('and its cards are inert: no pulse, and a click selects nothing',
         Boolean(watchInert) && watchInert.pulsing === 0 && watchInert.selected === 0,
         JSON.stringify(watchInert))
   }

   const bobLookLine = await bob.evaluate(`[...document.querySelectorAll('.chat p')].filter((p) => /^Looked at the top/.test(p.innerText)).length`)
   check('and the deck\'s owner is not told in the log either', bobLookLine === 0, `${bobLookLine} look lines`)

   /* -------------------------------------------- 3b. the same act, by dragging -- */

   /*
      A card out of a window can be dragged onto the other player's side, and it has to
      go to *their* side - "dragging a card from the look window only allows placing it
      to the player's own side" is what this section exists to keep from coming back.

      The gesture is the browser's own input, because the board's drag is `pointerdown`
      and a five-pixel threshold rather than HTML5 drag-and-drop (see `dragBetween`), and
      the zone is the far half's discard: dropping a card there is the same request the
      menu's *To Discard* makes (`actionForPile`), so the card must land in the owner's
      discard and the actor's own must not move.

      It runs *after* the two-card move above and takes the card that leaves behind, and
      both halves of that matter. The two-card move is what the "one entry carries both
      cards" assertion is about, so it needs a batch of two; and a Look is closed by its
      shuffle, so a drag has to happen while the window is still up. A batch of two with
      one card sent away by the menu before it leaves exactly one to drag - a check that
      emptied the window first was asserting against a window with nothing in it, and
      reporting "the drag failed" for "there was nothing to drag".
   */
   const beforeDrag = await badges(bob)
   const dragCard = await alice.evaluate(`(() => {
      const p = [...document.querySelectorAll('.popup')].find((x) => /Look /.test(x.innerText))
      const img = p?.querySelector('img.card')
      return img ? img.getAttribute('alt') : null
   })()`)

   /*
      The card to grab is the *image's wrapper* rather than the `div.border-2` itself: the
      wrapper is what the window draws at a card's size, and the inner div is a
      zero-height line box around it - grabbing its centre would aim the pointer at the
      row rather than at the card, and a drag that starts nowhere is a drag that never
      started. The zone is the far half's discard, which is a pile *or* its own box, so a
      board that draws one rather than the other is still draggable onto.

      The card is dropped on *Bob's* own discard, so it is read from Bob's board as
      `myDiscard` - the `2` suffix is the far half from the reader's side, and
      `badges(bob).theirDiscard` is Alice's pile, which is exactly the reading that made
      this section look like a failure when the card had landed correctly.
   */
   check('and one card is left in the window for the drag', Boolean(dragCard), String(dragCard))

   const dragged = await dragBetween(
      alice,
      `[...document.querySelectorAll('.popup')].find((p) => /Look /.test(p.innerText))?.querySelector('img.card')?.parentElement`,
      `document.querySelector('.gameboard > .discard2 .pile') || document.querySelector('.gameboard > .discard2')`)

   /*
      What is asserted is the *gesture*: the drag starts, the zone highlights for it, and
      the request that follows is a discard out of the deck. The count is the selection -
      Ctrl+A picked the whole batch up above, and a drag carries the selection exactly as a
      menu entry does - so it is not a number to assert here.
   */
   const dragAction = await alice.evaluate(`globalThis.__pvp.lastAction().sentTo`)
   check('a card out of the look window can be dragged onto the other player\'s board',
      dragged.started && dragged.highlighted > 0 && dragAction?.action === 'discard' && dragAction?.from === 'deck',
      `${dragged.why}${dragged.card ? ` (carrying ${dragged.card})` : ''}, request ${JSON.stringify(dragAction)}`)

   /*
      **A window's card cannot be put on this player's own side, the table or the
      Stadium.**

      Every zone of the player's own half is tried, because the gesture had to be refused
      in all of them and the report was about the *drag* rather than about the move: the
      zones used to highlight under the pointer and then quietly leave the card where it
      was, which reads as a card that was placed and came back. What is asserted is
      therefore both halves - nothing highlighted, and nothing moved or sent.

      A fresh look is taken for each zone, and that is not tidiness: a batch is a live view
      of the deck, so once a card has been acted on it leaves the window and stops being
      actionable (`isActionable`) - a card already sent to the opponent's discard is not a
      card a target can refuse, and re-using it reports "the zone refused it" for "there
      was nothing left to drop".
   */
   async function lookAtThree () {
      await alice.rightClick(THEIR_DECK)
      await answerNextPrompt(alice, 3)
      await clickMenuItem(alice, 'View Top X')
      await sleep(1800)
   }

   const lookCardExpr = `[...document.querySelectorAll('.popup')].find((p) => /Look /.test(p.innerText))?.querySelector('img.card')?.parentElement`

   const ownZones = [
      [ 'own discard', '.gameboard > .discard .pile' ],
      [ 'own hand', '.gameboard > .hand .pile' ],
      [ 'own deck', '.gameboard > .deck .pile' ],
      [ 'own prizes', '.gameboard > .prizes .pile' ],
      [ 'own lost zone', '.gameboard > .lz .pile' ],
      [ 'own bench', '.gameboard > .bench .bench-zone' ],
      [ 'own active', '.gameboard > .active > .active1' ],
      [ 'the Stadium', '.gameboard > .stadium-area > .stadium' ],
      [ 'the Table', '.gameboard > .play' ]
   ]

   for (const [ name, sel ] of ownZones) {
      await lookAtThree()
      const before = await alice.evaluate(`JSON.stringify(globalThis.__pvp.lastAction())`)
      const out = await dragBetween(alice, lookCardExpr, `document.querySelector(${JSON.stringify(sel)})`)
      await sleep(600)
      const after = await alice.evaluate(`JSON.stringify(globalThis.__pvp.lastAction())`)

      check(`and a window's card cannot be dropped on ${name}`,
         out.started && out.highlighted === 0 && before === after,
         `${out.why}, ${out.highlighted} zone(s) highlighted, request ${before === after ? 'unchanged' : 'SENT: ' + after}`)
   }

   /*
      And the request is waited for on the owner's board before anything else is counted.

      A relayed request is answered a poll cycle or two later, so the card this drag sent is
      still in flight when this section ends. The next section counts the owner's deck
      before and after *its* move, and a card arriving from the drag in between made its
      discard look like it took two - which is a fault in the check, not in the discard:
      the deck is what it says it is once the drag's own answer has landed.
   */
   await waitForCount(bob, (p) => badges(p).then((b) => b.myDiscard), beforeDrag.myDiscard + 1)
   await sleep(500)

   const afterDrag = await badges(bob)
   check('and the drag sends a request rather than moving the player\'s own cards',
      afterDrag.theirDiscard === beforeDrag.theirDiscard,
      `alice's own discard ${beforeDrag.theirDiscard} -> ${afterDrag.theirDiscard}`)

   /*
      And nothing was sent: the other board's log has the shuffle a look can end
      with, and no line about a look having been taken. `canReveal` refuses a
      spectator before any of this, and a spectator gets no deck menu at all.
   */
   const bobLog = await bob.evaluate(`[...document.querySelectorAll('.chat p')].map((p) => p.innerText.trim())`)
   check('and the other player is not told the cards were seen',
      !bobLog.some((line) => /^Looked at the top/.test(line)),
      bobLog.filter((l) => /[Ll]ook/.test(l)).join(' | ') || 'no look line')

   /* ------------------------------- 3c. the top of the other player's deck, discarded -- */

   /*
      *Discard Top Card* and *Discard Top X* on the opponent's deck: one card, and a
      specified number of them, off the top and into the owner's discard.

      They are the one pair of entries with **no card behind them** - the top of a deck this
      player cannot read is not a card this board can name - so what travels is a count and
      the owner reads its own deck. Nothing is revealed by either: a discard is a face-up
      pile, so the *owner* sees what they lost, which is what a discard is.

      It runs here, at the end of the look section, because it is a deck gesture rather
      than a window one - and because the sections that follow need the look window's cards
      to still be in it.
   */
   console.log('\nthe top of their deck, discarded\n')
   /*
      Nothing is moved on the acting board for this pair, which is the one place in this
      module that is true - see the note over `discardTopOfTheirDeck`. So the *owner* is
      what these assertions are about, and the mirror is only asked to converge: it gets
      shorter when the owner's own event arrives, which is what a mirror is for.
   */
   const discardOnce = async (entry, asked = null) => {
      const before = {
         mirror: await alice.evaluate(`globalThis.__pvp.opponent.defaultOpponent.deck.get().length`),
         ownerDeck: await bob.evaluate(`globalThis.__pvp.player.deck.get().length`),
         ownerDiscard: await bob.evaluate(`globalThis.__pvp.player.discard.get().length`),
         actingDiscard: await alice.evaluate(`globalThis.__pvp.player.discard.get().length`)
      }

      await alice.rightClick(THEIR_DECK)
      if (asked !== null) await answerNextPrompt(alice, asked)
      const clickedAt = Date.now()
      const took = await clickMenuItem(alice, entry)

      const moved = asked ?? 1

      /* the owner answers with its own deck, so this is waited for rather than slept past */
      await waitForCount(bob, (p) => p.evaluate(`globalThis.__pvp.player.deck.get().length`), before.ownerDeck - moved)
      const ownerMs = Date.now() - clickedAt
      await waitForCount(bob, (p) => p.evaluate(`globalThis.__pvp.player.discard.get().length`), before.ownerDiscard + moved)
      /* and the mirror catches up from the owner's own event, so that is waited for too */
      const mirror = await waitForCount(alice, (p) => p.evaluate(`globalThis.__pvp.opponent.defaultOpponent.deck.get().length`), before.mirror - moved)
      const mirrorMs = Date.now() - clickedAt

      /*
         Reported rather than asserted, and that is deliberate: how long an observer waits
         is the relay's poll interval (`RELAY_POLL_INTERVAL_MS`, 2s by default and the knob
         the relay's own config says to turn), not something this feature can decide. The
         numbers are printed so a change to that interval shows up as a number rather than
         as an opinion.
      */
      console.log(`   ${entry}: owner ${ownerMs}ms, acting board's mirror ${mirrorMs}ms (the relay's poll interval bounds both)`)

      return {
         took,
         before,
         moved,
         mirror,
         ownerMs,
         mirrorMs,
         ownerDeck: await bob.evaluate(`globalThis.__pvp.player.deck.get().length`),
         ownerDiscard: await bob.evaluate(`globalThis.__pvp.player.discard.get().length`),
         actingDiscard: await alice.evaluate(`globalThis.__pvp.player.discard.get().length`)
      }
   }

   const one = await discardOnce('Discard Top Card')
   check('the opponent\'s deck menu can discard its top card', one.took)
   check('and the owner\'s deck is one card shorter',
      one.ownerDeck === one.before.ownerDeck - 1,
      `${one.before.ownerDeck} -> ${one.ownerDeck} in bob's deck`)
   check('and the card is in the OWNER\'s discard',
      one.ownerDiscard === one.before.ownerDiscard + 1,
      `bob's discard ${one.before.ownerDiscard} -> ${one.ownerDiscard}`)
   check('and not in the acting player\'s own discard',
      one.actingDiscard === one.before.actingDiscard,
      `alice's discard ${one.before.actingDiscard} -> ${one.actingDiscard}`)
   check('and the acting board\'s mirror of the deck followed it',
      one.mirror === one.ownerDeck,
      `alice sees ${one.mirror}, bob has ${one.ownerDeck}`)

   const many = await discardOnce('Discard Top X', 3)
   check('and Discard Top X asks how many and discards them', many.took)
   check('and the owner\'s deck is three cards shorter',
      many.ownerDeck === many.before.ownerDeck - 3,
      `${many.before.ownerDeck} -> ${many.ownerDeck} in bob's deck`)
   check('and all three are in the owner\'s discard',
      many.ownerDiscard === many.before.ownerDiscard + 3,
      `bob's discard ${many.before.ownerDiscard} -> ${many.ownerDiscard}`)
   check('and the acting board\'s mirror followed that too',
      many.mirror === many.ownerDeck,
      `alice sees ${many.mirror}, bob has ${many.ownerDeck}`)

   /*
      The request named no cards - that is the whole point of the pair - so the trace is
      what says the acting side sent a *count* rather than a guess at the top of a deck it
      cannot read. Read off the store's own trace, because nothing on screen distinguishes
      the two.
   */
   const topTrace = await alice.evaluate(`globalThis.__pvp.lastAction().sentTo`)
   check('and the request carried a count rather than a card',
      topTrace?.action === 'discardTop' && topTrace?.count === 3,
      JSON.stringify(topTrace))

   /* ---------------------------------------- 4. close and shuffle on both windows -- */

   console.log('\nclose and shuffle\n')

   /*
      The sections above spend the look's cards on purpose (a drag onto the other board),
      so the ending this section is about gets a look of its own. A Look's only button is
      *Close & Shuffle*, and both windows follow the batch rather than the grid: the ending
      has to be on screen whatever has happened to the cards.
   */
   await alice.rightClick(THEIR_DECK)
   await answerNextPrompt(alice, 2)
   await clickMenuItem(alice, 'View Top X')
   await waitForWindow(alice, 2, { kind: 'look' })

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
      This section reads the stores directly, so it needs the development handle and it
      is skipped on a deployment. That is not a gap in the check: `globalThis.__pvp` is
      set by `$lib/util/dev-debug.js`, which is behind `import.meta.env.DEV` on purpose -
      a debug handle onto the stores is the last thing a production bundle should carry
      - and sections 1 to 4 run fine against a deployment because they read the board
      through the DOM. Which is exactly how the strongest verification of this feature
      was done: the first four sections against the live URL, and this one locally.
   */
   const hasHandle = await alice.evaluate(`Boolean(globalThis.__pvp)`)
   if (!hasHandle) {
      console.log('  skip  the store-level shuffle rule - no development handle on this deployment')
      console.log('        (sections 1-4 above exercised the feature against it)')
      clearInterval(answering)
      browser.detach()
      console.log('')
      console.log(`verdict: ${failures} failed - the reveal and look flow ran against ${BASE}`)
      process.exit(failures ? 1 : 0)
   }

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
   const aliceSaw = await waitForWindow(alice, 3, { kind: 'reveal' })
   check('a fresh reveal is on the revealer\'s board', Boolean(aliceSaw), aliceSaw?.text || 'no window')

   /*
      The other board must show **all three**, and this is exact rather than tolerant.

      It was tolerant for a while, and that was the wrong call: the other board was
      coming up a card short, and the missing card was not a mirror that had not caught
      up yet. `applyReveal` kept only the ids it could find *at that instant*, so a
      batch that arrived before the board state was recorded as "the two of the three I
      happen to have" - permanently, because the healing poll then saw a complete batch
      and stopped looking. Fixing that (the record is now every id the event names) is
      what made this exact again, and it was found by refusing to relax the assertion
      any further: two boards disagreeing about what was revealed is exactly what this
      check exists for.
   */
   const bobSaw = await waitForWindow(bob, aliceSaw?.cards.length ?? 3, { kind: 'reveal' })
   check('a fresh reveal is on both boards again',
      Boolean(aliceSaw) && Boolean(bobSaw),
      `${aliceSaw?.cards.length} on the revealer's board, ${bobSaw?.cards.length} on the other`)
   check('and the other board shows the same cards in the same order',
      Boolean(bobSaw) && JSON.stringify(bobSaw.cards) === JSON.stringify(aliceSaw?.cards),
      `${bobSaw?.cards.length} vs ${aliceSaw?.cards.length} cards`)
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
console.log('verdict: ok - a reveal is on both players\' boards, a look is on the looker\'s and the watcher\'s, a window\'s card goes only to its owner\'s zones, and an action on the other player\'s card lands on their board')
