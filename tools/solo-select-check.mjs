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

/*
   Click a menu entry. Its text is the label with the shortcut letter appended (no
   space between them), so the label is matched from the start rather than exactly.
*/
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

/*
   Close whatever menu is up the way a player does - a press outside it, or Escape.
   (Removing the node instead would leave the menu component believing it is still
   open, so its next open would render nothing.)
*/
const closeMenus = async () => {
   await page.evaluate(`(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
   await sleep(200)
}

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
/* closing a menu with a press outside it also clears the selection, as it should */
await fire('.bench2 img.card.pokemon', 'click')
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

/* -------------------- 7. the far half's Pokemon: the player's menu, and its moves --- */

console.log('\nthe far half\'s Pokemon: the player\'s menu, and moves on that half')

/* keep that half's hand stocked, drawing from its own deck */
async function farHand (n = 1) {
   for (let i = 0; i < 20 && (await count('.hand2 img.card')) < n; i++) {
      await fire('.deck2 .count', 'contextmenu')
      await page.clickText('Draw', { settle: 300 })
   }
}

/* one Pokemon on the player's own Bench, so a bug on the far half would show */
await drag('.hand img.card', '.bench')
const ownBench = await count('.bench img.card.pokemon')
check('the player\'s own Bench has a Pokemon to lose', ownBench === 1, `${ownBench}`)

/* three on the far half: one Active, two on its Bench */
while ((await count('.bench2 img.card.pokemon')) + (await count('.active2 img.card.pokemon')) < 3) {
   await farHand(1)
   await drag('.hand2 img.card', '.bench2')
}
await drag('.bench2 img.card.pokemon', '.active2')
check('a far Pokemon can be dragged to that half\'s Active spot',
   (await count('.active2 img.card.pokemon')) === 1, `${await count('.active2 img.card.pokemon')} active`)

/*
   Double click: what double clicking the player's own Pokemon opens. The moves
   are the Pokemon's own attacks, and a random hand holds Energy and Trainers too,
   so cards are put in play and tried until one of them has a move to show.
*/
let moves = 0
for (let i = 0; i < 12 && !moves; i++) {
   await farHand(1)
   if ((await count('.hand2 img.card')) === 0) break

   const before = await count('.bench2 img.card.pokemon')
   await drag('.hand2 img.card', '.bench2')
   if ((await count('.bench2 img.card.pokemon')) === before) continue

   await fire('.bench2 .slot:last-child img.card.pokemon', 'dblclick')
   moves = await count('.attack')
   await page.clickText('Close', { settle: 300 })
}
check('double clicking a far Pokemon shows the player\'s own menu of its moves', moves > 0, `${moves} move buttons`)

/* right click: the player's own slot menu, and its movement entries */
await fire('.active2 img.card.pokemon', 'contextmenu')
const activeMenu = await menuText()
check('its right click menu is the player\'s, with the entries that cross the half',
   /Move to Bench/.test(String(activeMenu)) && /Return to Hand/.test(String(activeMenu)) && /Discard All/.test(String(activeMenu)),
   String(activeMenu).slice(0, 100))
await closeMenus()

/*
   Move to Active swaps the two spots, on that half only. A stripe on the Active
   is how this knows the same Pokemon moved rather than a lookalike: a deck holds
   several copies of a card, so two slots can show the same picture.
*/
await fire('.active2 img.card.pokemon', 'contextmenu')
await clickMenu('Ability Used')
check('a far Pokemon in play can be marked as having used its ability',
   (await count('.active2 .ability-stripe')) === 1, `${await count('.active2 .ability-stripe')} stripes`)

const ownActive = await count('.active1 img.card.pokemon')
const farBench = await count('.bench2 img.card.pokemon')

await fire('.bench2 img.card.pokemon', 'contextmenu')
await clickMenu('Move to Active')
check('Move to Active swaps a far Bench Pokemon with that half\'s Active',
   (await count('.active2 img.card.pokemon')) === 1 &&
   (await count('.bench2 img.card.pokemon')) === farBench &&
   (await count('.active2 .ability-stripe')) === 0 &&
   (await count('.bench2 .ability-stripe')) === 1,
   `active ${await count('.active2 img.card.pokemon')}, bench ${await count('.bench2 img.card.pokemon')} (was ${farBench}), stripes: active ${await count('.active2 .ability-stripe')} bench ${await count('.bench2 .ability-stripe')}`)
check('and the player\'s own board is untouched',
   (await count('.bench img.card.pokemon')) === ownBench && (await count('.active1 img.card.pokemon')) === ownActive,
   `own bench ${await count('.bench img.card.pokemon')}, own active ${await count('.active1 img.card.pokemon')}`)

/* Return to Hand, which is the far Bench into the far hand */
const farHandBefore = await count('.hand2 img.card')
const ownHandBefore = await count('.hand img.card')
await fire('.bench2 img.card.pokemon', 'contextmenu')
await clickMenu('Return to Hand')
check('Return to Hand puts a far Bench Pokemon into that half\'s hand',
   (await count('.bench2 img.card.pokemon')) === farBench - 1 &&
   (await count('.hand2 img.card')) > farHandBefore &&
   (await count('.hand img.card')) === ownHandBefore,
   `far bench ${await count('.bench2 img.card.pokemon')}, far hand ${await count('.hand2 img.card')} (was ${farHandBefore})`)

/* the same moves by dragging, onto that half's own zones */
await farHand(1)
await drag('.hand2 img.card', '.bench2')
const farBench2 = await count('.bench2 img.card.pokemon')
const farHand2 = await count('.hand2 img.card')
await drag('.bench2 img.card.pokemon', '.hand2')
check('a far Pokemon dragged onto that half\'s hand lands there, not in the player\'s',
   (await count('.bench2 img.card.pokemon')) === farBench2 - 1 &&
   (await count('.hand2 img.card')) > farHand2 &&
   (await count('.hand img.card')) === ownHandBefore,
   `far bench ${await count('.bench2 img.card.pokemon')}, own hand ${await count('.hand img.card')}`)

const farBench3 = await count('.bench2 img.card.pokemon')
await drag('.active2 img.card.pokemon', '.bench2')
check('the far Active can be dragged onto that half\'s Bench',
   (await count('.active2 img.card.pokemon')) === 0 && (await count('.bench2 img.card.pokemon')) === farBench3 + 1,
   `active ${await count('.active2 img.card.pokemon')}, bench ${await count('.bench2 img.card.pokemon')} (was ${farBench3})`)

/* and a Pokemon in play on the far half cannot be dropped on the player's own piles */
await farHand(1)
await drag('.hand2 img.card', '.bench2')
const ownDiscard = await count('.discard img.card')
const farBench4 = await count('.bench2 img.card.pokemon')
await drag('.bench2 img.card.pokemon', '.discard')
check('a far Pokemon dropped on the player\'s own pile is refused, both boards left alone',
   (await count('.discard img.card')) === ownDiscard &&
   (await count('.bench img.card.pokemon')) === ownBench &&
   (await count('.bench2 img.card.pokemon')) === farBench4,
   `own discard ${await count('.discard img.card')}, own bench ${await count('.bench img.card.pokemon')}, far bench ${await count('.bench2 img.card.pokemon')}`)

/* ---------------------------------------------------------------------------
   The player's own Active spot is not a place a far card may land. The two
   halves are separate boards even though one person plays both, and a far card
   dropped there used to be taken: it attached itself to whatever was already in
   the spot, or silently began an evolve that never happened.
--------------------------------------------------------------------------- */

/* something of the player's is up there, so an accepted drop would have somewhere to land */
for (let i = 0; i < 5 && (await count('.active1 img.card.pokemon')) === 0; i++) {
   if ((await count('.hand img.card')) === 0) {
      await fire('.deck .count', 'contextmenu')
      await clickMenu('Draw')
   }
   await drag('.hand img.card', '.active1')
}
check('the player has a Pokemon in their own Active spot', (await count('.active1 img.card.pokemon')) === 1,
   `${await count('.active1 img.card.pokemon')} active`)

await farHand(1)
await drag('.hand2 img.card', '.bench2')
const ownActiveBefore = await count('.active1 img.card')
const ownActiveAttachedBefore = await count('.active1 img[data-attached]')
const farPokemon = await count('.bench2 img.card.pokemon')
const farHandBefore2 = await count('.hand2 img.card')
await drag('.bench2 img.card.pokemon', '.active1')
check('a far Pokemon dragged onto the player\'s Active is refused, and stays where it was',
   (await count('.active1 img.card')) === ownActiveBefore &&
   (await count('.active1 img[data-attached]')) === ownActiveAttachedBefore &&
   (await count('.bench2 img.card.pokemon')) === farPokemon,
   `own active ${await count('.active1 img.card')} (was ${ownActiveBefore}), attached ${await count('.active1 img[data-attached]')} (was ${ownActiveAttachedBefore}), far bench ${await count('.bench2 img.card.pokemon')} (was ${farPokemon})`)

/* and the same card goes where it belongs, so the refusal is about the destination */
await drag('.bench2 img.card.pokemon', '.active2')
check('the same card still goes to its own half\'s Active',
   (await count('.active1 img.card')) === ownActiveBefore &&
   (await count('.active2 img.card.pokemon')) === 1,
   `own active ${await count('.active1 img.card')}, far active ${await count('.active2 img.card.pokemon')}`)

/* back to the bench for the checks below, which expect it there */
await drag('.active2 img.card.pokemon', '.bench2')

/* ---------------------------------------------------------------------------
   A card on the far half's Stadium can be taken off it: to its Bench, and to
   its hand. That is the one zone of that half held as a single card rather than
   a list, and taking from it used to call a list method on a store.
--------------------------------------------------------------------------- */

console.log('\ncards on the far half\'s Stadium')

async function farStadium () {
   for (let i = 0; i < 6 && (await count('.stadium2 img.card')) === 0; i++) {
      await farHand(1)
      if ((await count('.hand2 img.card')) === 0) break
      await fire('.hand2 img.card', 'click')
      await press('g')
      await sleep(300)
   }
}

await farStadium()
check('the far half has a Stadium card', (await count('.stadium2 img.card')) === 1,
   `${await count('.stadium2 img.card')}`)

const ownBench5 = await count('.bench img.card.pokemon')
const ownHand5 = await count('.hand img.card')
const ownStadium5 = await count('.stadium img.card')
const farBench5 = await count('.bench2 img.card.pokemon')

await drag('.stadium2 img.card', '.bench2')
check('a card can be dragged from the far Stadium to that half\'s Bench',
   (await count('.stadium2 img.card')) === 0 &&
   (await count('.bench2 img.card')) > farBench5 &&
   (await count('.bench img.card')) === ownBench5 &&
   (await count('.hand img.card')) === ownHand5,
   `far stadium ${await count('.stadium2 img.card')}, far bench ${await count('.bench2 img.card')} (was ${farBench5}), own bench ${await count('.bench img.card')}`)

await farStadium()
const farHand6 = await count('.hand2 img.card')
await drag('.stadium2 img.card', '.hand2')
check('and from the far Stadium to that half\'s hand',
   (await count('.stadium2 img.card')) === 0 &&
   (await count('.hand2 img.card')) > farHand6 &&
   (await count('.hand img.card')) === ownHand5 &&
   (await count('.stadium img.card')) === ownStadium5,
   `far stadium ${await count('.stadium2 img.card')}, far hand ${await count('.hand2 img.card')} (was ${farHand6}), own hand ${await count('.hand img.card')}, own stadium ${await count('.stadium img.card')}`)

/* ------------------------------------------------- 8. the shared table --- */

console.log('\nthe table')
/* the earlier checks used the dealt hand up, so draw the far half one first */
await farHand(1)

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

/*
   The same moves with the board flipped, which is the other half of this: the far
   half is the bottom one now, and a movement must still land on it rather than on
   the player's own board above.
*/
await page.evaluate(`document.querySelector('button[aria-label="Flip Board"]').click()`)
await sleep(600)

for (let i = 0; i < 5 && (await count('.bench img.card.pokemon')) === 0; i++) {
   if ((await count('.hand img.card')) === 0) {
      await fire('.deck .count', 'contextmenu')
      await clickMenu('Draw')
   }
   await drag('.hand img.card', '.bench')
}

const ownBenchTop = await count('.bench2 img.card.pokemon')
const ownDiscardTop = await count('.discard2 img.card')
const farBenchBottom = await count('.bench img.card.pokemon')

await fire('.bench img.card.pokemon', 'contextmenu')
await clickMenu('Discard All')
check('with the board flipped, a far Pokemon is still discarded on its own half',
   (await count('.bench img.card.pokemon')) === farBenchBottom - 1 &&
   (await count('.discard img.card')) > 0 &&
   (await count('.discard2 img.card')) === ownDiscardTop &&
   (await count('.bench2 img.card.pokemon')) === ownBenchTop,
   `far bench ${await count('.bench img.card.pokemon')} (was ${farBenchBottom}), far discard ${await count('.discard img.card')}, own discard ${await count('.discard2 img.card')}`)

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
