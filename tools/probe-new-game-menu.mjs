/*
   Probe: whether the settings menu's own block is read correctly, and whether a disabled
   New Game entry can be pressed. Written while the browser check's `newgame` section was
   reporting the entry as missing; kept out of `src/` because nothing on a board wants it.
*/
import { attach, sleep } from './tools/browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

const browser = await attach()
const [alice] = await browser.pages(1)
await browser.setViewport(1277, 821)
alice.autoDialogs(true)
alice.socket.addEventListener('message', (event) => {
   let message
   try { message = JSON.parse(event.data) } catch { return }
   if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails
      console.log('  [THROW]', (d.exception?.description || d.text || '').slice(0, 400))
   }
   if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const args = (message.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      console.log('  [error]', args.slice(0, 300))
   }
})

for (let i = 0; i < 6; i++) {
   await alice.reset(BASE)
   if ((await alice.counts()).mode === 'lobby') break
   await sleep(1200)
}

const room = await alice.createRoom('Alice', { format: 'expanded' })
await sleep(3000)
console.log('room', room, 'mode', (await alice.counts()).mode)

const read = () => alice.evaluate(`(() => ({
   settings: document.querySelectorAll('.setting').length,
   titles: [...document.querySelectorAll('.setting .title')].map((el) => el.textContent.trim()),
   block: (() => {
      const b = [...document.querySelectorAll('.setting')].find((x) => x.querySelector('.title')?.textContent.trim() === 'New Game')
      if (!b) return null
      const button = b.querySelector('button')
      return {
         disabled: button?.disabled ?? null,
         cursor: button ? getComputedStyle(button).cursor : null,
         hint: b.querySelector('.hint')?.textContent.trim() || null
      }
   })(),
   cog: [...document.querySelectorAll('button')].filter((el) => (el.getAttribute('aria-label') || el.title) === 'Settings').length
}))()`)

console.log('before opening', JSON.stringify(await read()))
await alice.evaluate(`(() => {
   const cog = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || el.title) === 'Settings')
   if (cog) cog.click()
   return true
})()`)
await sleep(1200)
console.log('after opening ', JSON.stringify(await read()))

/* the press a disabled entry must not answer */
const pressed = await alice.evaluate(`(() => {
   const b = [...document.querySelectorAll('.setting')].find((x) => x.querySelector('.title')?.textContent.trim() === 'New Game')
   const button = b ? b.querySelector('button') : null
   if (!button) return 'no button'
   button.click()
   return Boolean(document.querySelector('.new-game-dialog'))
})()`)
console.log('pressing the greyed-out entry opened a prompt?', pressed)

browser.detach()
