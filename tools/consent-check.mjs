/*
 * The other player has to consent before their cards are read.
 *
 *   node tools/consent-check.mjs
 *
 * Needs a dev server on BASE and browsers on CDP_PORTS - the stack tools/browser-check.mjs
 * documents. Two players and a watcher.
 *
 * Three gestures read cards out of a pile their owner is not shown, and all three now ask
 * first: **Look** at their deck, **Reveal** cards of theirs, and **Reveal Hand**. What is
 * checked here is the exchange itself - who is asked, that a *No* stops the gesture dead,
 * and that a *Yes* performs exactly the gesture that was asked about - and not the windows,
 * which `tools/reveal-check.mjs` is about.
 *
 * The card contents are read from the **owner's** screen as well as the asker's: a Look's
 * cards are the looker's and the watchers', and the deck's owner must be told that a look
 * happened without being told what was in it. A consent dialog that leaked "yes, you may
 * look at these three" would be a worse bug than the one this feature fixes.
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
for (const [name, page] of [['alice', alice], ['bob', bob], ['watcher', watcher]]) {
   page.watchForErrors(name)
}

const lobby = async (page, label) => {
   for (let i = 0; i < 8; i++) {
      await page.reset(BASE)
      if ((await page.counts()).mode === 'lobby') return
      await sleep(1500)
   }
   throw new Error(`${label} never reached the lobby`)
}

/* the consent dialog, whichever player is looking at it */
const dialog = (page) => page.evaluate(`(() => {
   const box = document.querySelector('.consent-dialog')
   if (!box) return null
   return {
      title: box.querySelector('.consent-title')?.textContent.trim() || null,
      text: box.innerText.replace(/\\s+/g, ' ').trim(),
      buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim())
   }
})()`)

const dialogWhenUp = async (page, { timeout = 20000 } = {}) => {
   const deadline = Date.now() + timeout
   for (;;) {
      const seen = await dialog(page)
      if (seen) return seen
      if (Date.now() > deadline) return null
      await sleep(300)
   }
}

const dialogGone = async (page, { timeout = 20000 } = {}) => {
   const deadline = Date.now() + timeout
   for (;;) {
      if ((await dialog(page)) === null) return true
      if (Date.now() > deadline) return false
      await sleep(300)
   }
}

/* the windows a reveal opens: the looker's own, and the log line both players share */
const openWindows = (page) => page.evaluate(`[...document.querySelectorAll('.popup')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80))`)

/*
   Answer the board's own number prompt. `View Top X` asks how many cards before it does
   anything, and that prompt is the board's own dialog (`dialogs/NumberPrompt.svelte`) rather
   than the browser's `window.prompt`.

   The digits go in through the input's own `input` event, and then the OK button is waited
   for: it is `disabled={!ready}` and a disabled button swallows a synthetic click without a
   word, so pressing it before Svelte has re-enabled it does nothing at all - the dialog stays
   up, no consent is ever asked for, and every check below fails for a reason that has nothing
   to do with consent. Waiting for `!disabled` is the whole fix.
*/
const answerNumber = async (page, n) => {
   let found = false
   for (let i = 0; i < 40 && !found; i++) {
      found = await page.evaluate(`Boolean(document.querySelector('.number-dialog input'))`)
      if (!found) await sleep(200)
   }
   if (!found) return false

   await page.evaluate(`(() => {
      const input = document.querySelector('.number-dialog input')
      input.value = String(${n})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
   })()`)

   for (let i = 0; i < 20; i++) {
      const pressed = await page.evaluate(`(() => {
         const ok = document.querySelector('.number-dialog .ok')
         if (!ok) return 'gone'
         if (ok.disabled) return 'disabled'
         ok.click()
         return 'pressed'
      })()`)
      if (pressed === 'pressed' || pressed === 'gone') return true
      await sleep(150)
   }

   return false
}

/* right-click the opponent's deck and take an entry */
const deckMenu = async (page) => {
   await page.rightClick('.gameboard > .deck2 .pile')
   await sleep(800)
   return page.evaluate(`[...document.querySelectorAll('body > div.z-25 .item')].map((el) => el.textContent.trim())`)
}

const clickEntry = async (page, label) => {
   const hit = await page.evaluate(`(() => {
      const items = [ ...document.querySelectorAll('body > div.z-25 .item') ]
      const el = items.find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}))
      if (!el) return false
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return true
   })()`)
   await sleep(700)
   return hit
}

console.log(`consent before another player's cards are read, against ${BASE}`)

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

/* ---------------------------------------------------------------- a look --- */

const menu = await deckMenu(alice)
check('the opponent\'s deck offers View Top X', menu.some((t) => t.startsWith('View Top X')), JSON.stringify(menu))

/*
   The entry asks how many cards *first*, and the ask only goes out once that is answered:
   so the click opens the number prompt, and answering it is what makes the gesture. The
   order matters - clearing the prompt before the click that raises it waits for a dialog
   that is not there yet.
*/
const asked = await clickEntry(alice, 'View Top X')
check('clicking it asks how many cards first', asked)
const answered = await answerNumber(alice, 3)
check('and answering that is what makes the gesture', answered === true)

console.log('  [debug] after answering', JSON.stringify(await alice.evaluate(`(() => ({
   consent: Boolean(document.querySelector('.consent-dialog')),
   number: Boolean(document.querySelector('.number-dialog input')),
   menu: document.querySelectorAll('body > div.z-25 .item').length,
   popups: document.querySelectorAll('.popup').length
}))()`)))

/*
   The two screens are not the same question: the player who asked is told the table is
   waiting and is given nothing to press; the deck's owner is the one who answers.
*/
const aliceWaiting = await dialogWhenUp(alice)
const bobAsked = await dialogWhenUp(bob)

check('the player who asked is told the other player is being asked',
   /waiting for opponent to allow/i.test(aliceWaiting?.title || ''), JSON.stringify(aliceWaiting))
check('and has nothing to press - the click was the ask',
   JSON.stringify(aliceWaiting?.buttons) === JSON.stringify([]), JSON.stringify(aliceWaiting?.buttons))
check('the deck\'s owner is asked, with a Yes and a No',
   JSON.stringify(bobAsked?.buttons) === JSON.stringify(['Yes', 'No']), JSON.stringify(bobAsked))
check('and the question is about their deck',
   /deck/i.test(bobAsked?.text || ''), JSON.stringify(bobAsked))

/* --- a No stops it --- */

await bob.clickText('No', { settle: 2000, kinds: 'button' })

/*
   The notice is read **first and straight away**, because it is a message that fades on its
   own after a couple of seconds - and asking whether it is up a few seconds later asks about
   a toast that has already gone, which is a check that can only fail.
*/
const noticed = await (async () => {
   for (let i = 0; i < 25; i++) {
      const text = await alice.evaluate(`(() => {
         const el = document.querySelector('.alert')
         return el ? el.textContent.trim() : null
      })()`)
      if (text) return text
      await sleep(150)
   }
   return null
})()

check('a No opens no window on the player who asked', (await openWindows(alice)).length === 0, JSON.stringify(await openWindows(alice)))
check('and the player who asked is told', /did not allow/i.test(noticed || ''), JSON.stringify(noticed))
check('and clears both dialogs',
   (await dialog(alice)) === null && (await dialog(bob)) === null,
   JSON.stringify({ alice: await dialog(alice), bob: await dialog(bob) }))

/* --- a Yes performs it --- */

/*
   The whole gesture again, in the order the board asks for it: the menu entry, then the
   count, and the ask only after that. Reopening the menu is part of it - the first one went
   away when the look was asked about, so clicking an entry without opening the menu first
   clicks nothing at all.
*/
await deckMenu(alice)
const askedAgain = await clickEntry(alice, 'View Top X')
check('the player can ask again', askedAgain === true)
check('and answering the count is what asks', (await answerNumber(alice, 3)) === true)

const aliceWaitingAgain = await dialogWhenUp(alice)
const bobAskedAgain = await dialogWhenUp(bob)
check('asking again asks again, rather than remembering', aliceWaitingAgain !== null && bobAskedAgain !== null,
   JSON.stringify({ alice: aliceWaitingAgain?.title, bob: bobAskedAgain?.title }))

await bob.clickText('Yes', { settle: 2500, kinds: 'button' })
await sleep(3000)

const looked = await openWindows(alice)
check('a Yes opens the window on the player who asked', looked.some((t) => /Look|cards/i.test(t)), JSON.stringify(looked))
check('and clears the dialogs', (await dialog(alice)) === null && (await dialog(bob)) === null)

/*
   The owner is told the gesture happened, and not what it found: a look's cards are the
   looker's and the watchers'.
*/
const bobLog = await bob.evaluate(`[...document.querySelectorAll('.chat p')].map((p) => p.innerText)`)
const bobWindows = await openWindows(bob)
check('the deck\'s owner is told a look happened', bobLog.some((line) => /Looked at the top/i.test(line)), JSON.stringify(bobLog.slice(-4)))
check('and what it found is not on their screen', bobWindows.length === 0, JSON.stringify(bobWindows))

browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exit(failures ? 1 : 0)

