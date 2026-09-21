/*
   Does the Active spot hold a fan of any length?

   The bug this is for: cards attached to the Active Pokemon used to spread the layout
   apart. The slot reserved room for its fan *in a line of fixed width* - the zone - so
   the margin grew with every card attached. Two things followed, and this check is one
   assertion each:

     * the Pokemon was pulled left with it, out of the zone it is in, and
     * once the margin was wider than the zone the slot itself was squeezed, and every
       attached card - clamped by the `max-width: 100%` the CSS reset puts on an image,
       to the box it is drawn in - came out *smaller than the step it was placed with*.
       A fan of small cards with gaps between them is the picture that was reported.

   What is asserted here, on a real board in a real browser, at several lengths of fan:

     1. the Pokemon does not move, whatever is attached to it - the place a lone card
        has in the zone is the place it keeps
     2. every attached card is exactly the size the Pokemon is: nothing the card is
        drawn in is allowed to resize it
     3. the fan stays inside the zone, however long it gets
     4. and the cards still overlap, in order, so what a long fan tightens into is a
        fan rather than a row of separated cards

   Needs what the other browser checks need: a dev server on BASE (default
   http://localhost:3005) with a stand-in deck API behind it (tools/fake-deck-api.mjs,
   through VITE_LIMITLESS_WEB - see tools/dev-servers.ps1) and a headless browser with
   CDP on CDP_PORTS (default 9222).

      node tools/fan-check.mjs
      node tools/fan-check.mjs --quiet

   The card images themselves are answered here rather than fetched: a stand-in deck's
   card names are ones no image host has, and an image that never loads has no height,
   which is a different board from the one this is about. The stand-in is a card-shaped
   PNG drawn in the page, so every measurement below is of a board that looks like the
   one a player uses.
*/
import { readFileSync } from 'node:fs'
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const quiet = process.argv.includes('--quiet')

/* lengths of fan to measure: the first few, and enough to be past the zone's room */
const COUNTS = [ 0, 1, 2, 3, 4, 6, 8, 12 ]

/* the stand-in deck is deterministic: Card01..Card60, pokemon/energy/trainer by number */
const KIND = (i) => (i % 3 === 0 ? 'energy' : (i % 2 === 0 ? 'trainer' : 'pokemon'))
const nameOf = (i) => 'Card' + String(i).padStart(2, '0')
const NUMBERS = [ ...Array(60) ].map((_, i) => i + 1)
const POKEMON = NUMBERS.filter((i) => KIND(i) === 'pokemon').map(nameOf)
const ENERGY = NUMBERS.filter((i) => KIND(i) === 'energy').map(nameOf)
const TRAINER = NUMBERS.filter((i) => KIND(i) === 'trainer').map(nameOf)

const MEASURE = `(() => {
   const zone = document.querySelector('.active1')
   const slot = zone && zone.querySelector('.slot')
   const rect = (el) => {
      const b = el.getBoundingClientRect()
      return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), right: +b.right.toFixed(2) }
   }
   if (!zone) return { error: 'no .active1 on the board' }
   if (!slot) return { error: 'no Pokemon in the Active Spot' }

   const imgs = [ ...slot.querySelectorAll('img.card') ]
   const pokemon = imgs.find((i) => i.classList.contains('pokemon'))
   const fan = imgs.filter((i) => i !== pokemon)

   return {
      zone: rect(zone),
      slot: rect(slot),
      slotMarginTop: getComputedStyle(slot).marginTop,
      attachLift: getComputedStyle(slot).getPropertyValue('--attach-lift').trim(),
      pokemon: pokemon ? { ...rect(pokemon), used: pokemon.clientWidth + 'x' + pokemon.clientHeight, complete: pokemon.complete } : null,
      fan: fan.map((i) => ({
         name: i.alt,
         ...rect(i),
         used: i.clientWidth + 'x' + i.clientHeight,
         attached: i.getAttribute('data-attached')
      }))
   }
})()`

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [page] = await browser.pages(1)
await browser.setViewport(1277, 821)
page.autoDialogs(true)
page.watchForErrors('fan')
await page.go(BASE, 500)

/* a card-shaped stand-in for every image the board asks for */
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

/*
   Answer every paused request, and answer *all* of them. `page.waitFor` is one
   waiter, and a board that draws several cards at once pauses several requests in the
   same turn of the event loop - the ones that arrive with no waiter registered are
   dropped, and a request nobody answers is a card that never finishes loading (which
   is how this check's first run measured a Pokemon with no height at all). So the
   events are queued here as they arrive, off the page's own message handling, and
   drained one at a time.
*/
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

const key = (k, code) => page.evaluate(`(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(code)}, bubbles: true }))
   return true
})()`)

/*
   Attach one card of the named kinds out of the hand to the Active Pokemon, the app's
   own way: click the card, press Q, click the Pokemon. Nothing else is ever attached -
   an energy and a tool are lifted by different amounts, so a card of the wrong kind
   would move the Pokemon for a reason this check is not measuring - and the deck is
   drawn from until it offers one.
*/
async function attachOne (names) {
   let picked = null

   for (let draw = 0; draw <= 6 && !picked; draw++) {
      const found = await page.evaluate(`(() => {
         const wanted = ${JSON.stringify(names)}
         const img = [ ...document.querySelectorAll('.hand img.card') ].find((i) => wanted.includes(i.alt))
         if (!img) return null
         img.click()
         return img.alt
      })()`)

      if (found) { picked = found; break }
      if (draw === 6) break
      await key('1', 'Digit1')
      await sleep(250)
   }

   if (!picked) return null

   await key('q', 'KeyQ')
   await sleep(150)
   const dropped = await page.evaluate(`(() => {
      const img = document.querySelector('.active1 .slot img.pokemon')
      if (!img) return false
      img.click()
      return true
   })()`)
   await sleep(400)
   return dropped ? picked : null
}

console.log(`fan check against ${BASE}`)

await page.reset(BASE)
await page.clickText('Play Solo', { settle: 2500 })
for (const deck of [ 'Edit Deck', 'Edit Deck 2' ]) {
   await page.clickText(deck, { settle: 900 })
   await page.clickText('Import Random Deck', { settle: 2500 })
   await sleep(400)
}
await page.clickText('Setup', { settle: 3000 })

const mode = (await page.counts()).mode
if (mode !== 'solo') {
   console.log(`  FAIL  the board did not come up in solo (mode: ${mode}) - is a deck stand-in behind the dev server?`)
   process.exit(1)
}

const placed = await page.evaluate(`(() => {
   const names = ${JSON.stringify(POKEMON)}
   const img = [ ...document.querySelectorAll('.hand img.card') ].find((i) => names.includes(i.alt))
   if (!img) return null
   img.click()
   return img.alt
})()`)
if (!placed) {
   console.log('  FAIL  no Basic Pokemon in hand to put in the Active Spot - is a deck stand-in behind the dev server?')
   process.exit(1)
}
await key('a', 'KeyA')
await sleep(800)

/*
   1. the place a lone card has. The Pokemon's *height* in the zone is not part of
   this: a card attached above it is a card reaching over its top, so the zone spends
   the lift as room and the Pokemon sits half a lift higher once it has a fan - which
   is one step, taken when the first card arrives, and not a thing that happens again
   with the second (see the note over `--attach-lift` in Slot.svelte).
*/
const alone = await page.evaluate(MEASURE)
if (alone.error) {
   console.log(`  FAIL  ${alone.error}`)
   process.exit(1)
}
if (!alone.pokemon.complete) {
   console.log('  FAIL  the Active Pokemon\'s own image never loaded - the stand-in behind this check is not answering')
   process.exit(1)
}

console.log(`\nthe Active spot: zone ${alone.zone.w}px wide, a card ${alone.pokemon.w}px (${alone.pokemon.used} drawn)`)
console.log('  fan   pokemon        attached cards         fan spans           inside the zone')

let attached = 0
let lifted = null
for (const count of COUNTS) {
   while (attached < count) {
      const got = await attachOne(ENERGY)
      if (!got) {
         console.log(`  (only ${attached} energy cards could be attached - the hand ran out)`)
         break
      }
      attached++
   }

   const m = await page.evaluate(MEASURE)
   if (m.error) { check(`${count} attached: ${m.error}`, false); continue }

   const sizes = [ ...new Set(m.fan.map((c) => c.used)) ]
   const span = m.fan.length
      ? `${m.fan[0].x.toFixed(0)}..${Math.max(...m.fan.map((c) => c.right)).toFixed(0)}`
      : '-'
   console.log(`  ${String(m.fan.length).padStart(3)}   ${m.pokemon.used.padEnd(14)}  ${(sizes.join(' ') || '-').padEnd(21)}  ${span.padEnd(18)}  zone ${m.zone.x.toFixed(0)}..${m.zone.right.toFixed(0)}`)
   if (!quiet) console.log(`       pokemon y ${m.pokemon.y} | zone y ${m.zone.y} h ${m.zone.h} | slot margin-top ${m.slotMarginTop} (--attach-lift: ${m.attachLift})`)

   if (m.fan.length && !lifted) lifted = m.pokemon.y

   check(`${count}: the Pokemon keeps the place a lone card has across the zone`,
      m.pokemon.x === alone.pokemon.x,
      `x ${m.pokemon.x} (alone ${alone.pokemon.x})`)

   check(`${count}: and keeps its height once it has a fan`,
      lifted === null || m.pokemon.y === lifted,
      `y ${m.pokemon.y} (with a fan ${lifted})`)

   check(`${count}: every attached card is the size the Pokemon is`,
      m.fan.every((c) => c.used === m.pokemon.used),
      `${sizes.join(' ') || '-'} against ${m.pokemon.used}`)

   check(`${count}: the fan stays inside the zone`,
      m.fan.every((c) => c.x >= m.zone.x - 0.5 && c.right <= m.zone.right + 0.5),
      span)

   check(`${count}: the cards still overlap, in order`,
      m.fan.every((c, i) => i === 0 || c.x < m.fan[i - 1].right - 0.5),
      m.fan.map((c) => c.x.toFixed(0)).join(' '))
}

/* and the same with the tallest fan there is: a tool is lifted higher than an energy */
let toolHeight = null
for (let tools = 1; tools <= 2; tools++) {
   const got = await attachOne(TRAINER)
   if (!got) { console.log('\n(no tool left in the hand to attach)'); break }

   const m = await page.evaluate(MEASURE)
   const mixed = m.fan.filter((c) => c.attached === 'trainer')
   console.log(`\nwith ${mixed.length} tool(s) attached: fan ${m.fan.length}, zone ${m.zone.x.toFixed(0)}..${m.zone.right.toFixed(0)}`)
   if (!toolHeight) toolHeight = m.pokemon.y
   check('a tool\'s card is the size the Pokemon is too',
      m.fan.every((c) => c.used === m.pokemon.used),
      [ ...new Set(m.fan.map((c) => c.used)) ].join(' '))
   check('and the mixed fan is still inside the zone',
      m.fan.every((c) => c.x >= m.zone.x - 0.5 && c.right <= m.zone.right + 0.5),
      m.fan.map((c) => `${c.name}@${c.x.toFixed(0)}..${c.right.toFixed(0)}`).join(' '))
   check('and the Pokemon still keeps the place a lone card has',
      m.pokemon.x === alone.pokemon.x,
      `x ${m.pokemon.x} (alone ${alone.pokemon.x})`)
   check('and keeps its height once a tool is on it',
      m.pokemon.y === toolHeight,
      `y ${m.pokemon.y} (with a tool ${toolHeight})`)
   check('and the cards still overlap in order',
      m.fan.every((c, i) => i === 0 || c.x < m.fan[i - 1].right - 0.5),
      m.fan.map((c) => c.x.toFixed(0)).join(' '))
}

serving = false
browser.detach()

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - the Active spot's fan is not holding its shape`)
   process.exit(1)
}
console.log('verdict: ok - the Active spot holds a fan of any length')
