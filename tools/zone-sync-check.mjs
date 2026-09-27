/*
 * Does a card one player moves reach the *other* player's board?
 *
 *   node tools/zone-sync-check.mjs
 *
 * Needs a dev server on BASE (default http://localhost:3005) and two headless
 * browsers with CDP on CDP_PORTS (default 9222,9223) - see tools/dev-servers.ps1.
 *
 * Two boards, one room, and a move made on one of them read off the other: a card
 * goes to the table, to the discard, to the bench, onto the deck and into the
 * stadium, and each of those is asked of the far half's **mirror** as well as of
 * the DOM. The two answers are the point of the file:
 *
 *   the mirror   `window.__pvp.opponent.defaultOpponent.table.get()` - what this
 *                client actually holds, whether or not anything draws it
 *   the DOM      `.play2 img.card`, `.discard2 img.card` - what the player sees
 *
 * "does not update and show on the opponent's view" is one sentence for two
 * different faults, and a count read off the DOM cannot tell them apart: a mirror
 * that never received the event and a mirror that received it and did not draw it
 * are the same missing card. So every step below asserts both.
 *
 * The mirror is the far half of *both* pages: the top of alice's screen is bob's
 * board and the top of bob's screen is alice's, so each move is checked from the
 * side that did not make it.
 *
 * What is deliberately not here: the round trip's *latency*. The relay is polled,
 * so a move takes about two seconds to cross; every wait below is a wait for the
 * state rather than a sleep, with a timeout that fails the check rather than
 * hanging the run.
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [alice, bob] = await browser.pages(2)
await browser.setViewport(1277, 821)
for (const page of [alice, bob]) {
   page.autoDialogs(true)
   page.watchForErrors()
}
bob.socket.addEventListener('message', (event) => {
   let message
   try { message = JSON.parse(event.data) } catch { return }
   if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails
      console.error('[bob] page error', (d.exception?.description || d.text || '').slice(0, 300))
   }
})

/*
   "Still playing?" is the room's clock rather than this check's, and the windows are
   seconds long because the sections of `browser-check.mjs` need to reach them. This
   file reads the board and appends nothing for most of its run, so both players
   answer it, the way the panel section does.
*/
const answering = setInterval(() => {
   for (const page of [alice, bob]) {
      page.evaluate(`(() => { const go = document.querySelector('.idle-go'); if (go) go.click(); return true })()`).catch(() => {})
   }
}, 1000)

/*
   **The card images are answered here rather than fetched**, and this check needs
   that more than most: a stand-in deck's card names are ones no image host serves, so
   every card comes back broken - and a broken `<img>` with a width and no intrinsic
   size is a card with **no height**, which is a target no pointer can meet and a hit
   test that answers the wrong element. The first run of the double-click assertions
   below reported the far table's card as 88x0 px with `div.table-zone` on top, which
   is a true statement about a board with no pictures on it rather than about the
   board this is checking. `tools/zone-fit-check.mjs` answers them the same way, and
   its note is where the shape comes from.
*/
async function serveCardImages (page, label) {
   await page.go(BASE, 800)

   const STUB = await page.evaluate(`(() => {
      const c = document.createElement('canvas')
      c.width = 245; c.height = 338
      const g = c.getContext('2d')
      g.fillStyle = '#f2cf2e'; g.fillRect(0, 0, 245, 338)
      g.fillStyle = '#2f7d32'; g.fillRect(12, 12, 221, 314)
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(122, 150, 62, 0, 7); g.fill()
      g.fillStyle = '#111111'; g.font = 'bold 30px sans-serif'; g.fillText('CARD', 66, 300)
      return c.toDataURL('image/png').split(',')[1]
   })()`)

   await page.send('Fetch.disable').catch(() => { /* not on: nothing to turn off */ })
   await page.send('Fetch.enable', { patterns: [ { urlPattern: '*limitlesstcg*', requestStage: 'Request' } ] })

   /* queued rather than waited for one at a time: a board drawing several cards in
      one turn pauses several requests at once, and a request nobody is waiting for
      is dropped and starves that image for good (see tools/fan-check.mjs) */
   const paused = []
   const inner = page.handle.bind(page)
   page.handle = (raw) => {
      let message
      try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) } catch { return inner(raw) }
      if (message.method === 'Fetch.requestPaused') { paused.push(message.params); return }
      return inner(raw)
   }

   const serve = async () => {
      for (;;) {
         if (!paused.length) { await sleep(15); continue }
         const request = paused.shift()
         try {
            await page.send('Fetch.fulfillRequest', {
               requestId: request.requestId,
               responseCode: 200,
               responseHeaders: [
                  { name: 'content-type', value: 'image/png' },
                  { name: 'access-control-allow-origin', value: '*' }
               ],
               body: STUB
            })
         } catch { /* the page moved on */ }
      }
   }
   serve().catch((err) => console.error(`[${label}] image stub stopped`, err.message))
}

await Promise.all([ serveCardImages(alice, 'alice'), serveCardImages(bob, 'bob') ])

/* ------------------------------------------------------------ the pages --- */

async function lobby (page, label) {
   for (let attempt = 1; attempt <= 8; attempt++) {
      await page.reset(BASE)
      if ((await page.counts()).mode === 'lobby') return
      console.log(`  ${label}: not up yet, reloading`)
      await sleep(1500)
   }
   throw new Error(`${label} never reached the lobby`)
}

const q = (selector) => JSON.stringify(selector)

/*
   **Every pointer gesture here goes through the browser's own input pipeline**, and
   that is not thoroughness for its own sake: a `dispatchEvent(new MouseEvent(...))`
   *on the element* is delivered straight to that element, so it answers "does this
   handler work" and never "can the player reach it". Both halves of a shared cell
   fill the same rectangle, so a gesture meant for a card of theirs meets the player's
   own copy of the zone unless it is standing aside - and a check that dispatched on
   the element reported the double click as working while a real one landed on the
   other half's `.table-zone` and did nothing. `Input.dispatchMouseEvent` hit-tests the
   way a mouse does, and `onTop` below is the same answer read directly, so a check
   that names a card is also asserting that the pointer meets *that* card.
*/
const pointOf = (page, selector, nth = 0) => page.evaluate(`(() => {
   const el = document.querySelectorAll(${q(selector)})[${nth}]
   if (!el) return null
   const r = el.getBoundingClientRect()
   const x = Math.round(r.left + r.width / 2)
   const y = Math.round(r.top + r.height / 2)
   const top = document.elementFromPoint(x, y)
   return {
      x, y, w: Math.round(r.width), h: Math.round(r.height),
      top: top ? top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0] : null,
      onTop: top === el
   }
})()`)

async function realClick (page, selector, nth = 0, { clickCount = 1 } = {}) {
   const at = await pointOf(page, selector, nth)
   if (!at) return null

   for (let n = 1; n <= clickCount; n++) {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: n })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: n })
   }
   await sleep(400)
   return at
}

/* one click, and a double click, the way a player makes them */
const clickCard = (page, selector, nth = 0) => realClick(page, selector, nth).then(Boolean)
const doubleClickAt = (page, selector, nth = 0) => realClick(page, selector, nth, { clickCount: 2 })

/* a key with its `code`, which the board reads for the digits (see gotchas.md) */
const key = (page, k, code) => page.evaluate(`(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${q(k)}, code: ${q(code)}, bubbles: true, cancelable: true
   }))
   return true
})()`)

const KEY_CODES = { 1: 'Digit1', 2: 'Digit2' }

/* what a page draws and what its mirror holds, side by side */
const board = (page) => page.evaluate(`(() => {
   const n = (sel) => document.querySelectorAll(sel + ' img.card').length
   const top = (sel) => document.querySelector(sel + ' img.card')
   const badge = (sel) => {
      const el = document.querySelector(sel + ' .count')
      if (!el) return null
      const v = parseInt(el.textContent.trim(), 10)
      return Number.isInteger(v) ? v : null
   }
   const mirror = globalThis.__pvp?.opponent?.defaultOpponent
   const names = (pile) => (pile ? pile.get().map((c) => c.name) : null)
   return {
      dom: {
         ownHand: n('.hand'), farHand: n('.hand2'),
         ownTable: n('.play'), farTable: n('.play2'),
         ownDiscard: n('.discard'), farDiscard: n('.discard2'),
         ownBench: n('.bench'), farBench: n('.bench2'),
         ownDeck: n('.deck'), farDeck: n('.deck2'),
         ownDiscardCount: badge('.discard'), farDiscardCount: badge('.discard2'),
         ownTableTop: top('.play')?.alt || null, farTableTop: top('.play2')?.alt || null,
         ownDiscardTop: top('.discard')?.alt || null, farDiscardTop: top('.discard2')?.alt || null
      },
      mirror: mirror ? {
         hand: mirror.hand.get().length,
         table: mirror.table.get().length,
         discard: mirror.discard.get().length,
         bench: mirror.bench.get().length,
         deck: mirror.deck.get().length,
         stadium: mirror.stadium.get().length,
         tableNames: names(mirror.table),
         discardNames: names(mirror.discard)
      } : null,
      own: globalThis.__pvp ? {
         hand: globalThis.__pvp.player.hand.get().length,
         table: globalThis.__pvp.player.table.get().length,
         discard: globalThis.__pvp.player.discard.get().length,
         bench: globalThis.__pvp.player.bench.get().length
      } : null
   }
})()`)

/* the room's log, which is the record of what the relay actually carried */
const log = (page) => page.evaluate(`(() => {
   const el = document.querySelector('.chat')
   return el ? el.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

/* wait for something to come true, and say whether it did */
async function until (label, fn, { timeout = 15000, poll = 300 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      if (await fn()) return true
      if (Date.now() > deadline) return false
      await sleep(poll)
   }
}

/* -------------------------------------------------------------- the game --- */

console.log(`zone sync check against ${BASE}`)

await Promise.all([lobby(alice, 'alice'), lobby(bob, 'bob')])

const room = await alice.createRoom('Alice')
await bob.joinRoom(room, 'Bob')
console.log(`\na room (${room}): two players, both set up`)

await alice.importDeck()
await bob.importDeck()
await alice.setup()
await bob.setup()

const seated = await until('both hands dealt', async () => {
   const a = await board(alice)
   const b = await board(bob)
   return a.dom.ownHand === 7 && b.dom.farHand === 7
}, { timeout: 30000 })

check('both players have their seven cards', seated, JSON.stringify((await board(alice)).dom))
check('and each sees the other\'s seven, which is the mirror working at all',
   (await board(bob)).dom.farHand === 7, JSON.stringify((await board(bob)).dom))

/* --- 1. a draw, as the control: this move is known to cross --- */

await key(alice, '1', KEY_CODES[1])
const drew = await until('the draw crossed', async () => {
   const b = await board(bob)
   return b.dom.farHand === 8
})

check('alice drew a card', (await board(alice)).dom.ownHand === 8, JSON.stringify((await board(alice)).own))
check('and bob sees it in her hand', drew, JSON.stringify((await board(bob)).dom))

/* --- 2. the table --- */

/*
   The card is picked up out of alice's hand and put on the table with X, which is
   the board's own shortcut for it (`moveSelection(table)`).
 */
await clickCard(alice, '.hand img.card', 0)
await key(alice, 'x', 'KeyX')

const aliceTable = await until('the card landed on alice\'s table', async () => (await board(alice)).dom.ownTable === 1)
const bobTable = await until('the card reached bob\'s mirror of the table', async () => (await board(bob)).mirror?.table === 1)

const afterTable = await board(bob)
check('the card is on alice\'s own table', aliceTable, JSON.stringify((await board(alice)).dom))
check('bob\'s mirror holds it on her table', bobTable, JSON.stringify(afterTable.mirror))
check('and bob\'s board draws it there', afterTable.dom.farTable === 1, JSON.stringify(afterTable.dom))
check('and bob\'s log says it happened', /Moved .*to (the )?[Tt]able/.test(await log(bob)), (await log(bob)).slice(-160))

/* --- 3. the discard, from the table --- */

await clickCard(alice, '.play img.card', 0)
await key(alice, 'd', 'KeyD')

const bobDiscard = await until('the discard reached bob\'s mirror', async () => (await board(bob)).mirror?.discard === 1)
const afterDiscard = await board(bob)

check('the card left alice\'s table for her discard',
   (await board(alice)).dom.ownTable === 0 && (await board(alice)).dom.ownDiscard === 1,
   JSON.stringify((await board(alice)).dom))
check('bob\'s mirror holds it in her discard', bobDiscard, JSON.stringify(afterDiscard.mirror))
check('and bob\'s board draws it there', afterDiscard.dom.farDiscard === 1, JSON.stringify(afterDiscard.dom))
check('and the far discard counts it', afterDiscard.dom.farDiscardCount === 1, JSON.stringify(afterDiscard.dom))

/* --- 4. the bench, as the other control --- */

await key(alice, '1', KEY_CODES[1])
await until('the second draw crossed', async () => (await board(bob)).dom.farHand === 9)
await clickCard(alice, '.hand img.card', 0)
await key(alice, 'b', 'KeyB')

const bobBench = await until('the bench reached bob\'s mirror', async () => (await board(bob)).mirror?.bench === 1)
check('a benched Pokemon reaches bob\'s mirror', bobBench, JSON.stringify((await board(bob)).mirror))
check('and bob\'s board draws it on her bench', (await board(bob)).dom.farBench === 1, JSON.stringify((await board(bob)).dom))

/* --- 5. the same moves the other way, so it is not one board being deaf --- */

await key(bob, '1', KEY_CODES[1])
const bobDrew = await until('bob\'s draw crossed', async () => (await board(alice)).dom.farHand === 8)
check('bob\'s draw reaches alice\'s mirror', bobDrew, JSON.stringify((await board(alice)).mirror))

await clickCard(bob, '.hand img.card', 0)
await key(bob, 'x', 'KeyX')
const aliceSawTable = await until('bob\'s table move crossed', async () => (await board(alice)).mirror?.table === 1)
check('bob\'s card on the table reaches alice\'s mirror', aliceSawTable, JSON.stringify((await board(alice)).mirror))
check('and alice\'s board draws it on the far table', (await board(alice)).dom.farTable === 1, JSON.stringify((await board(alice)).dom))

/* --- 6. Show Details on a card of the other half's --- */

/*
   The details modal is `img.details` (CardDetails.svelte), and it is the same
   dialog the menu's Show Details opens. A double click is the gesture this asks
   about: a card on the far half's table and in the far half's Stadium is on show
   to this player, so both should open it - and a card in the far half's hand is
   drawn as a card back, so a double click there must open nothing at all.

   Two things are asserted for each card, and the first is the one that was missing:
   that the pointer **meets that card** (`onTop`), and that the double click opens it.
   The far half's table and the player's own are one cell with the player's own on top,
   so "the handler is wired" and "the player can reach it" are different questions, and
   only real input answers the second.
 */
const details = (page) => page.evaluate(`(() => {
   const img = document.querySelector('img.details')
   return img ? img.alt : null
})()`)

const closeDetails = async (page) => {
   await page.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
   await sleep(400)
}

/*
   The card the double click is about has to be **on the page looking at it**: the
   far half is the other player's board, so bob's card played to the table is on
   alice's screen (`.play2`) and not on bob's, where `.play2` is alice's table - and
   alice's last card there left for her discard three steps ago.
 */
/* which card is actually there, read off the board rather than assumed */
const farTableName = (await board(alice)).dom.farTableTop

const tablePoint = await doubleClickAt(alice, '.play2 img.card', 0)
check('the pointer meets the far half\'s table card rather than this half\'s table',
   tablePoint?.onTop === true, JSON.stringify(tablePoint))
const tableDetails = await details(alice)
check('a double click on the far table\'s card shows its details', Boolean(tableDetails), String(tableDetails))
check('and it is the card that is there', Boolean(farTableName) && tableDetails === farTableName, `${tableDetails} vs ${farTableName}`)
await closeDetails(alice)

/* and the far half's hand is a card back, which a double click must not read */
const handPoint = await doubleClickAt(alice, '.hand2 img.card', 0)
const handDetails = await details(alice)
check('and a double click on the far hand opens nothing', handDetails === null, `${handDetails} (${JSON.stringify(handPoint)})`)
await closeDetails(alice)

/* and the same for a Stadium: alice plays one, bob double clicks it */
await key(alice, '1', KEY_CODES[1])
await until('alice drew for the stadium', async () => (await board(alice)).dom.ownHand > 0)
await clickCard(alice, '.hand img.card', 0)
await key(alice, 'g', 'KeyG')
const stadiumUp = await until('the stadium reached bob', async () => (await board(bob)).mirror?.stadium === 1)

check('a stadium card reaches bob\'s mirror', stadiumUp, JSON.stringify((await board(bob)).mirror))
if (stadiumUp) {
   const stadiumPoint = await doubleClickAt(bob, '.stadium2 img.card', 0)
   check('the pointer meets the far Stadium\'s card', stadiumPoint?.onTop === true, JSON.stringify(stadiumPoint))
   const stadiumDetails = await details(bob)
   check('a double click on the far Stadium\'s card shows its details', Boolean(stadiumDetails), String(stadiumDetails))
   await closeDetails(bob)
} else {
   check('the pointer meets the far Stadium\'s card', false, 'no stadium card arrived to click')
   check('a double click on the far Stadium\'s card shows its details', false, 'no stadium card arrived to click')
}

/* --- the fold of it: what each board ended up holding --- */

console.log('\nwhat each board holds at the end')
for (const [label, page] of [['alice', alice], ['bob', bob]]) {
   const b = await board(page)
   const dialog = await page.dialog().catch(() => null)
   const mode = (await page.counts()).mode
   console.log(`  ${label}: ${mode} ${dialog ? `| ${dialog.kind}: ${dialog.text}` : ''}`)
   console.log(`    own ${JSON.stringify(b.own)} mirror ${JSON.stringify(b.mirror)}`)
}

clearInterval(answering)
await browser.detach()

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`)
process.exit(failures ? 1 : 0)
