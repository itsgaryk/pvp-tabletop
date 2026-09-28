/*
 * Does a new game clear the **opponent's** half of the board?
 *
 *   node tools/new-game-clear-check.mjs
 *
 * Needs a dev server on BASE and browsers on CDP_PORTS - see tools/browser-check.mjs for
 * how the stack is started. It uses the URL queries browser-check uses, so the two cannot
 * disagree about which side of the screen is whose.
 *
 * The report this exists for: *in the current preview New Game doesn't clear the
 * opponent's side of the board*. `browser-check.mjs`'s own `newgame` section reads only
 * each player's own zones (`.deck`, `.hand`, `.prizes`), so an opponent half left behind
 * was invisible to it - which is why this measures both halves, on both screens.
 *
 * `.gameboard-board1` and `.gameboard-board2` are the two players' halves of the board the
 * page is drawing, in the order the board lays them out (see `Board.svelte`).
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const browser = await attach()
const [alice, bob, watcher] = await browser.pages(3)
await browser.setViewport(1277, 821)
for (const page of [alice, bob, watcher]) page.autoDialogs(true)
for (const [name, page] of [['alice', alice], ['bob', bob], ['watcher', watcher]]) page.watchForErrors(name)

const lobby = async (page, label) => {
   for (let i = 0; i < 8; i++) {
      await page.reset(BASE)
      if ((await page.counts()).mode === 'lobby') return
      console.log(`  ${label}: not up yet, reloading`)
      await sleep(1500)
   }
   throw new Error(`${label} never reached the lobby`)
}

/*
   Both players' zones as this page draws them, counted as **cards on screen** rather than
   read from a pile's badge: a badge reports the pile, which is the owner's own state and
   can be right while the half beside it still has cards drawn on it. What the report is
   about is what is on screen.

   `.deck`/`.hand`/`.prizes` are the near half's zones and `.deck2`/`.hand2`/`.prizes2` the
   far half's - the `2` suffix is the only difference between the halves (see docs/board.md)
   - so reading both sets on one page is reading both players' boards.
*/
const zoneCounts = (page) => page.evaluate(`(() => {
   const count = (sel) => document.querySelectorAll(sel).length
   return {
      nearDeck: count('.deck img.card'), nearHand: count('.hand img.card'), nearPrizes: count('.prizes img.card'),
      farDeck: count('.deck2 img.card'), farHand: count('.hand2 img.card'), farPrizes: count('.prizes2 img.card'),
      nearBench: count('.bench img.card'), farBench: count('.bench2 img.card'),
      nearActive: count('.active1 img.card'), farActive: count('.active2 img.card')
   }
})()`)

const anyCards = (c) => Object.values(c).some((n) => n > 0)

const menuEntry = async (page) => {
   const press = () => page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || el.title) === 'Settings')
      if (!b) return false
      b.click()
      return true
   })()`)
   const blocks = () => page.evaluate(`document.querySelectorAll('.setting').length`)

   if (!(await press())) return null
   await sleep(700)
   if (!(await blocks())) { await press(); await sleep(700) }

   const entry = await page.evaluate(`(() => {
      const block = [...document.querySelectorAll('.setting')].find((b) => b.querySelector('.title')?.textContent.trim() === 'New Game')
      if (!block) return null
      const button = block.querySelector('button')
      return { disabled: button ? button.disabled : null, hint: block.querySelector('.hint')?.textContent.trim() || null }
   })()`)

   if (await blocks()) { await press(); await sleep(400) }
   return entry
}

const startNewGame = async (page) => {
   const press = () => page.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || el.title) === 'Settings')
      if (!b) return false
      b.click()
      return true
   })()`)
   const blocks = () => page.evaluate(`document.querySelectorAll('.setting').length`)

   if (!(await press())) return false
   await sleep(700)
   if (!(await blocks())) { await press(); await sleep(700) }

   return page.evaluate(`(() => {
      const block = [...document.querySelectorAll('.setting')].find((b) => b.querySelector('.title')?.textContent.trim() === 'New Game')
      const button = block ? block.querySelector('button') : null
      if (!button) return false
      button.click()
      return true
   })()`)
}

const promptWhenUp = async (page) => {
   for (let i = 0; i < 40; i++) {
      const seen = await page.evaluate(`Boolean(document.querySelector('.new-game-dialog'))`)
      if (seen) return true
      await sleep(400)
   }
   return false
}

console.log(`new game clears the whole board, against ${BASE}`)

await Promise.all([lobby(alice, 'alice'), lobby(bob, 'bob'), lobby(watcher, 'watcher')])

const room = await alice.createRoom('Alice', { format: 'expanded' })
await bob.joinRoom(room, 'Bob')
await watcher.spectate(room, 'Watcher')
await alice.importDeck()
await bob.importDeck()
await alice.setup()
await bob.setup()
await sleep(3000)
console.log(`  room ${room}`)

/* something on both halves of every screen, which is what a new game has to clear */
const before = {
   alice: await zoneCounts(alice),
   bob: await zoneCounts(bob),
   watcher: await zoneCounts(watcher)
}
check('every screen starts with cards on both halves',
   anyCards(before.alice) && anyCards(before.bob) && anyCards(before.watcher),
   JSON.stringify(before))

const entry = await menuEntry(alice)
check('the New Game entry is pressable', entry !== null && entry.disabled === false, JSON.stringify(entry))

check('the asker can raise it', (await startNewGame(alice)) === true)
check('the other player is asked', (await promptWhenUp(bob)) === true)

await bob.clickText('Yes', { settle: 3000, kinds: 'button' })
await sleep(4000)

const after = {
   alice: await zoneCounts(alice),
   bob: await zoneCounts(bob),
   watcher: await zoneCounts(watcher)
}

check('the asker\'s board is cleared - both halves', !anyCards(after.alice), JSON.stringify(after.alice))
check('the answering player\'s board is cleared - both halves', !anyCards(after.bob), JSON.stringify(after.bob))
check('and the watcher\'s, which draws both players', !anyCards(after.watcher), JSON.stringify(after.watcher))

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exit(failures ? 1 : 0)
