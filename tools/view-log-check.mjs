/*
 * The lines the game log writes for a look at a pile the other player cannot see.
 *
 *   node tools/view-log-check.mjs
 *
 * Needs a dev server on BASE (default http://localhost:3005) and a headless
 * browser with CDP on CDP_PORTS (default 9222) - see tools/solo-check.mjs.
 *
 * The deck is the pile this is about: nobody at the table can see it, so a look
 * through it is written in the log even though the line names nothing. Four things
 * take that look and they have to agree, because they are the same look - the deck
 * menu's View All, its Order Top X and its Search & Order Deck, and the board's `V`.
 * Three of those wrote the line and `V`, the commonest of the four, wrote nothing at
 * all: it called `openPile` where the others called the deck's own `viewDeck`, so the
 * keyboard was the one way to read the whole deck in silence.
 *
 * `tools/prize-check.mjs` is the same question about a card rather than a pile - the
 * face-down prize, whose look writes "Viewed prize card".
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
page.watchForErrors('view-log')

const q = (selector) => JSON.stringify(selector)
const count = (selector) => page.evaluate(`document.querySelectorAll(${q(selector)}).length`)

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

const press = (key, init = {}) => page.evaluate(`(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', { key: ${q(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))
   return true
})()`)

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

const closeMenus = async () => {
   await page.evaluate(`(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
   await sleep(250)
}

/* the pile panel the look opens: the inspection dialog, with the deck's cards in it */
const deckPanelOpen = () => page.evaluate(`Boolean(document.querySelector('.popup .inspection'))`)

const deckViews = () => page.evaluate(`(document.querySelector('.solo-log') || {}).innerText
   ? (document.querySelector('.solo-log').innerText.match(/Viewed deck/g) || []).length
   : 0`)

console.log(`view log check against ${BASE}`)
await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
await page.importDeck('Edit Deck')

const before = await deckViews()
check('a fresh board has written nothing about the deck', before === 0, `${before} "Viewed deck" line(s)`)

/* -------------------------------------------------------------- the V key --- */

await press('v')
await sleep(400)
check('V opens the whole deck', (await deckPanelOpen()) === true, `panel open=${await deckPanelOpen()}`)

const afterV = await deckViews()
check('and it writes "Viewed deck", the line View All writes', afterV === before + 1,
   `${before} -> ${afterV}`)

await press('Escape')
await sleep(400)
check('Escape closes the panel', (await deckPanelOpen()) === false, `panel open=${await deckPanelOpen()}`)
check('and closing it adds nothing of its own', (await deckViews()) === afterV, `${afterV} -> ${await deckViews()}`)

await press('v')
await sleep(400)
check('a second look is a second line', (await deckViews()) === afterV + 1,
   `${afterV} -> ${await deckViews()}`)
await press('Escape')
await sleep(400)

/* ------------------------------------ and the modifier combination stays out --- */

console.log('\nCtrl+V')

const beforeCtrl = await deckViews()
await press('v', { ctrlKey: true })
await sleep(400)
check('Ctrl+V opens nothing - that combination is the browser\'s', (await deckPanelOpen()) === false,
   `panel open=${await deckPanelOpen()}`)
check('and writes nothing either', (await deckViews()) === beforeCtrl, `${beforeCtrl} -> ${await deckViews()}`)

/* ------------------------------------------- the entry V is the keyboard of --- */

console.log('\nthe deck menu\'s View All')

await closeMenus()
await fire('.deck .count', 'contextmenu')
await clickMenu('View All')
check('View All opens the same panel', (await deckPanelOpen()) === true, `panel open=${await deckPanelOpen()}`)
check('and writes the same line', (await deckViews()) === beforeCtrl + 1, `${beforeCtrl} -> ${await deckViews()}`)
await press('Escape')
await sleep(400)

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
