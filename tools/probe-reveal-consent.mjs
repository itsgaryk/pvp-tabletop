/*
 * Probe: after a consented Reveal, does the deck's owner's board draw the window?
 *
 *   node tools/probe-consent-reveal.mjs
 *
 * Written while checking the consent gate on `Reveal Top X`, and kept because its answer is
 * not what the code reads like. It asks Alice to reveal two cards of Bob's deck, has Bob
 * accept, and then reports what each board has on it.
 *
 * What it found, and why it is worth keeping: **the reveal reaches the owner as an event and
 * not as a window.** Bob's log gains `Revealed [Darkness Energy, Darkness Energy] from the top
 * of the opponent's deck` - so `cardsRevealed` arrived and the relay did its job - and his
 * board has no `.popup` at all, while Alice's shows the reveal. Whether that is the intended
 * fan-out for this gesture or a fault in it is **not settled here**, and nothing about the
 * consent work changes it: the gate decides *whether* the gesture happens, not who is shown it
 * afterwards.
 *
 * `tools/consent-check.mjs` asserts the part that is the gate's business - that both boards
 * are told, through the log - and leaves the window alone.
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const browser = await attach()
const [alice, bob] = await browser.pages(2)
await browser.setViewport(1277, 821)
for (const page of [alice, bob]) page.autoDialogs(true)

const lobby = async (page, label) => {
   for (let i = 0; i < 8; i++) {
      await page.reset(BASE)
      if ((await page.counts()).mode === 'lobby') return
      await sleep(1500)
   }
   throw new Error(`${label} never reached the lobby`)
}

await Promise.all([lobby(alice, 'alice'), lobby(bob, 'bob')])
const room = await alice.createRoom('Alice', { format: 'expanded' })
await bob.joinRoom(room, 'Bob')
await alice.importDeck()
await bob.importDeck()
await alice.setup()
await bob.setup()
await sleep(3000)
console.log('room', room)

const report = (page) => page.evaluate(`(() => ({
   popups: [...document.querySelectorAll('.popup')].map((p) => ({
      text: p.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60),
      w: Math.round(p.getBoundingClientRect().width)
   })),
   log: [...document.querySelectorAll('.chat p')].map((p) => p.innerText).slice(-4)
}))()`)

const answerNumber = async (page, n) => {
   for (let i = 0; i < 40; i++) {
      if (await page.evaluate(`Boolean(document.querySelector('.number-dialog input'))`)) break
      await sleep(200)
   }
   await page.evaluate(`(() => {
      const input = document.querySelector('.number-dialog input')
      input.value = String(${n})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
   })()`)
   for (let i = 0; i < 20; i++) {
      const done = await page.evaluate(`(() => {
         const ok = document.querySelector('.number-dialog .ok')
         if (!ok) return 'gone'
         if (ok.disabled) return 'disabled'
         ok.click()
         return 'pressed'
      })()`)
      if (done !== 'disabled') return true
      await sleep(150)
   }
   return false
}

/* ask for a reveal of Bob's deck */
await alice.rightClick('.gameboard > .deck2 .pile')
await sleep(800)
await alice.evaluate(`(() => {
   const items = [ ...document.querySelectorAll('body > div.z-25 .item') ]
   const el = items.find((item) => item.textContent.trim().startsWith('Reveal Top X'))
   if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
   return Boolean(el)
})()`)
await sleep(800)
console.log('number answered:', await answerNumber(alice, 2))

for (let i = 0; i < 40; i++) {
   const up = await bob.evaluate(`Boolean(document.querySelector('.consent-dialog'))`)
   if (up) break
   await sleep(300)
}
console.log('bob asked:', await bob.evaluate(`Boolean(document.querySelector('.consent-dialog'))`))

await bob.clickText('Yes', { settle: 2500, kinds: 'button' })
await sleep(4000)

console.log('ALICE after:', JSON.stringify(await report(alice)))
console.log('BOB   after:', JSON.stringify(await report(bob)))

browser.detach()
