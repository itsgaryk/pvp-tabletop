/*
   Does a zone hold what is put in it, and does what sits on a card scale with the card?

   Two reports, one subject - something drawn at a size its box did not give it:

     * **the table's stack.** A board with a dozen cards on it drew the cascade straight
       through the zone's border and over the rows around it. The table is the one zone
       whose cards keep their own size rather than the zone's (see docs/card-sizing.md),
       so the stack has to be *scrolled* by the zone instead of being sized by it - and
       the zone it shares with the other half is a fixed cell in the grid.
     * **the damage counter.** Its circle was a share of the card (`--slot-width / 2.5`)
       while the digits in it were the page's own font size, in a box that also carried a
       `1rem` padding: on a small card the circle shrank, the number did not, and it stood
       out of the circle on every side.

   What is asserted, on a real board in a real browser:

     1. the table's zone is the table's cell, and it clips: nothing of the stack is drawn
        outside the zone's own box
     2. a stack taller than the cell scrolls, and both ends of it are reachable - the
        first card at the top, the last one at the bottom
     3. a stack that fits does not scroll, and is still centred in the cell, which is how
        the table has always been drawn
     4. the damage counter's box *and* its digit are shares of the card under them, in
        both zones that hold a Pokemon - the same ratios at two window sizes
     5. and the digit fits inside the circle at the smaller one

   Needs what the other browser checks need: a dev server on BASE (default
   http://localhost:3005) with a stand-in deck API behind it (tools/fake-deck-api.mjs,
   see tools/dev-servers.ps1), and a headless browser with CDP on CDP_PORTS (9222).

      node tools/zone-fit-check.mjs
      node tools/zone-fit-check.mjs --quiet
*/
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [page] = await browser.pages(1)
await browser.setViewport(1277, 821)
page.watchForErrors('zone')

const q = (s) => JSON.stringify(s)
const count = (selector) => page.evaluate(`document.querySelectorAll(${q(selector)}).length`)

/*
   The card images, answered here rather than fetched: a stand-in deck's card names are
   ones no image host serves, so they come back broken - and a card with no picture has no
   height, which is a table of cards 24px tall and a stack that never reaches the bottom
   of its cell. That is a different board from the one this is about, and it is how the
   first run of this check "passed" a stack that did not scroll.

   The paused requests are queued rather than waited for one at a time: a board that draws
   several cards in one turn pauses several requests at once, and the ones with nobody
   waiting for them are dropped, which starves an image for good (see tools/fan-check.mjs).
*/
await page.go(BASE, 500)

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

const paused = []
const pageHandle = page.handle.bind(page)
page.handle = (raw) => {
   let message
   try { message = JSON.parse(typeof raw === 'string' ? raw : String(raw)) } catch { return pageHandle(raw) }
   if (message.method === 'Fetch.requestPaused') { paused.push(message.params); return }
   return pageHandle(raw)
}

let serving = true
const serve = async () => {
   while (serving) {
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
serve()

/* the app's own menus are DOM, but `Set Damage` asks with a native prompt */
let asked = []
const answerPrompts = async (value) => {
   let next = page.waitFor('Page.javascriptDialogOpening')
   for (;;) {
      const params = await next
      /* the next waiter is registered before this one is answered: a page blocked on a
         prompt nobody is waiting for never runs another line of script */
      next = page.waitFor('Page.javascriptDialogOpening')
      asked.push(params.message)
      try {
         await page.send('Page.handleJavaScriptDialog', { accept: true, promptText: String(value) })
      } catch { /* gone */ }
   }
}
answerPrompts(320)

/* a click on a card, Ctrl held, which is how a selection picks up more than one */
const ctrlClick = (selector, index = 0) => page.evaluate(`(() => {
   const el = document.querySelectorAll(${q(selector)})[${index}]
   if (!el) return false
   const r = el.getBoundingClientRect()
   el.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window, ctrlKey: true,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2)
   }))
   return true
})()`)

const fire = (selector, kind) => page.evaluate(`(() => {
   const el = document.querySelector(${q(selector)})
   if (!el) return false
   const r = el.getBoundingClientRect()
   el.dispatchEvent(new MouseEvent(${q(kind)}, {
      bubbles: true, cancelable: true, view: window,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2)
   }))
   return true
})()`)

/*
   A key press, `code` included: the board reads the digit keys out of `e.code` to know
   how many cards to draw, so a synthetic event without one throws inside the handler and
   the key silently does nothing at all.
*/
const press = (key) => {
   const code = /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`
   return page.evaluate(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ${q(key)}, code: ${q(code)}, bubbles: true, cancelable: true }))
      return true
   })()`)
}

const menuText = () => page.evaluate(`(() => {
   const menu = document.querySelector('body > div.z-25')
   return menu ? menu.innerText.replace(/\\s+/g, ' ').trim() : null
})()`)

const clickMenu = async (label) => {
   const hit = await page.evaluate(`(() => {
      const items = [ ...document.querySelectorAll('body > div.z-25 .item') ]
      const item = items.find((i) => i.innerText.trim().startsWith(${q(label)}))
      if (!item) return false
      item.click()
      return true
   })()`)
   await sleep(400)
   return hit
}

const closeMenus = () => page.evaluate(`(() => {
   document.body.click()
   return true
})()`)

const q_ = q

/* what the table looks like: its cell, the scrolling zone inside it, and the cards */
const TABLE = `(() => {
   const rect = (el) => el ? (() => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), right: +b.right.toFixed(1) } })() : null
   const cell = document.querySelector('.play')
   const zone = cell ? cell.querySelector('.vertical') : null
   const cards = cell ? [ ...cell.querySelectorAll('.table-card') ] : []
   const stack = cell ? cell.querySelector('.table-zone > div') : null
   return {
      cell: rect(cell),
      zone: rect(zone),
      zoneClientWidth: zone ? zone.clientWidth : null,
      zoneClientHeight: zone ? zone.clientHeight : null,
      /* a bar is drawn as a thing with a thickness: 0 with none, its width with one */
      bar: zone ? zone.offsetWidth - zone.clientWidth : null,
      hbar: zone ? zone.offsetHeight - zone.clientHeight : null,
      overflowY: zone ? getComputedStyle(zone).overflowY : null,
      scrollTop: zone ? zone.scrollTop : null,
      scrollHeight: zone ? zone.scrollHeight : null,
      clientHeight: zone ? zone.clientHeight : null,
      cards: cards.map((c) => ({ name: c.alt, ...rect(c) })),
      stack: rect(stack)
   }
})()`

/* what a Pokemon's damage counter looks like against the card it sits on */
const counterOf = (slotSelector) => `(() => {
   const slot = document.querySelector(${q_(slotSelector)})
   if (!slot) return null
   const card = slot.querySelector('img.pokemon')
   const counter = slot.querySelector('.counter')
   if (!card || !counter) return null
   const box = (el) => { const b = el.getBoundingClientRect(); return { w: +b.width.toFixed(2), h: +b.height.toFixed(2), x: +b.x.toFixed(1), right: +b.right.toFixed(1), y: +b.y.toFixed(1), bottom: +b.bottom.toFixed(1) } }
   const cs = getComputedStyle(counter)
   return {
      card: box(card),
      counter: box(counter),
      fontSize: parseFloat(cs.fontSize),
      padding: cs.paddingTop,
      overflowX: counter.scrollWidth - counter.clientWidth,
      overflowY: counter.scrollHeight - counter.clientHeight,
      text: counter.innerText.trim()
   }
})()`

/* --------------------------------------------------------------- the board --- */

console.log(`zone fit check against ${BASE}`)

await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
await page.clickText('Edit Deck', { settle: 900 })
await page.clickText('Import Random Deck', { settle: 2500 })
await sleep(400)
await page.clickText('Edit Deck 2', { settle: 900 })
await page.clickText('Import Random Deck', { settle: 2500 })
await sleep(400)
await page.clickText('Setup', { settle: 3000 })

if ((await page.counts()).mode !== 'solo') {
   console.log('  FAIL  the board did not come up in solo - is a deck stand-in behind the dev server?')
   process.exit(1)
}

/* a Pokemon in the Active spot, and one on the Bench: the counter is checked in both */
const placed = await page.evaluate(`(() => {
   const imgs = [ ...document.querySelectorAll('.hand img.card') ]
   if (imgs.length < 2) return 0
   imgs[0].click()
   return 1
})()`)
if (!placed) {
   console.log('  FAIL  no cards in hand to put in play - is a deck stand-in behind the dev server?')
   process.exit(1)
}
await press('a')
await sleep(600)
await page.evaluate(`(() => { const i = document.querySelector('.hand img.card'); if (i) i.click(); return true })()`)
await press('b')
await sleep(600)

/* damage on each of them, through the app's own menu and its own prompt */
for (const slot of [ '.active1 .slot', '.bench .slot' ]) {
   asked = []
   await fire(`${slot} img.pokemon`, 'contextmenu')
   const menu = await menuText()
   if (!menu || !/Set Damage/.test(menu)) {
      check(`right clicking the Pokemon in ${slot} opens its menu`, false, String(menu).slice(0, 60))
      await closeMenus()
      continue
   }
   await clickMenu('Set Damage')
   await closeMenus()
   await sleep(300)
}

const hasCounters = (await count('.active1 .counter')) === 1 && (await count('.bench .counter')) === 1
check('both Pokemon show a damage counter', hasCounters,
   `active ${await count('.active1 .counter')}, bench ${await count('.bench .counter')}`)

/* ---------------------------------------------------------- 4 and 5. counter --- */

/*
   The counter, in both zones, at two sizes of card. The ratios are the assertion: a
   number that is the page's font size rather than a share of the circle keeps its
   pixels while the circle shrinks, so its ratio moves - and at the smaller card it
   also stops fitting, which is the second measurement.
*/
const measureCounters = async (label) => {
   const active = await page.evaluate(counterOf('.active1 .slot'))
   const bench = await page.evaluate(counterOf('.bench .slot'))
   console.log(`\n${label}: card ${active?.card.w}px wide (active), ${bench?.card.w}px (bench)`)
   for (const [ zone, m ] of [ [ 'active', active ], [ 'bench', bench ] ]) {
      if (!m) { check(`${zone}: there is a counter to measure`, false); continue }
      console.log(`  ${zone.padEnd(6)} counter ${m.counter.w}x${m.counter.h}px, digit '${m.text}' at ${m.fontSize}px (padding ${m.padding})`)
   }
   return { active, bench }
}

const big = await measureCounters('at 1277x821')

await page.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false })
await sleep(700)
const small = await measureCounters('at 900x620')

for (const zone of [ 'active', 'bench' ]) {
   const a = big[zone]
   const b = small[zone]
   if (!a || !b) { check(`${zone}: the counter was measured at both sizes`, false); continue }

   const boxRatio = (m) => m.counter.w / m.card.w
   const fontRatio = (m) => m.fontSize / m.card.w

   check(`${zone}: the card really did shrink between the two windows`,
      b.card.w < a.card.w - 5, `${a.card.w}px -> ${b.card.w}px`)

   check(`${zone}: the counter's circle is a share of the card, not a size`,
      Math.abs(boxRatio(a) - boxRatio(b)) < 0.01,
      `${boxRatio(a).toFixed(3)} at ${a.card.w}px against ${boxRatio(b).toFixed(3)} at ${b.card.w}px`)

   check(`${zone}: and so is the digit in it`,
      Math.abs(fontRatio(a) - fontRatio(b)) < 0.01,
      `${fontRatio(a).toFixed(3)} at ${a.card.w}px against ${fontRatio(b).toFixed(3)} at ${b.card.w}px`)

   check(`${zone}: the digit fits inside the circle at the small card`,
      b.overflowX <= 1 && b.overflowY <= 1,
      `'${b.text}' overflows ${b.overflowX}x${b.overflowY}px of a ${b.counter.w}x${b.counter.h}px circle`)

   check(`${zone}: and the counter is drawn on the card`,
      b.counter.x >= b.card.x - 1 && b.counter.right <= b.card.right + 1 &&
      b.counter.y >= b.card.y - 1 && b.counter.bottom <= b.card.bottom + 1,
      JSON.stringify({ card: b.card, counter: b.counter }))
}

await page.send('Emulation.setDeviceMetricsOverride', { width: 1277, height: 821, deviceScaleFactor: 1, mobile: false })
await sleep(600)

/* -------------------------------------------------------------- 1 to 3. table --- */

/* a stack that fits first: two cards, which the table's cell can hold entire */
const moveToTable = async (n) => {
   for (let i = 0; i < n; i++) { await press('1'); await sleep(120) }   // draw, so the hand can spare them
   const hand = await count('.hand img.card')
   for (let c = 0; c < Math.min(n, hand); c++) await ctrlClick('.hand img.card', c)
   await press('x')                                                     // the selection to the table
   await sleep(400)
}

await moveToTable(2)
let t = await page.evaluate(TABLE)
check('cards reached the table', t.cards.length >= 2, `${t.cards.length} cards`)
check('the table is scrolled by its own zone, which is the cell',
   t.overflowY === 'auto' || t.overflowY === 'scroll',
   `overflow-y: ${t.overflowY}`)
check('and that zone is the cell\'s own box, less the pile\'s own padding',
   t.zone && t.zone.x >= t.cell.x - 1 && t.zone.right <= t.cell.right + 1 &&
   t.zone.y >= t.cell.y - 1 && t.zone.bottom <= t.cell.bottom + 1 &&
   t.zone.h >= t.cell.h - 2 * 4 - 2 && t.zone.w >= t.cell.w - 2 * 4 - 2,
   JSON.stringify({ zone: t.zone, cell: t.cell }))

const shortFits = t.scrollHeight <= t.clientHeight + 1
check('a stack that fits the cell does not scroll', shortFits,
   `content ${t.scrollHeight}px in ${t.clientHeight}px`)
check('and no bar is drawn for it', t.bar === 0, `the bar is ${t.bar}px wide`)

/*
   The cascade's own centre, not the stack box's: what the zone centres is the box the
   markup reserves for the whole cascade (`margin-bottom`), and the stack element itself
   is only as tall as its first card.
*/
const cascadeCentre = t.cards.length
   ? (Math.min(...t.cards.map((c) => c.y)) + Math.max(...t.cards.map((c) => c.bottom))) / 2
   : null
check('and is centred in the zone, as the table always was',
   cascadeCentre !== null && Math.abs(cascadeCentre - (t.zone.y + t.zone.h / 2)) < 2,
   `cascade centre ${cascadeCentre}, zone centre ${(t.zone.y + t.zone.h / 2).toFixed(1)}`)

/* and now a stack taller than the cell */
for (let round = 0; round < 5 && (await count('.play .table-card')) < 13; round++) {
   await moveToTable(6)
   console.log(`  (${await count('.play .table-card')} cards on the table)`)
}
t = await page.evaluate(TABLE)
console.log(`\na stack of ${t.cards.length}: content ${t.scrollHeight}px in a cell of ${t.clientHeight}px, bar ${t.bar}px`)

check('a stack taller than the cell scrolls', t.scrollHeight > t.clientHeight + 1,
   `content ${t.scrollHeight}px in ${t.clientHeight}px`)

/*
   And the bar it scrolls with is *drawn*: a styled scroll bar takes its own width out of
   the box (a classic bar, always visible while the zone can scroll), where the overlay
   kind a platform may hand out instead costs nothing and hides itself again the moment
   the pointer leaves. This is the difference a player sees as "there was no bar".
*/
check('and the bar it scrolls with is drawn rather than floating',
   t.bar >= 6, `the bar is ${t.bar}px wide`)

/* the cards are the zone's width, and the cascade is inside the room the zone has */
const cascade = t.cards.length
   ? { left: Math.min(...t.cards.map((c) => c.x)), right: Math.max(...t.cards.map((c) => c.right)) }
   : null
const cardRatio = t.cards.length ? t.cards[0].w / t.cell.w : null
console.log(`  a card is ${t.cards[0]?.w}px of a ${t.cell.w}px cell; the cascade is ${cascade ? (cascade.right - cascade.left).toFixed(1) : '?'}px of the ${t.zoneClientWidth}px the zone has`)

check('the cards are sized by the zone\'s width rather than by a size of their own',
   cardRatio !== null && cardRatio > 0.6 && cardRatio < 0.95,
   `a card is ${(cardRatio * 100).toFixed(0)}% of the cell`)

check('and the whole cascade fits the room the zone has, so no card is cropped',
   cascade !== null && (cascade.right - cascade.left) <= t.zoneClientWidth + 0.5,
   `${cascade ? (cascade.right - cascade.left).toFixed(1) : '?'}px of ${t.zoneClientWidth}px`)

check('so the other axis has no bar either', t.hbar === 0, `a bar ${t.hbar}px tall`)

/*
   Nothing of the stack is drawn outside the zone, asked of the browser's own hit testing
   at all four borders: the cards are sized to fit the zone's width (`--table-card-width`),
   so nothing reaches past an edge at all, and a card the hit test finds outside would be a
   card drawn over its neighbours.
*/
const leaking = await page.evaluate(`(() => {
   const cell = document.querySelector('.play').getBoundingClientRect()
   const x = Math.round(cell.left + cell.width / 2)
   const y = Math.round(cell.top + cell.height / 2)
   const points = [
      [ x, Math.round(cell.top) - 6 ], [ x, Math.round(cell.bottom) + 6 ],
      [ Math.round(cell.left) - 6, y ], [ Math.round(cell.right) + 6, y ]
   ]
   const out = []
   for (const [ px, py ] of points) {
      const el = document.elementFromPoint(px, py)
      if (el && el.classList.contains('table-card')) out.push(px + ',' + py)
   }
   return out
})()`)
check('nothing of the stack is drawn over the zone\'s border', leaking.length === 0,
   leaking.length ? `a table card is the topmost element at ${leaking.join(' ')}` : '')

/* the top of the stack, and then the bottom of it, both inside the cell */
const inColumn = (card, cell) => card.y >= cell.y - 1 && card.bottom <= cell.bottom + 1
check('the first card of the stack is inside the cell', t.cards.length ? inColumn(t.cards[0], t.cell) : false,
   JSON.stringify({ card: t.cards[0], cell: t.cell }))

const scrolled = await page.evaluate(`(() => {
   const zone = document.querySelector('.play .vertical')
   zone.scrollTop = zone.scrollHeight
   return { scrollTop: zone.scrollTop, max: zone.scrollHeight - zone.clientHeight }
})()`)
await sleep(200)
t = await page.evaluate(TABLE)

check('the bottom of the stack is reachable, not cut off above the start edge',
   scrolled.scrollTop >= scrolled.max - 1,
   `scrolled to ${scrolled.scrollTop} of ${scrolled.max}`)

const last = t.cards[t.cards.length - 1]
check('and the last card of the stack is inside the cell when it is scrolled to',
   last ? inColumn(last, t.cell) : false, JSON.stringify({ card: last, cell: t.cell }))

/*
   The same stack at a tall board, which is the shape this was reported from: the cell is a
   different box at every window, and everything above is arithmetic about that box, so the
   promises are worth asking twice.
*/
await page.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1300, deviceScaleFactor: 1, mobile: false })
await sleep(800)
t = await page.evaluate(TABLE)

const tall = t.cards.length
   ? { left: Math.min(...t.cards.map((c) => c.x)), right: Math.max(...t.cards.map((c) => c.right)) }
   : null
const tallWidth = tall ? tall.right - tall.left : 0
console.log(`\nat 1000x1300: a card is ${t.cards[0]?.w}px of a ${t.cell.w}px cell, the cascade ${tallWidth.toFixed(1)}px of the ${t.zoneClientWidth}px the zone has, bar ${t.bar}px`)

const leaksTall = await page.evaluate(`(() => {
   const cell = document.querySelector('.play').getBoundingClientRect()
   const x = Math.round(cell.left + cell.width / 2)
   const y = Math.round(cell.top + cell.height / 2)
   const points = [
      [ x, Math.round(cell.top) - 6 ], [ x, Math.round(cell.bottom) + 6 ],
      [ Math.round(cell.left) - 6, y ], [ Math.round(cell.right) + 6, y ]
   ]
   const out = []
   for (const [ px, py ] of points) {
      const el = document.elementFromPoint(px, py)
      if (el && el.classList.contains('table-card')) out.push(px + ',' + py)
   }
   return out
})()`)
check('at a tall board: nothing of the stack is drawn over the zone\'s border', leaksTall.length === 0,
   leaksTall.length ? `a table card is the topmost element at ${leaksTall.join(' ')}` : '')

check('at a tall board: the cascade is inside the room the zone has, so no card is cropped',
   tall !== null && tallWidth <= t.zoneClientWidth + 0.5,
   `${tallWidth.toFixed(1)}px of ${t.zoneClientWidth}px`)

check('at a tall board: the cards are sized by the zone\'s width',
   t.cards.length ? t.cards[0].w / t.cell.w > 0.6 && t.cards[0].w / t.cell.w < 0.95 : false,
   `a card is ${((t.cards[0]?.w ?? 0) / t.cell.w * 100).toFixed(0)}% of the cell`)

check('at a tall board: no bar on the other axis', t.hbar === 0, `a bar ${t.hbar}px tall`)

await page.evaluate(`(() => { const z = document.querySelector('.play .vertical'); z.scrollTop = z.scrollHeight; return true })()`)
await sleep(250)
const tallBottom = await page.evaluate(TABLE)
check('at a tall board: the last card is inside the zone at the bottom of the stack',
   tallBottom.cards.length ? inColumn(tallBottom.cards[tallBottom.cards.length - 1], tallBottom.cell) : false,
   JSON.stringify({ card: tallBottom.cards[tallBottom.cards.length - 1], cell: tallBottom.cell }))

await page.send('Emulation.setDeviceMetricsOverride', { width: 1277, height: 821, deviceScaleFactor: 1, mobile: false })
await sleep(400)

serving = false

/*
   And out: the check's own browser sockets are closed, but the page leaves a paused
   dialog waiter and a `Fetch` handler behind, and node will sit on those rather than
   exiting. The verdict is printed first, and flushed, so nothing is lost by leaving.
*/
browser.detach()
await sleep(100)
console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - a zone is not holding what is in it`)
   process.exit(1)
}
console.log('verdict: ok - the table scrolls inside its cell, and the markers scale with the card')
process.exit(0)
