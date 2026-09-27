/*
   The pile windows, in a real browser: does every pile's view say what
   `util/piles.js` says it should?

   The table is the one place a pile's name, colour and move buttons are decided, and
   two windows read it - `Inspection.svelte` for the player's own half and
   `OppInspection.svelte` for the other. So this opens all seven piles on both halves
   in solo (where one person can reach every one of them) and checks what the panel
   actually draws against the table itself, rather than against a second copy of it
   written here.

   Seven piles x two halves is why this is a check and not a sentence in a PR: the
   headings are data, and data goes wrong quietly. The one it was written for is the
   far half's view, which had **no heading at all** until the table was introduced -
   so a view of their discard and a view of their prizes were the same panel with
   different cards in it.

   **There is no single opener for all of them, and that is the finding this check
   records rather than hides.** *View All* is on the deck, discard, lost zone and
   table menus, on the opponent's prizes too, and on the opponent's deck in solo -
   but **not** on either hand menu and **not** on either Stadium. Two piles have no
   *View All* anywhere while still having a view, so each row below names the opener
   that actually exists for it. Where a pile has no opener this check can drive, it
   says so - a silent skip would read as coverage it does not have.

   What it asserts, per pile per half:
      the heading names the pile the table names, and carries its accent colour
      the heading counts the cards the panel is holding
      the own half's deck view offers the table's four destinations, word for word
      every other view offers no move buttons at all
      Close is always there, and Close & Shuffle only on the deck's own view

   NOT here, deliberately: `movedTo`'s destinations are checked as *wording and
   order*, not by pressing them. Pressing one moves cards and closes the panel, which
   is the business of `tools/solo-check.mjs`; what this owns is that the table and the
   panel agree about what is offered.

     node tools/pile-window-check.mjs [--shots <dir>]

   Needs a dev server on BASE (default http://localhost:3005) serving **this**
   worktree, and a headless browser with CDP on CDP_PORTS (default 9222). Run the
   whole block with `powershell -File tools/dev-servers.ps1 -BasePort <n>`, or start
   vite directly with `npm run dev -- --port <free port>`; check the served module's
   own path before trusting a result, because `-BasePort`'s app port may be taken by
   another session and vite then moves to the next free one.
*/
import { writeFileSync } from 'node:fs'
import { attach, sleep } from './browser.mjs'

/* the table's own values, so a change to it is a change to what this expects */
import { PILE_NAMES, PILE_WINDOWS } from '../src/lib/util/piles.js'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const argv = process.argv.slice(2)
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null

/* the zone each pile is drawn in, on each half */
const ZONE = {
   deck: 'deck',
   hand: 'hand',
   discard: 'discard',
   lz: 'lz',
   prizes: 'prizes',
   table: 'play',
   stadium: 'stadium'
}

/*
   How each pile's view is actually opened, per half. `viewAll` takes the menu's own
   entry; `card` clicks a card in the zone; `stack` double-clicks the table's stack.
   The label is what a failure prints, so it says which route was tried.
*/
const OPENERS = {
   own: {
      deck: { how: 'viewAll', label: 'the Deck menu\'s View All' },
      discard: { how: 'viewAll', label: 'the Discard menu\'s View All' },
      lz: { how: 'viewAll', label: 'the Lost Zone menu\'s View All' },
      table: { how: 'key', key: 'w', label: 'the W key, the table\'s documented read' },
      hand: { how: 'none', label: 'neither hand menu has a View All' },
      prizes: { how: 'none', label: 'the Prizes menu has Inspect Prizes, which opens the selection pick-up, not this view' },
      stadium: { how: 'none', label: 'no Stadium menu has a View All' }
   },
   far: {
      deck: { how: 'viewAll', label: 'the opponent Deck menu\'s View All (solo only)' },
      hand: { how: 'none', label: 'neither hand menu has a View All' },
      discard: { how: 'viewAll', label: 'the opponent Discard menu\'s View All' },
      lz: { how: 'viewAll', label: 'the opponent Lost Zone menu\'s View All' },
      prizes: { how: 'viewAll', label: 'the opponent Prizes menu\'s View All' },
      table: { how: 'viewAll', label: 'the opponent Table menu\'s View All' },
      stadium: { how: 'none', label: 'no Stadium menu has a View All' }
   }
}

let failures = 0
let skipped = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* the heading and buttons of whatever pile panel is open, or null when none is */
const READ_PANEL = `(() => {
   const popup = document.querySelector('.popup')
   const zone = popup && popup.querySelector('.zone')
   if (!zone) return null

   const toHex = (value) => {
      const probe = document.createElement('div')
      probe.style.color = value
      document.body.appendChild(probe)
      const rgb = getComputedStyle(probe).color
      probe.remove()
      const m = rgb.match(/\\d+/g)
      if (!m) return rgb
      return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
   }

   return {
      label: zone.querySelector('.font-bold')?.textContent.trim() || null,
      swatch: toHex(getComputedStyle(zone.querySelector('.swatch')).backgroundColor),
      countText: zone.querySelector('.count')?.textContent.trim() || null,
      buttons: [...popup.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean),
      moves: [...popup.querySelectorAll('button.action')].map((b) => b.textContent.trim())
   }
})()`

const clickPanelButton = (text) => `(() => {
   const popup = document.querySelector('.popup')
   if (!popup) return 'no panel'
   const hit = [...popup.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
   if (!hit) return 'no ' + ${JSON.stringify(text)} + ' button'
   hit.click()
   return 'clicked'
})()`

/* right-click a zone's pile, which is how most of these menus are opened */
const openZoneMenu = (selector) => `(() => {
   const cell = document.querySelector(${JSON.stringify(selector)})
   if (!cell) return 'no cell ' + ${JSON.stringify(selector)}
   const pileEl = cell.querySelector('.pile') || cell
   const r = pileEl.getBoundingClientRect()
   pileEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, clientX: Math.round(r.left + 5), clientY: Math.round(r.top + 5)
   }))
   return 'ok'
})()`

const clickMenuItem = (text) => `(() => {
   const hit = [...document.querySelectorAll('[class*="item"]')]
      .find((el) => el.textContent.trim().startsWith(${JSON.stringify(text)}))
   if (!hit) return false
   hit.click()
   return true
})()`

/*
   The table's read is a key rather than a menu entry, and it is the only opener that
   works on an empty table: the stack's own double click is a gesture on cards that
   are not there, which is exactly how this check first failed.
*/
const pressKey = (key) => `(() => {
   document.dispatchEvent(new KeyboardEvent('keydown', {
      key: ${JSON.stringify(key)}, bubbles: true, cancelable: true
   }))
   return 'ok'
})()`

const browser = await attach()
const [page] = await browser.pages(1)
await browser.setViewport(1277, 821)
page.autoDialogs(true)
page.watchForErrors('pile')
await page.reset(BASE)

console.log(`pile window check against ${BASE}`)

/*
   Which worktree is actually being served. `-BasePort`'s app port can be taken by
   another session, and vite then binds the next free one - which has already put a
   check of this very table against a sibling session's server once.
*/
const served = await page.evaluate(`fetch('/src/lib/play/dialogs/OppInspection.svelte')
   .then((r) => r.text())
   .then((t) => (t.match(/\\*\\s*(C:[^*]+?) generated/) || [])[1] || 'unknown')
   .catch(() => 'unreachable')`)
console.log(`  serving: ${served}`)

console.log('\nsetup (solo, both halves dealt)')
await page.clickText('Play Solo', { settle: 2500 })
await page.importDeck('Edit Deck')
await page.importDeck('Edit Deck 2')
await page.clickText('Setup', { settle: 2500 })
const mode = (await page.counts()).mode
console.log(`  mode: ${mode}`)
check('the board is in solo, so both halves are playable', mode === 'solo', mode)

/* open one pile's view on one half and read what it drew */
async function inspect (pile, half) {
   const opener = OPENERS[half][pile]
   const selector = '.' + ZONE[pile] + (half === 'far' ? '2' : '')

   if (opener.how === 'none') return { unopenable: opener.label }

   if (opener.how === 'viewAll') {
      const opened = await page.evaluate(openZoneMenu(selector))
      if (opened !== 'ok') return { error: opened }
      await sleep(400)
      if (!(await page.evaluate(clickMenuItem('View All')))) {
         await page.evaluate(`document.body.click()`)
         return { error: `no View All: ${opener.label}` }
      }
   } else if (opener.how === 'key') {
      await page.evaluate(pressKey(opener.key))
   } else {
      return { error: `unknown opener "${opener.how}" for ${pile}` }
   }

   await sleep(900)
   const panel = await page.evaluate(READ_PANEL)

   if (panel && SHOTS) {
      const res = await page.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`${SHOTS}/${pile}-${half}.png`, Buffer.from(res.data, 'base64'))
   }

   if (panel) await page.evaluate(clickPanelButton('Close'))
   await sleep(500)
   return { panel }
}

for (const pile of PILE_NAMES) {
   const expected = PILE_WINDOWS[pile]

   for (const half of ['own', 'far']) {
      const where = `${pile} on the ${half} half`
      const { panel, error, unopenable } = await inspect(pile, half)

      if (unopenable) {
         skipped++
         console.log(`  SKIP  ${where}: no opener in the UI - ${unopenable}`)
         continue
      }

      if (error || !panel) {
         check(`${where}: the view opens`, false, error || 'no pile panel was drawn')
         continue
      }

      check(`${where}: open, named "${expected.label}"`,
         panel.label === expected.label,
         `drew "${panel.label}", table says "${expected.label}"`)
      check(`${where}: wears the table's colour ${expected.accent}`,
         panel.swatch === expected.accent,
         `drew ${panel.swatch}`)
      check(`${where}: the count is a number of cards`,
         /^\d+\s+cards?$/.test(panel.countText || ''),
         `drew "${panel.countText}"`)
      check(`${where}: Close is offered`,
         panel.buttons.includes('Close'),
         panel.buttons.join(', '))

      const wants = expected.movedTo.map((m) => m.moveLabel)
      const moves = panel.moves.filter((m) => m !== 'Close' && m !== 'Close & Shuffle')

      if (half === 'own' && pile === 'deck') {
         check(`${where}: offers the table's destinations in order`,
            moves.slice(0, wants.length).join(' | ') === wants.join(' | '),
            `drew [${moves.join(' | ')}], table says [${wants.join(' | ')}]`)
         check(`${where}: and Close & Shuffle, which only this view has`,
            panel.buttons.includes('Close & Shuffle'),
            panel.buttons.join(', '))
      } else {
         check(`${where}: offers no move buttons`, moves.length === 0, moves.join(', ') || 'none')
         check(`${where}: and no Close & Shuffle`,
            !panel.buttons.includes('Close & Shuffle'), panel.buttons.join(', '))
      }
   }
}

/* the CDP socket keeps node alive, so it has to be closed before the verdict prints */
browser.detach()

console.log('')
if (skipped) console.log(`(${skipped} pile/half pairs have no opener in the UI and were skipped by name above)`)
if (failures) {
   console.log(`verdict: ${failures} failed - a pile window and util/piles.js disagree about that pile`)
   process.exit(1)
}
console.log('verdict: ok - every pile a window can be opened on draws the table\'s name, colour and buttons')
