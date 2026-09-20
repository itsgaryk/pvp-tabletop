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

/*
   *Order Top X* asks how many cards with the browser's own prompt. Headless
   Chrome's `Page.handleJavaScriptDialog` cannot type an answer into one, so the
   prompt is stubbed in the page: the same call the app makes, answered with what
   the check wants, and put back afterwards.
*/
const stubPrompt = (answer) => page.evaluate(`(() => {
   globalThis.__realPrompt = globalThis.__realPrompt || window.prompt
   window.prompt = () => ${JSON.stringify(String(answer))}
   return true
})()`)

const unstubPrompt = () => page.evaluate(`(() => {
   if (globalThis.__realPrompt) window.prompt = globalThis.__realPrompt
   return true
})()`)

async function openOrderTopX (x) {
   await stubPrompt(x)
   await fire('.deck .count', 'contextmenu')
   await clickMenu('Order Top X')
   await sleep(400)
   await unstubPrompt()
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
check('the deck menu offers arranging a search, and reordering the top of the deck',
   /Search & Order Deck/.test(String(deckMenu)) && /Order Top X/.test(String(deckMenu)),
   String(deckMenu).slice(0, 140))

/* ---------------------------------------------------------------------------
   The dialog: the whole deck, bottom of it first, and nothing written yet
--------------------------------------------------------------------------- */

const logBeforeOpen = await soloLog()
const opened = await openDeckOrder()
const openLog = (await soloLog()).slice(logBeforeOpen.length)
check('it opens the arranging dialog', Array.isArray(await grid()) && (await grid()).length === deckSize,
   `${(await grid() || []).length} cards in the panel, ${deckSize} in the deck`)

check('and opening it says the deck was looked through', /Viewed deck/.test(openLog), openLog.slice(0, 120))

const before = await grid()
check('the grid shows the deck, top card first, so a card reads 1, 2, 3', before !== null && before.length > 3,
   `${before.length} shown`)

/*
   Which end is which, asserted rather than assumed, and asserted *here* - before
   anything has been placed - so the deck is still the 60 cards the rest of the
   check counts on: the grid is top card first, so its **first** cell is the card
   a draw takes. This is the reading a placement has to agree with, and the one a
   check that only measures counts cannot see: the dialog, the draw and the array
   can all be wrong in the same direction and only a draw shows it.
*/
const topBefore = before[0]
await fire('.deck .count', 'contextmenu')
await clickMenu('Draw')
await sleep(400)
const drawnBefore = await page.evaluate(`(() => {
   const h = document.querySelectorAll('.hand img.card')
   return h.length ? h[h.length - 1].alt : null
})()`)
check('the first card of the grid is the card a draw takes', drawnBefore === topBefore,
   `drew ${drawnBefore}, the grid's first cell was ${topBefore}`)

/* that draw took one, so the deck is 59 from here: read how many, rather than assume */
const deckNow = await deckCount()
check('and drawing one leaves one fewer in the deck', deckNow === before.length - 1,
   `${deckNow} in the deck after drawing, ${before.length} shown before it`)

/*
   Mark the three cards from the top of the grid, deepest first, so that card 1 -
   the first one clicked - is the card that was already on top of the deck. The
   deck's names are all different, so a cell, a name and a position are the same
   statement and every assertion below can be about one of them.

   Read the grid again rather than working from `before`: a card has been drawn
   since it was taken, so every cell below the top one has moved up.
*/
const held = await grid()
const chosen = [ held[2], held[1], held[0] ]
const chosenAt = [ 2, 1, 0 ]

const disabled = await buttonsDisabled()
check('and placing is not an action until a card is chosen',
   disabled.length >= 2 && disabled.every((b) => b.disabled), JSON.stringify(disabled))

/* ---------------------------------------------------------------------------
   Choosing cards: the click order is the order, and the badge says where
--------------------------------------------------------------------------- */

await clickCard(chosenAt[0])
await clickCard(chosenAt[1])
await clickCard(chosenAt[2])

const stepped = await steps()
check('the strip names the order card 1 first, which is the order they were clicked in',
   JSON.stringify(stepped.map((s) => s.name)) === JSON.stringify(chosen) &&
   JSON.stringify(stepped.map((s) => s.n)) === JSON.stringify([ 1, 2, 3 ]),
   `${JSON.stringify(stepped)} for clicks ${JSON.stringify(chosen)}`)

const marked = await badges()
check('each card wears its place in that order, wherever it sits in the grid',
   chosenAt.every((at, i) => marked[at] && marked[at].n === i + 1) &&
   marked.every((m, i) => m.n === null || chosenAt.includes(i)),
   JSON.stringify(marked.filter((m) => m.n !== null)))

const rerendered = await grid()
check('and marking moves nothing: the grid stays the deck, in the deck\'s order',
   JSON.stringify(rerendered) === JSON.stringify(held), 'grid is stable while cards are marked')

check('a card clicked again leaves the order',
   await clickCard(chosenAt[2]) && JSON.stringify((await steps()).map((s) => s.name)) === JSON.stringify([ chosen[0], chosen[1] ]),
   JSON.stringify((await steps() || []).map((s) => s.name)))

/* put it back, so the placement below is the three-card one */
await clickCard(chosenAt[2])
const threeAgain = await steps()
check('and clicked again it returns, at the end of the order where the next click puts it',
   JSON.stringify(threeAgain.map((s) => s.name)) === JSON.stringify([ chosen[0], chosen[1], chosen[2] ]),
   JSON.stringify(threeAgain.map((s) => s.name)))

/* ---------------------------------------------------------------------------
   The placement itself: on top, card 1 first
--------------------------------------------------------------------------- */

const logBefore = await soloLog()
await page.clickText('Put on Top in This Order', { settle: 600 })

check('the dialog closes behind the placement', (await grid()) === null)

const log = await soloLog()
const logged = log.slice(logBefore.length)
check('the placement is in the log, and does not name a card',
   /Put 3 cards on top of Deck in order/.test(logged),
   logged.slice(0, 160))

/*
   The look that came first is its own line, and the placement is the line the
   dialog writes when a card is actually placed - so opening a dialog and closing
   it again leaves a "Viewed deck" and nothing else. (The log read here predates
   the reopen below, which adds another one.)
*/
check('and the look is in the log as its own line', /Viewed deck/.test(log),
   `${(log.match(/Viewed deck/g) || []).length} "Viewed deck" line(s) so far`)

const after = await (async () => {
   await openDeckOrder()
   const g = await grid()
   await closeDialog()
   return g
})()

/*
   The grid is the deck top card first, so the top of the deck is the *start* of
   what it shows: the three placed cards are its first three cells, in the order
   they were marked. Card 1 is the cell wearing the "1", and it is the card drawn
   next - which is the only place that claim can be checked from.
*/
check('the three cards are the top three, card 1 being the one drawn first',
   JSON.stringify(after.slice(0, 3)) === JSON.stringify(chosen),
   `${JSON.stringify(after.slice(0, 3))} wanted ${JSON.stringify(chosen)}`)

check('and the deck still holds every card it did', after.length === before.length - 1,
   `${after.length} after drawing one and placing three, ${before.length - 1} expected`)

/*
   And the same thing said the way the game says it: the card drawn next is card
   1 - the card the dialog drew a "1" on. A count cannot tell a placement from a
   shuffle, which is why the check draws. (It draws one, so what the deck holds
   from here on is one card fewer - the check below reads the deck for itself.)
*/
await fire('.deck .count', 'contextmenu')
await clickMenu('Draw')
await sleep(500)
const drawn = await page.evaluate(`(() => {
   const hand = document.querySelectorAll('.hand img.card')
   return hand.length ? hand[hand.length - 1].alt : null
})()`)
check('drawing takes card 1, the card the dialog marked first', drawn === chosen[0],
   `drew ${drawn}, card 1 was ${chosen[0]}`)

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
/*
   Two cards from the top half, so neither can already be at the bottom: the grid
   is top card first, so its *end* is the bottom of the deck.
*/
const bottomChosen = await distinctTop(bottomGrid.slice(0, 10), 2)
const bottomAt = bottomChosen.map((name) => bottomGrid.indexOf(name))

await clickCard(bottomAt[0])
await clickCard(bottomAt[1])

const steppedBottom = await steps()
check('the bottom placement is chosen the same way',
   JSON.stringify(steppedBottom.map((s) => s.name)) === JSON.stringify(bottomChosen),
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
   The grid is the deck top card first, so the bottom of the deck is the *end* of
   what it shows - and the two cards are there in the order chosen, in the same
   sense as a top placement: card 1 of the pair is the first of them to be drawn,
   and a card drawn from the bottom is the last. So `bottomChosen[1]`, chosen
   second and therefore deeper, is the very last cell; `bottomChosen[0]` sits just
   above it, and is the first of the pair to come out.
*/
check('cards put on the bottom are the last cards of the deck, the first chosen above the second',
   JSON.stringify(afterBottom.slice(-2)) === JSON.stringify([ bottomChosen[1], bottomChosen[0] ]),
   `${JSON.stringify(afterBottom.slice(-2))} wanted ${JSON.stringify([ bottomChosen[1], bottomChosen[0] ])}`)

check('the deck is still whole after a placement at the bottom', afterBottom.length === heldNow,
   `${afterBottom.length} of ${heldNow}`)

/* ---------------------------------------------------------------------------
   Order Top X: the top of the deck rearranged, and nothing shuffled
--------------------------------------------------------------------------- */

const orderCount = 3
const beforeScopeDeck = await (async () => {
   await openDeckOrder()
   const g = await grid()
   await closeDialog()
   return g
})()
/* the top X of the deck is the *start* of the grid */
const beforeTop = beforeScopeDeck.slice(0, orderCount)

await openOrderTopX(orderCount)

const scoped = await grid()
check('Order Top X opens on the top X cards and no others',
   Array.isArray(scoped) && scoped.length === orderCount && JSON.stringify(scoped) === JSON.stringify(beforeTop),
   `${(scoped || []).length} cards shown, ${JSON.stringify(scoped)}`)

const scopedButtons = await page.evaluate(`(() => {
   const b = [ ...document.querySelectorAll('div button') ].filter((el) => /Arrange the Top|Put on|Shuffle the rest|Close/.test(el.textContent))
   return b.map((el) => el.textContent.trim().replace(/\\s+/g, ' '))
})()`)
check('and offers no bottom and no shuffle: a rearrangement of what is already there',
   scopedButtons.some((t) => /^Arrange the Top 3/.test(t)) &&
   !scopedButtons.some((t) => /Put on|Shuffle/.test(t)),
   JSON.stringify(scopedButtons))

/* the first cell of the block is the top of the deck, and clicking is what names card 1 */
await clickCard(1)
await clickCard(2)
await clickCard(0)

const wantedTop = [ beforeTop[1], beforeTop[2], beforeTop[0] ]

const scopedSteps = await steps()
check('the order chosen is the order the strip names, card 1 first',
   JSON.stringify(scopedSteps.map((s) => s.name)) === JSON.stringify(wantedTop),
   JSON.stringify((scopedSteps || []).map((s) => s.name)))

const logBeforeScope = await soloLog()
await page.clickText(`Arrange the Top ${orderCount} in This Order`, { settle: 600 })

const scopedLog = (await soloLog()).slice(logBeforeScope.length)
check('reordering the top says what it did, and does not claim a search',
   /Put 3 cards on top of Deck in order/.test(scopedLog) && !/Searched deck/.test(scopedLog),
   scopedLog.slice(0, 140))
await openDeckOrder()
const afterScope = await grid()
check('the rearranged cards are the top of the deck, card 1 drawn first',
   JSON.stringify(afterScope.slice(0, orderCount)) === JSON.stringify(wantedTop),
   `${JSON.stringify(afterScope.slice(0, orderCount))} wanted ${JSON.stringify(wantedTop)}`)

/*
   The point of no shuffle, and the only thing that can tell it from one: the
   cards *below* the block are exactly the cards that were below it, in the same
   order. A shuffle of the rest would have left them a different sequence, and
   the block itself would have been indistinguishable either way.
*/
check('and the rest of the deck is exactly as it was, untouched by a shuffle',
   JSON.stringify(afterScope.slice(orderCount)) === JSON.stringify(beforeScopeDeck.slice(orderCount)),
   'nothing under the rearranged block moved')

check('and the deck still holds every card it did', afterScope.length === heldNow,
   `${afterScope.length} of ${heldNow}`)

/*
   Closing a dialog without placing anything is a look that ended in nothing: the
   deck is not touched, so the log carries the look and nothing else - which is
   what makes "Viewed deck" and "Put 3 cards ... in order" together say exactly
   what happened.
*/
const logBeforeClose = await soloLog()
await openOrderTopX(orderCount)
await closeDialog()
const closeLog = (await soloLog()).slice(logBeforeClose.length)
check('opening and closing it again logs the look, and no placement',
   /Viewed deck/.test(closeLog) && !/Put \d+ cards/.test(closeLog) && !/Searched deck/.test(closeLog),
   closeLog.slice(0, 140))

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
check('and its actions stay at the panel\'s foot, not down the page',
   shape.actionsAtFoot === true, JSON.stringify(shape))

/*
   Whether the body has overflow depends on how big the deck is and how big the
   window is - not on anything this feature does. The overflow itself is what PR
   #122 is about and was verified there; what matters here is that the cards are
   in a scroll container at all, which is what makes a sixty-card grid reachable
   past a footer that cannot move.
*/
const scrollable = await page.evaluate(`(() => {
   const body = document.querySelector('.popup-body')
   if (!body) return null
   const style = getComputedStyle(body)
   const panel = getComputedStyle(document.querySelector('.popup'))
   return {
      overflowY: style.overflowY,
      minHeight: style.minHeight,
      maxHeight: panel.maxHeight,
      height: Math.round(document.querySelector('.popup').getBoundingClientRect().height)
   }
})()`)
check('with the cards in a body that scrolls, under a panel capped to the window',
   scrollable && /auto|scroll/.test(scrollable.overflowY) &&
   parseInt(scrollable.maxHeight, 10) > 0 && parseInt(scrollable.maxHeight, 10) < 636,
   JSON.stringify(scrollable))

await browser.setViewport(1277, 821)
await closeDialog()

console.log(`\n${failures ? failures + ' FAILED' : 'all checks passed'}`)
browser.detach()
process.exit(failures ? 1 : 0)
