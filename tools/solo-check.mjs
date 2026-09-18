/*
 * Solo mode, seen through a real browser: what the board looks like before and
 * after the flip, and which cards can be selected / right-clicked on the far
 * half.
 *
 *   node tools/solo-check.mjs [--shots <dir>]
 *
 * Needs a dev server on BASE (default http://localhost:3005) and a headless
 * browser with CDP on CDP_PORTS (default 9222):
 *
 *   $chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *   Start-Process $chrome -ArgumentList '--headless=new','--disable-gpu',
 *      '--no-first-run','--no-default-browser-check','--remote-debugging-port=9222',
 *      "--user-data-dir=$env:TEMP\pvp-chrome-9222",'--window-size=1277,821','about:blank'
 */
import { writeFileSync } from 'node:fs'
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const argv = process.argv.slice(2)
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null

const ZONES = [
   'hand2', 'prizes2', 'deck2', 'discard2', 'lz2', 'bench2', 'play2', 'stadium2', 'active2',
   'play', 'stadium', 'active1', 'bench', 'lz', 'discard', 'deck', 'prizes', 'hand'
]

/*
   Orientation, read off the DOM rather than off a picture: the transform that
   actually reaches each image is its own matrix composed with every ancestor's.
   A net 180 (trace < 0, determinant > 0) is a card rendered upside down - which
   is exactly the class of bug the flip has to be judged by, on both halves.
*/
const ORIENT = `(() => {
   const parse = (t) => {
      if (!t || t === 'none') return [1, 0, 0, 1]
      const m = t.match(/matrix\\(([^)]+)\\)/)
      if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p[3]] }
      const m3 = t.match(/matrix3d\\(([^)]+)\\)/)
      if (m3) { const p = m3[1].split(',').map(Number); return [p[0], p[1], p[4], p[5]] }
      return [1, 0, 0, 1]
   }
   const mul = (a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3]
   ]
   const chain = (el) => {
      const path = []
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) path.push(n)
      let m = [1, 0, 0, 1]
      for (const n of path.reverse()) m = mul(m, parse(getComputedStyle(n).transform))
      return m
   }
   const kind = (el) => {
      const m = chain(el)
      const det = m[0] * m[3] - m[1] * m[2]
      const trace = m[0] + m[3]
      if (det < 0) return 'mirrored'
      return trace < 0 ? 'upside-down' : 'upright'
   }
   window.__kind = kind
   const board = document.querySelector('.gameboard')
   /* the zone cells themselves: .prizes also names a grid inside one of them */
   const cell = (zone) => document.querySelector('.gameboard > .' + zone) ||
      document.querySelector('.active > .' + zone)
   const out = {}
   for (const zone of ${JSON.stringify(ZONES)}) {
      const el = cell(zone)
      if (!el) { out[zone] = null; continue }
      const imgs = [...el.querySelectorAll('img.card')]
      const own = getComputedStyle(el).transform
      out[zone] = {
         container: own === 'none' ? 'none' : own,
         cards: imgs.length,
         upsideDown: imgs.filter((i) => kind(i) === 'upside-down').length,
         first: imgs.length ? {
            kind: kind(imgs[0]),
            src: (imgs[0].getAttribute('src') || '').split('/').pop().slice(0, 28)
         } : null,
         counts: [...el.querySelectorAll('.count, .counter, .marker, .ability-stripe')]
            .map((c) => c.className.split(' ')[0] + ':' + kind(c))
      }
   }
   /* the two overlapping piles that share a grid cell: which one is on top */
   const zOf = (sel) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el).zIndex + '/' + getComputedStyle(el).pointerEvents : null
   }
   return {
      board: board ? getComputedStyle(board).transform : null,
      zones: out,
      stack: { play: zOf('.play'), play2: zOf('.play2'), stadium: zOf('.stadium'), stadium2: zOf('.stadium2') }
   }
})()`

const browser = await attach()
const [page] = await browser.pages(1)
await browser.setViewport(1277, 821)
page.autoDialogs(true)
page.watchForErrors('solo')

async function shot (name) {
   const res = await page.send('Page.captureScreenshot', { format: 'png' })
   const file = `${SHOTS}/${name}.png`
   writeFileSync(file, Buffer.from(res.data, 'base64'))
   console.log(`  shot ${file}`)
}

console.log(`solo check against ${BASE}`)
await page.reset(BASE)

console.log('\nsetup')
await page.clickText('Play Solo', { settle: 2500 })
console.log('  mode:', (await page.counts()).mode)

await page.importDeck('Edit Deck')
await page.importDeck('Edit Deck 2')
await page.clickText('Setup', { settle: 2500 })

const show = (label, snap) => {
   console.log(`\n${label}`)
   console.log(`  board transform: ${snap.board}`)
   console.log(`  stack: play=${snap.stack.play} play2=${snap.stack.play2} stadium=${snap.stack.stadium} stadium2=${snap.stack.stadium2}`)
   console.log('  zone           cards  upside-down  container-transform')
   for (const zone of ZONES) {
      const z = snap.zones[zone]
      if (!z) { console.log(`  ${zone.padEnd(14)} -`); continue }
      console.log(`  ${zone.padEnd(14)} ${String(z.cards).padStart(5)}  ${String(z.upsideDown).padStart(11)}  ${z.container}`)
      if (z.counts.length) console.log(`  ${''.padEnd(14)} counters: ${z.counts.join(', ')}`)
   }
}

const before = await page.evaluate(ORIENT)
show('BEFORE FLIP', before)
if (SHOTS) await shot('solo-before-flip')

/* the flip button is the one with the aria-label, not the coin */
const flipped = await page.evaluate(`(() => {
   const b = document.querySelector('button[aria-label="Flip Board"]')
   if (!b) return false
   b.click()
   return true
})()`)
console.log(`\nflip clicked: ${flipped}`)
await sleep(1200)

const after = await page.evaluate(ORIENT)
show('AFTER FLIP', after)
if (SHOTS) await shot('solo-after-flip')

browser.detach()
