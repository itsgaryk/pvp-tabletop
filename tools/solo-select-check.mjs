/*
 * Solo mode, from the player's side: is every card on the far half selectable the
 * way the player's own cards are, and does right-click behave the same there?
 *
 *   node tools/solo-select-check.mjs
 *
 * Needs a dev server on BASE (default http://localhost:3005) and a headless
 * browser with CDP on CDP_PORTS (default 9222) - see tools/solo-check.mjs.
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
page.watchForErrors('solo')

const q = (selector) => JSON.stringify(selector)
const count = (selector) => page.evaluate(`document.querySelectorAll(${q(selector)}).length`)

/* a synthetic click at a place, which is what the handlers read their x/y from */
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
   A real click, through the browser's own hit testing: what is under the point is
   what gets it. Synthetic events cannot tell the two stacked tables apart.
*/
async function realClick (selector) {
   const box = await page.evaluate(`(() => {
      const el = document.querySelector(${q(selector)})
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

/* a real drag: pointerdown, past the 5px threshold, over the target, up */
async function drag (fromSelector, toSelector) {
   const box = async (selector) => page.evaluate(`(() => {
      const el = document.querySelector(${q(selector)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
   })()`)

   const from = await box(fromSelector)
   const to = await box(toSelector)
   if (!from || !to) return false

   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' })
   await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', clickCount: 1 })
   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 12, y: from.y + 12, button: 'left' })
   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left' })
   await sleep(80)
   await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 })
   await sleep(350)
   return true
}

const press = (key, init = {}) => page.evaluate(`(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', { key: ${q(key)}, bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))
   return true
})()`)

const menuText = () => page.evaluate(`(() => {
   const menu = document.querySelector('body > div.z-25')
   return menu ? menu.innerText.replace(/\\s+/g, ' ').trim() : null
})()`)

const closeMenus = () => page.evaluate(`(() => {
   document.querySelectorAll('body > div.z-25').forEach((el) => el.remove())
   return true
})()`)

const soloLog = () => page.evaluate(`(() => {
   const log = document.querySelector('.solo-log')
   return log ? log.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

console.log(`solo selection check against ${BASE}`)
await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
await page.importDeck('Edit Deck')
await page.importDeck('Edit Deck 2')
await page.clickText('Setup', { settle: 2500 })

/* ------------------------------------------------- 1. the far half's hand --- */

console.log('\nthe far half\'s hand')
check('the far hand is dealt', (await count('.hand2 img.card')) === 7, `${await count('.hand2 img.card')} cards`)

await fire('.hand2 img.card', 'click')
check('a click selects a far card', (await count('.hand2 div.selected')) === 1, `${await count('.hand2 div.selected')} selected`)

await fire('.hand2 img.card', 'contextmenu')
const handMenu = await menuText()
check('right click opens that card\'s menu', /Show Details/.test(String(handMenu)), String(handMenu).slice(0, 80))
await closeMenus()

/* --------------------------------------------- 2. cards into that half's play --- */

console.log('\nthe far half\'s Pokemon in play')
const before = await soloLog()
await drag('.hand2 img.card', '.bench2')
check('dragging a far card onto the far Bench puts it in play',
   (await count('.bench2 img.card')) === 1 && (await count('.bench img.card')) === 0,
   `far bench ${await count('.bench2 img.card')}, own bench ${await count('.bench img.card')}`)

await fire('.bench2 img.card', 'click')
check('a click selects the Pokemon in play', (await count('.bench2 img.card.selected')) === 1,
   `${await count('.bench2 img.card.selected')} selected`)

await fire('.bench2 img.card', 'contextmenu')
const slotMenu = await menuText()
check('right click opens the slot menu', /Set Damage/.test(String(slotMenu)) && /Show All/.test(String(slotMenu)), String(slotMenu).slice(0, 90))
await closeMenus()

/* --------------------------------------------- 3. the keys follow the half --- */

console.log('\nthe keyboard acts on the half the selection is on')
await press('d')
await sleep(300)
check('D discards it to that half\'s discard',
   (await count('.bench2 img.card')) === 0 && (await count('.discard2 img.card')) === 1 && (await count('.discard img.card')) === 0,
   `far bench ${await count('.bench2 img.card')}, far discard ${await count('.discard2 img.card')}, own discard ${await count('.discard img.card')}`)

const log = await soloLog()
check('and it is logged as Player 2', /Player 2/.test(log), log.replace(before, '').slice(0, 120))

/* ------------------------------------------- 4. attached cards are cards too --- */

console.log('\ncards attached to a far Pokemon')
await drag('.hand2 img.card', '.bench2')
await sleep(200)

/*
   A Pokemon dragged onto a Pokemon evolves it, anything else attaches under it -
   so keep trying hand cards until one attaches (a random deck's hand is mostly
   Trainers and Energy, but the first card is not guaranteed to be).
*/
let attached = 0
for (let i = 0; i < 5 && !attached; i++) {
   await drag('.hand2 img.card', '.bench2 img.card')
   attached = await count('.bench2 img[data-attached]')
}
check('dragging a card onto the Pokemon attaches it', attached === 1, `${attached} attached`)

if (attached) {
   await fire('.bench2 img[data-attached]', 'click')
   check('an attached card can be selected on its own', (await count('.bench2 img.card-attached-selected')) === 1,
      `${await count('.bench2 img.card-attached-selected')} selected`)

   await fire('.bench2 img[data-attached]', 'contextmenu')
   const attachedMenu = await menuText()
   check('and right clicked, like one in hand', /Show Details/.test(String(attachedMenu)), String(attachedMenu).slice(0, 80))
   await closeMenus()
}

/* ------------------------------------------------- 5. Ctrl+A, as on your own --- */

console.log('\nselect all')
/* each drop on the empty Bench makes a new Pokemon there */
while ((await count('.bench2 img.card.pokemon')) < 3) {
   await drag('.hand2 img.card', '.bench2')
   if ((await count('.hand2 img.card')) === 0) break
}

/* the key is read off the Bench itself, which is the element that listens */
await page.evaluate(`document.querySelector('.bench2 > div').focus()`)
await page.evaluate(`(() => {
   const el = document.querySelector('.bench2 > div')
   el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }))
   return true
})()`)
await sleep(200)
const benchPokemon = await count('.bench2 img.card.pokemon')
check('Ctrl+A takes the whole far Bench',
   (await count('.bench2 img.card.pokemon.selected')) === benchPokemon && benchPokemon >= 2,
   `${await count('.bench2 img.card.pokemon.selected')} of ${benchPokemon}`)

/* ------------------------------------------- 6. the other zones are cards --- */

console.log('\nthe far half\'s other zones')
await fire('.prizes2 img.card', 'click')
check('a prize is selectable like one of your own', (await count('.prizes2 div.selected')) === 1,
   `${await count('.prizes2 div.selected')} selected`)

await fire('.hand2 img.card', 'click')
await press('g')
await sleep(300)
check('G plays a far card as that half\'s Stadium', (await count('.stadium2 img.card')) === 1,
   `far stadium ${await count('.stadium2 img.card')}`)
await fire('.stadium2 img.card', 'click')
check('and the Stadium card is selectable', (await count('.stadium2 div.selected')) === 1,
   `${await count('.stadium2 div.selected')} selected`)

/* ------------------------------------------------ 6. the piles' own menus --- */

console.log('\nthe far half\'s piles')
await fire('.discard2 .count', 'contextmenu')
const discardMenu = await menuText()
check('the discard has its own menu', /Shuffle All Into Deck/.test(String(discardMenu)), String(discardMenu).slice(0, 70))
await closeMenus()

await fire('.prizes2 .count', 'contextmenu')
const prizesMenu = await menuText()
check('so do the prizes', /Show Prizes/.test(String(prizesMenu)), String(prizesMenu).slice(0, 70))
await closeMenus()

await fire('.lz2 .count', 'contextmenu')
const lzMenu = await menuText()
check('and the lost zone', /View All/.test(String(lzMenu)), String(lzMenu).slice(0, 50))
await closeMenus()

/* ------------------------------------------------- 7. the shared table --- */

console.log('\nthe table')
/* the earlier checks used the dealt hand up, so draw the far half one first */
await fire('.deck2 .count', 'contextmenu')
await page.clickText('Draw', { settle: 500 })

await fire('.hand2 img.card', 'click')
await press('x')
await sleep(400)
check('X puts a far card on that half\'s table', (await count('.play2 img.card')) === 1,
   `far table ${await count('.play2 img.card')}, own table ${await count('.play img.card')}`)

const ownTableEmpty = await page.evaluate(`document.querySelector('.play').classList.contains('empty')`)
check('the player\'s empty table stands aside', ownTableEmpty === true, `empty=${ownTableEmpty}`)

await realClick('.play2 img.card')
check('so a real click reaches the far table\'s card',
   (await count('.play2 .selected')) === 1 && (await count('.play .selected')) === 0,
   `far ${await count('.play2 .selected')} selected, own ${await count('.play .selected')}`)

/*
   Standing aside is only for a table with nothing on it and nothing in hand: a
   card dragged from the player's own hand still lands on the player's own table,
   because during a drag the table takes pointer events again.
*/
const farTable = await count('.play2 img.card')
await drag('.hand img.card', '.play')
check('a card dragged from the player\'s hand lands on the player\'s own table',
   (await count('.play img.card')) === 1 && (await count('.play2 img.card')) === farTable,
   `own table ${await count('.play img.card')}, far table ${await count('.play2 img.card')} (was ${farTable})`)

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
