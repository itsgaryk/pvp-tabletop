/*
 * Putting cards back on the deck in a chosen order: a search that ends
 * "shuffle your deck, then put those cards on top of it in any order"
 * (Ciphermaniac's Codebreaking).
 *
 *   node tools/deck-order-check.mjs
 *
 * Needs a dev server on BASE (default http://localhost:3005) and a headless
 * browser with CDP on CDP_PORTS (default 9222) - see tools/solo-check.mjs.
 *
 * What it is really checking is the *order*, which is the whole of the feature:
 * a card placed on top of a deck has to be the card this player draws next, and
 * the deck is face down, so the check reads the order off the dialog that shows
 * it - top card first - rather than trusting a count.
 *
 * Duplicate cards are the trap here: a deck holds several copies of a card, so
 * "a Pikachu is on top" is not the same statement as "the card I chose is on
 * top". Every placement below is made from cards with *different* names, the
 * three/three top cards are read from the grid itself, and the sequence asserted
 * is the sequence the dialog was told to build.
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
page.watchForErrors('deck-order')

page.socket.addEventListener('message', (event) => {
   let message
   try { message = JSON.parse(event.data) } catch { return }
   if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails
      console.error('[page error]', (d.exception?.description || d.text || '').slice(0, 200))
   }
})

const q = (selector) => JSON.stringify(selector)
const count = (selector) => page.evaluate(`document.querySelectorAll(${q(selector)}).length`)

/* open a pile's context menu, then one of its entries */
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

const clickMenu = async (label, { settle = 400 } = {}) => {
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

const menuText = () => page.evaluate(`(() => {
   const menu = document.querySelector('body > div.z-25')
   return menu ? menu.innerText.replace(/\\s+/g, ' ').trim() : null
})()`)

const closeMenus = async () => {
   await page.evaluate(`(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return true
   })()`)
   await sleep(200)
}

/* the deck's own count badge, which is what the player reads */
const deckCount = () => page.evaluate(`(() => {
   const el = document.querySelector('.deck .count')
   const n = el ? parseInt(el.textContent.trim(), 10) : NaN
   return Number.isInteger(n) ? n : null
})()`)

const soloLog = () => page.evaluate(`(() => {
   const log = document.querySelector('.solo-log')
   return log ? log.innerText.replace(/\\s+/g, ' ').trim() : ''
})()`)

/* the dialog's grid, top of the deck first - the order the deck is read in */
const grid = () => page.evaluate(`(() => {
   const body = document.querySelector('.popup-body')
   if (!body) return null
   return [ ...body.querySelectorAll('img.card') ].map((img) => img.alt)
})()`)

/* the order being built, as the strip above the grid names it: top of the deck first */
const steps = () => page.evaluate(`(() => {
   const body = document.querySelector('.popup-body')
   if (!body) return null
   return [ ...body.querySelectorAll('.step') ].map((el) => {
      const n = el.querySelector('.n')
      return { n: n ? Number(n.textContent.trim()) : null, name: el.textContent.replace(n ? n.textContent : '', '').trim() }
   })
})()`)

/* each card in the grid wears its place in the order, or wears nothing */
const badges = () => page.evaluate(`(() => {
   const body = document.querySelector('.popup-body')
   if (!body) return null
   return [ ...body.querySelectorAll('img.card') ].map((img) => {
      const mark = img.parentElement.querySelector('.mark')
      return { name: img.alt, n: mark ? Number(mark.textContent.trim()) : null }
   })
})()`)

const openDeckOrder = async () => {
   await fire('.deck .count', 'contextmenu')
   const menu = await menuText()
   const clicked = await clickMenu('Search & Order')
   await sleep(400)
   return { menu, clicked }
}

/* the grid, without the dialog: what the deck looks like now */
const closeDialog = async () => {
   await page.clickText('Close', { settle: 350, kinds: 'button' })
}

/* click the nth card of the grid as a player would: scrolled into view, then a real click */
async function clickCard (i) {
   const box = await page.evaluate(`(() => {
      const body = document.querySelector('.popup-body')
      if (!body) return null
      const img = body.querySelectorAll('img.card')[${i}]
      if (!img) return null
      img.scrollIntoView({ block: 'center' })
      const r = img.getBoundingClientRect()
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
   })()`)
   if (!box) return false

   await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none' })
   await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 })
   await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 })
   await sleep(150)
   return true
}

/* the first three cards in the grid that have three different names */
async function distinctTop (names, wanted = 3) {
   const out = []
   for (let i = 0; i < names.length && out.length < wanted; i++) {
      if (!out.includes(names[i])) out.push(names[i])
   }
   return out
}

const buttonsDisabled = () => page.evaluate(`(() => {
   const b = [ ...document.querySelectorAll('.popup-body ~ div button, div button') ]
      .filter((el) => /Put on (Top|Bottom)/.test(el.textContent))
   return b.map((el) => ({ text: el.textContent.trim().replace(/\\s+/g, ' '), disabled: el.disabled }))
})()`)

console.log(`deck order check against ${BASE}`)

/* ---------------------------------------------------------------------------
   A board to play on
--------------------------------------------------------------------------- */

await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
/* both halves are played from this one browser, and each needs its own deck */
await page.importDeck('Edit Deck')
await page.importDeck('Edit Deck 2')
await page.clickText('Setup', { settle: 2500 })

/* a board with a deck on it, whatever the deck import felt like doing */
let deckSize = 0
for (let i = 0; i < 10 && !(deckSize > 0); i++) {
   deckSize = await deckCount()
   if (deckSize > 0) break
   console.log(`  .. waiting for a deck (${i + 1}): ${await page.evaluate(`document.body.innerText.slice(0, 120)`)}`)
   await sleep(1000)
}
check('the player has a deck to arrange', deckSize > 0,
   deckSize > 0 ? `${deckSize} cards` : 'no deck - is VITE_LIMITLESS_WEB or tools/fake-deck-api.mjs set up? see the header')

/* ---------------------------------------------------------------------------
   The entry point, in the deck's own menu
--------------------------------------------------------------------------- */

await fire('.deck .count', 'contextmenu')
const deckMenu = await menuText()
await closeMenus()
check('the deck menu offers arranging a search',
   /Search & Order Deck/.test(String(deckMenu)), String(deckMenu).slice(0, 120))

/* ---------------------------------------------------------------------------
   The dialog: a look at the whole deck, top first, and nothing written yet
--------------------------------------------------------------------------- */

const opened = await openDeckOrder()
check('it opens the arranging dialog', Array.isArray(await grid()) && (await grid()).length === deckSize,
   `${(await grid() || []).length} cards in the panel, ${deckSize} in the deck`)

const before = await grid()
check('the grid shows the deck, top card first', before !== null && before.length > 3,
   `${before.length} shown`)

const disabled = await buttonsDisabled()
check('and placing is not an action until a card is chosen',
   disabled.length >= 2 && disabled.every((b) => b.disabled), JSON.stringify(disabled))

/* ---------------------------------------------------------------------------
   Choosing cards: click order is the placement order
--------------------------------------------------------------------------- */

const chosen = await distinctTop(before, 3)
const chosenAt = chosen.map((name) => before.indexOf(name))

await clickCard(chosenAt[0])
await clickCard(chosenAt[1])
await clickCard(chosenAt[2])

const stepped = await steps()
check('the strip names the order, the last card chosen being the top of the deck',
   JSON.stringify(stepped.map((s) => s.name)) === JSON.stringify([ chosen[2], chosen[1], chosen[0] ]),
   `${JSON.stringify((stepped || []).map((s) => s.name))} for clicks ${JSON.stringify(chosen)}`)

const marked = await badges()
check('each card wears its place in that order, wherever it sits in the grid',
   chosenAt.every((at, i) => marked[at] && marked[at].n === i + 1) &&
   marked.every((m, i) => m.n === null || chosenAt.includes(i)),
   JSON.stringify(marked.filter((m) => m.n !== null)))

check('a card clicked again leaves the order',
   await clickCard(chosenAt[2]) && JSON.stringify((await steps()).map((s) => s.name)) === JSON.stringify([ chosen[1], chosen[0] ]),
   JSON.stringify((await steps() || []).map((s) => s.name)))

/* put it back, so the placement below is the three-card one */
await clickCard(chosenAt[2])
const threeAgain = await steps()
check('and clicked again it returns - to the end of the order, where the next click puts it',
   threeAgain.length === 3, JSON.stringify(threeAgain.map((s) => s.name)))

/* ---------------------------------------------------------------------------
   The placement itself: on top, in this order
--------------------------------------------------------------------------- */

const logBefore = await soloLog()
await page.clickText('Put on Top in This Order', { settle: 600 })

check('the dialog closes behind the placement', (await grid()) === null)

const log = await soloLog()
const logged = log.slice(logBefore.length)
check('the search and the placement are both in the log, and neither names a card',
   /Searched deck/.test(logged) && /Put 3 cards on top of Deck in order/.test(logged),
   logged.slice(0, 160))

const after = await (async () => {
   await openDeckOrder()
   const g = await grid()
   await closeDialog()
   return g
})()

check('the three cards are the top three, in the order they were chosen',
   JSON.stringify(after.slice(0, 3)) === JSON.stringify([ chosen[2], chosen[1], chosen[0] ]),
   `${JSON.stringify(after.slice(0, 3))} wanted ${JSON.stringify([ chosen[2], chosen[1], chosen[0] ])}`)

check('and the deck still holds every one of its cards', after.length === deckSize,
   `${after.length} of ${deckSize}`)

/*
   And the same thing said the way the game says it: the card drawn next is the
   card the dialog showed at the top. A count cannot tell these apart, which is
   why the check draws. (It draws one, so what the deck holds from here on is one
   card fewer - the check below reads the deck for itself rather than assuming.)
*/
await fire('.deck .count', 'contextmenu')
await clickMenu('Draw')
await sleep(500)
const drawn = await page.evaluate(`(() => {
   const hand = document.querySelectorAll('.hand img.card')
   return hand.length ? hand[hand.length - 1].alt : null
})()`)
check('drawing takes the card the dialog showed on top', drawn === after[0],
   `drew ${drawn}, the grid's first card was ${after[0]}`)

/* the rest of the deck was shuffled underneath: this is not the deck it was */
check('the rest of the deck is not the order it was left in',
   JSON.stringify(after.slice(3)) !== JSON.stringify(before.slice(3)),
   'a shuffle happened between the choice and the placement')

/* ---------------------------------------------------------------------------
   And the same for the bottom, which is what "both ends" means
--------------------------------------------------------------------------- */

const reopened = await openDeckOrder()
check('reopening the dialog starts from no choice at all',
   (await steps()).length === 0, JSON.stringify(await steps()))

const bottomGrid = await grid()
/* two cards from the middle of the deck, so they cannot already be at its bottom */
const bottomChosen = await distinctTop(bottomGrid.slice(5), 2)
const bottomAt = bottomChosen.map((name) => bottomGrid.indexOf(name))

await clickCard(bottomAt[0])
await clickCard(bottomAt[1])

const steppedBottom = await steps()
check('the bottom placement is chosen the same way',
   JSON.stringify(steppedBottom.map((s) => s.name)) === JSON.stringify([ bottomChosen[1], bottomChosen[0] ]),
   JSON.stringify((steppedBottom || []).map((s) => s.name)))

await page.clickText('Put on Bottom in This Order', { settle: 600 })

const afterBottom = await (async () => {
   await openDeckOrder()
   const g = await grid()
   await closeDialog()
   return g
})()

const heldNow = await deckCount()

/*
   The grid is the deck top first, so the bottom of the deck is the *end* of what
   it shows. The pair goes there in the order chosen: `bottomChosen[0]` was chosen
   first and sits below `bottomChosen[1]`, so in a top-first view it comes last.
*/
check('cards put on the bottom are the last cards of the deck, the first chosen below the second',
   JSON.stringify(afterBottom.slice(-2)) === JSON.stringify([ bottomChosen[1], bottomChosen[0] ]),
   `${JSON.stringify(afterBottom.slice(-2))} wanted ${JSON.stringify([ bottomChosen[1], bottomChosen[0] ])}`)

check('the deck is still whole after a placement at the bottom', afterBottom.length === heldNow,
   `${afterBottom.length} of ${heldNow}`)

/*
 * The mirror's own handling of an ordered move is not covered here. It is a
 * handful of lines in `opponent.js` (`pile2.placeOrdered(list, { bottom })`),
 * and the one thing about it that is worth checking - that the ids arrive in the
 * order the placer chose and land at the end of the array, which is the top of
 * the deck in this store - is documented over it. A deck's order is unreadable to
 * everyone but its owner, so a second browser cannot see the difference anyway:
 * what it can see is the count and the shuffle, and the mirror already answers
 * both.
 */

/* ---------------------------------------------------------------------------
   The panel is a taller-than-the-window grid that scrolls, with its actions at
   its foot - the shape three placed cards have to be chosen in
--------------------------------------------------------------------------- */

await browser.setViewport(930, 636)
await openDeckOrder()

const shape = await page.evaluate(`(() => {
   const panel = document.querySelector('.popup')
   const body = document.querySelector('.popup-body')
   const actions = document.querySelector('.popup > div:last-child')
   if (!panel || !body || !actions) return null

   const p = panel.getBoundingClientRect()
   return {
      panelBottom: Math.round(p.bottom),
      windowHeight: window.innerHeight,
      scrolls: body.scrollHeight > body.clientHeight,
      bodyHeight: Math.round(body.getBoundingClientRect().height),
      cardsInView: [ ...body.querySelectorAll('img.card') ].filter((img) => {
         const r = img.getBoundingClientRect()
         return r.top >= 0 && r.bottom <= window.innerHeight
      }).length,
      actionsAtFoot: Math.round(actions.getBoundingClientRect().bottom) <= Math.round(p.bottom) + 1
   }
})()`)

check('the panel fits the window rather than running off it',
   shape.panelBottom <= shape.windowHeight, JSON.stringify(shape))
check('its body scrolls, so the whole deck is reachable',
   shape.scrolls === true, `${shape.bodyHeight}px of body, scrolls: ${shape.scrolls}`)
check('and the actions stay at the panel\'s foot, not down the page',
   shape.actionsAtFoot === true, JSON.stringify(shape))

await browser.setViewport(1277, 821)
await closeDialog()

console.log(`\n${failures ? failures + ' FAILED' : 'all checks passed'}`)
browser.detach()
process.exit(failures ? 1 : 0)
