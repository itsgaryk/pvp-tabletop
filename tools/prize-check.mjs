/*
 * The prizes, from the player's side: does a left click select one, does it glow
 * the way a selected card in the hand glows, can the cascade hide that glow, and
 * does looking at a face-down prize write the one line the game log keeps for it?
 *
 *   node tools/prize-check.mjs
 *
 * Needs a dev server on BASE (default http://localhost:3005) and a headless
 * browser with CDP on CDP_PORTS (default 9222) - see tools/solo-check.mjs for the
 * launch line.
 *
 * Solo is enough for all of it. The half it plays from the bottom of the screen is
 * the same `board/Prizes.svelte` and `board/Card.svelte` a player gets in a room -
 * solo changes which *components* the far half uses, not those - and the far half's
 * own prizes are the case a room cannot have at all, since there they belong to
 * somebody else.
 *
 * The deck's own version of the same log rule - the key that reads a whole hidden
 * pile - is `tools/view-log-check.mjs`.
 *
 * The board is built without Setup: the deck-API stand-in's random deck carries no
 * `stage`, so `deckValid` is false and the Setup button is disabled (see
 * docs/gotchas.md). Prizes are dealt the other way the board offers - six top cards
 * of the deck sent to the prizes - which is the same pile either way.
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [page] = await browser.pages(1)
await browser.setViewport(1277, 821)
page.autoDialogs(true)
page.watchForErrors('prize')

const q = (selector) => JSON.stringify(selector)
const count = (selector) => page.evaluate(`document.querySelectorAll(${q(selector)}).length`)

/* a synthetic event at a place, which is what the handlers read their x/y from */
const fire = (selector, kind, index = 0) => page.evaluate(`(() => {
   const el = document.querySelectorAll(${q(selector)})[${index}]
   if (!el) return false
   const r = el.getBoundingClientRect()
   el.dispatchEvent(new MouseEvent(${q(kind)}, {
      bubbles: true, cancelable: true, view: window,
      clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2)
   }))
   return true
})()`)

const press = (key) => page.evaluate(`(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', { key: ${q(key)}, bubbles: true, cancelable: true }))
   return true
})()`)

/* a real click, through the browser's own hit testing: what is under the point is
   what gets it, which is the whole question for a stacked zone */
async function realClick (selector, index = 0) {
   const box = await page.evaluate(`(() => {
      const el = document.querySelectorAll(${q(selector)})[${index}]
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
   })()`)
   if (!box) return false

   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' })
   await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
   await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
   await sleep(250)
   return true
}

const menuText = () => page.evaluate(`(() => {
   const menu = document.querySelector('body > div.z-25')
   return menu ? menu.innerText.replace(/\\s+/g, ' ').trim() : null
})()`)

/* a menu entry, matched from the start because its shortcut letter is appended */
const clickMenu = async (label, { settle = 350 } = {}) => {
   const hit = await page.evaluate(`(() => {
      const items = [ ...document.querySelectorAll('body > div.z-25 .item') ]
      const el = items.find((item) => item.textContent.trim().startsWith(${q(label)}))
      if (!el) return false
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
   })()`)
   await sleep(settle)
   return hit
}

/* close whatever menu is up the way a player does, which also clears the selection */
const closeMenus = async () => {
   await page.evaluate(`(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
   await sleep(200)
}

/*
   One card of a prizes zone: where it is, how big it is, and what a selection of it
   looks like. The two things the glow can be are read off the element that carries
   the selection class - `border` for a card in the hand, `outline` for a prize.
*/
const cardLook = (zone, index = 0) => page.evaluate(`(() => {
   const root = document.querySelector(${q(zone)})
   if (!root) return null
   const el = [ ...root.querySelectorAll('.prize > div') ][${index}]
   if (!el) return null
   const box = el.closest('.prize')
   const r = el.getBoundingClientRect()
   const img = el.querySelector('img')
   const ir = img ? img.getBoundingClientRect() : null
   const st = getComputedStyle(el)
   const bs = getComputedStyle(box)
   return {
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      imgRect: ir ? [Math.round(ir.left), Math.round(ir.top), Math.round(ir.width), Math.round(ir.height)] : null,
      border: st.borderTopWidth + ' ' + st.borderTopStyle + ' ' + st.borderTopColor,
      outline: st.outlineWidth + ' ' + st.outlineStyle + ' ' + st.outlineColor,
      selected: el.classList.contains('selected'),
      prizeSelected: box.classList.contains('selected'),
      prizeZ: bs.zIndex,
      boxSizing: st.boxSizing
   }
})()`)

/* what the hit test says is drawn on top at a point inside a selected prize */
const topAtBottomOfSelected = (zone) => page.evaluate(`(() => {
   const root = document.querySelector(${q(zone)})
   const el = root && root.querySelector('.prize.selected > div')
   if (!el) return null
   const r = el.getBoundingClientRect()
   const stack = document.elementsFromPoint(Math.round(r.left + r.width / 2), Math.round(r.bottom - 2))
   return stack.slice(0, 4).map((n) => {
      const prize = n.closest ? n.closest('.prize') : null
      return { tag: n.tagName, selected: Boolean(prize && prize.classList.contains('selected')) }
   })
})()`)

/* the six (or more) top cards of a deck sent to that half's prizes */
async function dealPrizes (deckSelector, n = 6) {
   for (let i = 0; i < n; i++) {
      await fire(`${deckSelector} .count`, 'contextmenu')
      await clickMenu('Prize Top Card')
      await closeMenus()
   }
}

/* the far half's prizes, which in solo are filled from its own hand */
async function dealFarPrizes (n = 6) {
   await fire('.deck2 .count', 'contextmenu')
   await clickMenu('Draw 7')
   await closeMenus()
   for (let i = 0; i < n; i++) {
      await fire('.hand2 img.card', 'contextmenu')
      await clickMenu('To Prizes')
      await closeMenus()
   }
}

/* the game log, one entry per line, with whose it is */
const logLines = () => page.evaluate(`[ ...document.querySelectorAll('.solo-log p') ].map((p) => ({
   who: (p.querySelector('.who') || {}).textContent || '',
   text: p.innerText.replace(/\\s+/g, ' ').trim()
}))`)

const linesMatching = async (re) => (await logLines()).filter((l) => re.test(l.text)).length
const prizeViews = () => linesMatching(/Viewed prize card/)
const deckViews = () => linesMatching(/Viewed deck/)

const detailsOpen = () => page.evaluate(`Boolean(document.querySelector('div.z-30'))`)
const closeDetails = async () => {
   if (await detailsOpen()) {
      await press(' ')
      await sleep(250)
   }
}

console.log(`prize check against ${BASE}`)
await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
await page.importDeck('Edit Deck')
await page.importDeck('Edit Deck 2')

/* ------------------------------------------- 1. what a selection looks like --- */

console.log('\nwhat a selected card looks like, in the hand')

await fire('.deck .count', 'contextmenu')
await clickMenu('Draw')
await closeMenus()
await fire('.deck .count', 'contextmenu')
await clickMenu('Draw')
await closeMenus()

await fire('.hand img.card', 'click')
const handSelected = await page.evaluate(`(() => {
   const el = document.querySelector('.hand .selected')
   if (!el) return null
   const st = getComputedStyle(el)
   return { border: st.borderTopWidth + ' ' + st.borderTopStyle + ' ' + st.borderTopColor }
})()`)

check('a click selects a card in the hand', Boolean(handSelected), JSON.stringify(handSelected))
check('and it glows with a 2px solid border in the selection colour',
   /^2px solid rgb/.test(String(handSelected && handSelected.border)), String(handSelected && handSelected.border))

/* the hand's glow, which a selected prize has to match, as one comparable string */
const handGlow = String(handSelected && handSelected.border)
await press('Escape')
await sleep(200)

/* ------------------------------------------------ 2. the player's own prizes --- */

console.log('\nthe player\'s own prizes')

await dealPrizes('.deck')
const ownPrizes = await count('.gameboard > .prizes .prize > div')
check('the player\'s prizes are dealt, six of them', ownPrizes === 6, `${ownPrizes} prizes`)

const before = await cardLook('.gameboard > .prizes', 0)

await realClick('.gameboard > .prizes img.card', 0)
const clicked = await cardLook('.gameboard > .prizes', 0)

check('a real left click selects the prize under the pointer', clicked?.selected === true,
   `selected=${clicked && clicked.selected}`)
check('the prize\'s own box carries the selection, so it can be lifted over its neighbours',
   clicked?.prizeSelected === true, `prize selected=${clicked && clicked.prizeSelected}`)
check('and it glows with the same ring a card in the hand glows with',
   clicked?.outline === handGlow,
   `prize outline "${clicked && clicked.outline}" against the hand's border "${handGlow}"`)
check('the glow costs no room: the card and its image stay exactly where they were',
   JSON.stringify(clicked?.rect) === JSON.stringify(before?.rect) &&
   JSON.stringify(clicked?.imgRect) === JSON.stringify(before?.imgRect),
   `card ${JSON.stringify(before?.rect)} -> ${JSON.stringify(clicked?.rect)}, image ${JSON.stringify(before?.imgRect)} -> ${JSON.stringify(clicked?.imgRect)}`)

/* ------------------------------------------- 3. the cascade cannot hide it --- */

console.log('\nthe cascade')

await dealPrizes('.deck', 2)
const cascading = await count('.gameboard > .prizes .prize > div')
check('past six prizes the rows overlap', cascading === 8, `${cascading} prizes`)

await closeMenus()
await realClick('.gameboard > .prizes img.card', 0)
const stack = await topAtBottomOfSelected('.gameboard > .prizes')
const overlapping = await page.evaluate(`(() => {
   const boxes = [ ...document.querySelectorAll('.gameboard > .prizes .prize') ].map((b) => b.getBoundingClientRect())
   return boxes.length > 2 && boxes[2].top < boxes[0].bottom
})()`)

check('the second row really is drawn over the first', overlapping === true, `row 2 starts before row 1 ends`)
check('and the selected prize is drawn over the row that overlaps it',
   stack?.[0]?.selected === true, JSON.stringify(stack))

/* ------------------------------------------------------- 4. the log's rule --- */

console.log('\nthe game log')

await closeMenus()
const viewsBefore = await prizeViews()

await realClick('.gameboard > .prizes img.card', 0)
await press(' ')
await sleep(300)
const viewsAfterSpace = await prizeViews()
check('the space bar on a face-down prize writes "Viewed prize card"',
   viewsAfterSpace === viewsBefore + 1, `${viewsBefore} -> ${viewsAfterSpace}`)
check('and the details it opened are up', (await detailsOpen()) === true, `details up=${await detailsOpen()}`)

await press(' ')
await sleep(300)
check('the space bar again puts the details away and writes nothing of its own',
   (await prizeViews()) === viewsAfterSpace, `${viewsAfterSpace} -> ${await prizeViews()}`)
check('with the details now closed', (await detailsOpen()) === false, `details up=${await detailsOpen()}`)
await closeDetails()

/* the same look, taken the three other ways */
await fire('.gameboard > .prizes img.card', 'dblclick')
await sleep(300)
check('a double click on it writes the same line', (await prizeViews()) === viewsAfterSpace + 1,
   `${viewsAfterSpace} -> ${await prizeViews()}`)
await closeDetails()

await fire('.gameboard > .prizes img.card', 'contextmenu')
const cardMenu = await menuText()
check('its right click menu opens', /Show Details/.test(String(cardMenu)), String(cardMenu).slice(0, 60))
await clickMenu('Show Details')
const viewsAfterMenu = await prizeViews()
check('and the menu\'s Show Details writes it too', viewsAfterMenu === viewsAfterSpace + 2,
   `${viewsAfterSpace + 1} -> ${viewsAfterMenu}`)
await closeDetails()

/* --- and nothing, once the prizes are face up --- */

await fire('.gameboard > .prizes .count', 'contextmenu')
await clickMenu('Show Prizes')
const faceUp = await page.evaluate(`Boolean(document.querySelector('.gameboard > .prizes img.card[src*="limitlesstcg"], .gameboard > .prizes img.card:not([alt="Hidden Card"])'))`)
check('Show Prizes turns the player\'s prizes face up', faceUp === true, `face up=${faceUp}`)

const faceUpBefore = await prizeViews()
await closeMenus()
await realClick('.gameboard > .prizes img.card', 0)
await press(' ')
await sleep(300)
check('the space bar on a prize that is already face up writes nothing',
   (await prizeViews()) === faceUpBefore, `${faceUpBefore} -> ${await prizeViews()}`)
await closeDetails()

await fire('.gameboard > .prizes img.card', 'dblclick')
await sleep(300)
check('and neither does a double click on it', (await prizeViews()) === faceUpBefore,
   `${faceUpBefore} -> ${await prizeViews()}`)
await closeDetails()

await fire('.gameboard > .prizes img.card', 'contextmenu')
await clickMenu('Show Details')
check('nor the menu\'s Show Details', (await prizeViews()) === faceUpBefore,
   `${faceUpBefore} -> ${await prizeViews()}`)
await closeDetails()

/* the prize is a prize again once it is face down */
await fire('.gameboard > .prizes .count', 'contextmenu')
await clickMenu('Hide Prizes')
await closeMenus()
await realClick('.gameboard > .prizes img.card', 0)
await press(' ')
await sleep(300)
check('face down again, the space bar writes the line again',
   (await prizeViews()) === faceUpBefore + 1, `${faceUpBefore} -> ${await prizeViews()}`)
await closeDetails()

/* ------------------------------------------ 5. the far half, which is solo's --- */

console.log('\nthe far half\'s prizes, in solo')

await dealFarPrizes()
const farPrizes = await count('.gameboard > .prizes2 .prize > div')
check('the far half has prizes of its own', farPrizes === 6, `${farPrizes} prizes`)

const farViewsBefore = await prizeViews()
await closeMenus()
await realClick('.gameboard > .prizes2 img.card', 0)
const farSelected = await page.evaluate(`Boolean(document.querySelector('.gameboard > .prizes2 .prize.selected > div.selected'))`)
check('a far prize is selectable in solo, the way the player\'s own is', farSelected === true, `selected=${farSelected}`)

const farOutline = await cardLook('.gameboard > .prizes2', 0)
check('and it glows the same way', farOutline?.outline === handGlow, `far outline "${farOutline && farOutline.outline}"`)

await press(' ')
await sleep(300)
const farLines = await logLines()
const farViews = farLines.filter((l) => /Viewed prize card/.test(l.text))
check('looking at a far face-down prize writes the line as well',
   farViews.length === farViewsBefore + 1, `${farViewsBefore} -> ${farViews.length}`)
check('and it is that half\'s line, not the player\'s',
   /Player 2/.test(String(farViews.at(-1)?.who)), String(farViews.at(-1)?.who))
await closeDetails()

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
