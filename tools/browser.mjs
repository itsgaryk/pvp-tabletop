/*
   Drive several real browser pages at once, to test what two players and a
   spectator do together.

   Why this exists: every bug in the spectator area - a board that emptied, a
   board that never filled, halves swapping - was invisible to a test that could
   hold one browser, and a node client standing in for a player is not the
   browser bundle being tested. This is the missing piece.

   It does **not** launch browsers. That is deliberate, and it is the lesson from
   two failed attempts: a helper that spawned its own Edge instances made Edge
   assert ("a breakpoint has been reached"), and one that multiplexed several
   pages over a single CDP connection dropped the connection on every command.

   So one browser per page, started outside, and this attaches to each. The
   arrangement is the one every working check in this project has used.

      # from the shell, one browser per page you need
      $edge = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
      foreach ($port in 9222, 9223, 9224) {
         $profile = Join-Path $env:TEMP "pvp-edge-$port"
         New-Item -ItemType Directory -Force -Path $profile | Out-Null
         Start-Process -FilePath $edge -ArgumentList '--headless=new','--disable-gpu',
            '--no-first-run','--no-default-browser-check',"--remote-debugging-port=$port",
            "--user-data-dir=$profile",'--window-size=1277,821','about:blank'
      }

      import { attach } from './browser.mjs'

      const browser = await attach()             // ports 9222, 9223, 9224
      const [alice, bob, watcher] = browser.pages(3)

      const room = await alice.createRoom('Alice')
      await bob.joinRoom(room, 'Bob')
      await alice.importDeck(); await alice.setup()
      await bob.importDeck(); await bob.setup()

      await watcher.spectate(room)
      console.log(await watcher.counts())

      browser.close()   // detaches; it does not close your browsers
*/

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* one page: its own socket, and the handful of methods the checks want */
class Page {
   constructor (socket, port) {
      this.socket = socket
      this.port = port
      this.pending = new Map()
      this.waiters = []
      this.nextId = 1
   }

   handle (raw) {
      let message
      try {
         message = JSON.parse(typeof raw === 'string' ? raw : String(raw))
      } catch {
         return
      }

      if (message.id && this.pending.has(message.id)) {
         const { resolve, reject } = this.pending.get(message.id)
         this.pending.delete(message.id)
         if (message.error) reject(new Error(JSON.stringify(message.error)))
         else resolve(message.result)
         return
      }

      for (let i = this.waiters.length - 1; i >= 0; i--) {
         if (this.waiters[i].method === message.method) {
            this.waiters[i].resolve(message.params)
            this.waiters.splice(i, 1)
         }
      }
   }

   send (method, params = {}) {
      return new Promise((resolve, reject) => {
         const id = this.nextId++
         const timer = setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`no reply to ${method} after 15s on port ${this.port}`))
         }, 15000)

         this.pending.set(id, {
            resolve: (value) => { clearTimeout(timer); resolve(value) },
            reject: (err) => { clearTimeout(timer); reject(err) }
         })

         try {
            this.socket.send(JSON.stringify({ id, method, params }))
         } catch (err) {
            clearTimeout(timer)
            this.pending.delete(id)
            reject(err)
         }
      })
   }

   waitFor (method) {
      return new Promise((resolve) => this.waiters.push({ method, resolve }))
   }

   async go (url, settle = 2800) {
      const loaded = this.waitFor('Page.loadEventFired')
      await this.send('Page.navigate', { url })
      await loaded
      await sleep(settle)
   }

   async evaluate (expression) {
      const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (res.exceptionDetails) {
         throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
      }
      return res.result.value
   }

   /* anything the page throws is worth knowing about in these tests */
   watchForErrors (label = '') {
      this.socket.addEventListener('message', (event) => {
         let message
         try { message = JSON.parse(event.data) } catch { return }
         if (message.method === 'Runtime.exceptionThrown') {
            const d = message.params.exceptionDetails
            console.error(`[page${label}]`, (d.exception?.description || d.text || '').slice(0, 300))
         }
      })
   }

   /*
      Answer the page's native dialogs (window.confirm, alert) by itself, from
      now on. A headless page that raises one and nobody answers sits blocked
      forever, so any test that clicks a button asking "Sure?" needs this.
      Returns a list of the dialogs that have been answered.
   */
   autoDialogs (accept = true) {
      this.dialogs = this.dialogs || []
      if (this.dialogOn) return this.dialogs

      this.dialogOn = true
      const loop = async () => {
         for (;;) {
            const params = await this.waitFor('Page.javascriptDialogOpening')
            this.dialogs.push(params.message)
            try {
               await this.send('Page.handleJavaScriptDialog', { accept })
            } catch {
               /* already gone: the page moved on by itself */
            }
         }
      }
      loop()
      return this.dialogs
   }

   /*
      Wait until the page's text contains `text`, or give up. Used instead of a
      fixed sleep wherever the point of the check is that something appeared,
      so a slow deployment or a big replay does not turn into a false failure.
   */
   async waitForText (text, { timeout = 15000, poll = 250 } = {}) {
      const deadline = Date.now() + timeout
      for (;;) {
         const found = await this.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)
         if (found) return true
         if (Date.now() > deadline) return false
         await sleep(poll)
      }
   }

   /* the header's watcher line, as text, or null when nobody is watching */
   watchLine () {
      return this.evaluate(`(() => {
         const el = [...document.querySelectorAll('div')].find((d) => /spectator/.test(d.textContent) && d.children.length === 0)
         return el ? el.textContent.trim() : null
      })()`)
   }

   /* wait for the header to name the number of watchers, or to stop naming any */
   async waitForWatchers (expected, { timeout = 20000, poll = 300 } = {}) {
      const deadline = Date.now() + timeout
      for (;;) {
         const line = await this.watchLine()
         const matches = expected === 0
            ? !/spectator/.test(String(line))
            : new RegExp(`${expected} spectator`).test(String(line))
         if (matches) return line
         if (Date.now() > deadline) return line
         await sleep(poll)
      }
   }

   /*
      The centred dialogs - "Still playing?" and "Game closed..." - as text, or
      null when neither is up. Read from the DOM rather than from a screenshot so
      a check can assert on the words the player actually sees.
   */
   dialog () {
      return this.evaluate(`(() => {
         const box = document.querySelector('.closed-dialog, .idle-dialog')
         if (!box) return null
         return {
            text: box.innerText.replace(/\\s+/g, ' ').trim(),
            kind: box.classList.contains('closed-dialog') ? 'closed' : 'idle',
            clock: box.querySelector('.idle-clock')?.textContent.trim() || null,
            button: box.querySelector('button')?.textContent.trim() || null,
            centred: (() => {
               const r = box.getBoundingClientRect()
               const dx = Math.abs((r.left + r.right) / 2 - window.innerWidth / 2)
               const dy = Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2)
               return dx < 4 && dy < 4
            })()
         }
      })()`)
   }

   /* the event names this page's transport has received, newest last */
   relayEvents () {
      return this.evaluate(`(() => {
         try {
            const raw = globalThis.localStorage.getItem('pvp_session')
            return raw ? JSON.parse(raw) : null
         } catch { return null }
      })()`)
   }

   async clickText (text, { settle = 700, kinds = 'button, [class*="item"]' } = {}) {
      const found = await this.evaluate(`(() => {
         const els = [...document.querySelectorAll(${JSON.stringify(kinds)})]
         const hit = els.find((el) => el.textContent.trim() === ${JSON.stringify(text)})
         if (!hit) return false
         hit.click()
         return true
      })()`)
      await sleep(settle)
      return found
   }

   async setInput (name, value) {
      return this.evaluate(`(() => {
         const el = document.querySelector('input[name="${name}"]')
         if (!el) return false
         el.value = ${JSON.stringify(value)}
         el.dispatchEvent(new Event('input', { bubbles: true }))
         return true
      })()`)
   }

   async rightClick (selector, { settle = 700 } = {}) {
      const found = await this.evaluate(`(() => {
         const el = document.querySelector(${JSON.stringify(selector)})
         if (!el) return false
         const r = el.getBoundingClientRect()
         el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: Math.round(r.left + 5), clientY: Math.round(r.top + 5) }))
         return true
      })()`)
      await sleep(settle)
      return found
   }

   /* how much of each half is on screen: the shape most of these checks care about */
   counts () {
      return this.evaluate(`(() => {
         const n = (sel) => document.querySelectorAll(sel + ' img.card').length
         return {
            top: { hand: n('.hand2'), prizes: n('.prizes2'), active: n('.active2'), bench: n('.bench2'), deck: n('.deck2') },
            bottom: { hand: n('.hand'), prizes: n('.prizes'), active: n('.active1'), bench: n('.bench'), deck: n('.deck') },
            turn: document.querySelector('.turn-row .count')?.textContent.trim() || null,
            mode: document.body.innerText.includes('both sides are yours') ? 'solo'
               : (document.body.innerText.includes('Stop Spectating') ? 'spectating'
                  : (document.body.innerText.includes('Leave Room') ? 'room' : 'lobby')),
            chat: document.querySelectorAll('.chat p').length
         }
      })()`)
   }

   /* the app's own flows, so a check reads like a game rather than like DOM work */
   async createRoom (name = 'Player') {
      await this.setInput('playerName', name)
      await this.clickText('Create Room', { settle: 4000 })
      return this.roomCode()
   }

   async joinRoom (room, name = 'Player') {
      await this.setInput('playerName', name)
      await this.setInput('roomId', room)
      await this.clickText('Join Room', { settle: 4000 })
   }

   /*
      A seat is a session: joining as somebody else - or spectating a room after
      having left it - means letting go of the one this browser was holding, or
      the page will resume the old one on the next load and land somewhere the
      test did not ask for.
   */
   async forgetSession () {
      await this.evaluate(`(() => { localStorage.removeItem('pvp_session'); return true })()`)
   }

   async spectate (room, name = 'Watcher') {
      await this.setInput('playerName', name)
      await this.setInput('roomId', room)
      await this.clickText('Spectate Game', { settle: 4000 })
   }

   async roomCode () {
      return this.evaluate(`[...document.querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^[A-Z0-9]{6}$/.test(t)) || null`)
   }

   async importDeck (which = 'Edit Deck') {
      await this.clickText(which, { settle: 900 })
      await this.clickText('Import Random Deck', { settle: 2000 })
      for (let i = 0; i < 40; i++) {
         if (!(await this.evaluate(`document.body.innerText.includes('Import Random Deck')`))) break
         await sleep(1000)
      }
   }

   async setup () {
      await this.clickText('Setup', { settle: 1800 })
   }

   /* a fresh page, sitting in the lobby */
   async reset (base) {
      await this.go(base)
      await this.evaluate(`(() => { localStorage.removeItem('pvp_session'); return 'cleared' })()`)
      await this.go(base)
   }

   detach () {
      try { this.socket.close() } catch { /* already closed */ }
   }
}

class Browser {
   constructor (ports) {
      this.ports = ports
      this.pages_ = []
   }

   async list (port) {
      return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
   }

   /* attach to the first page of each port, in order */
   async pages (count = this.ports.length) {
      const out = []
      for (let i = 0; i < count; i++) {
         const port = this.ports[i]
         if (!port) throw new Error(`no browser on port for page ${i + 1}: start ${count} of them, or pass more ports`)
         out.push(await this.attachPage(port, i))
      }
      return out
   }

   async attachPage (port, index = 0) {
      const targets = await this.list(port)
      const target = targets.filter((t) => t.type === 'page').pop()
      if (!target) throw new Error(`no page on port ${port}`)

      const socket = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
         socket.addEventListener('open', resolve, { once: true })
         socket.addEventListener('error', () => reject(new Error(`could not attach on port ${port}`)), { once: true })
      })

      const page = new Page(socket, port)
      socket.addEventListener('message', (event) => page.handle(event.data))
      await page.send('Page.enable')
      await page.send('Runtime.enable')
      page.watchForErrors(' ' + (index + 1))
      this.pages_.push(page)
      return page
   }

   async setViewport (width = 1277, height = 821) {
      await Promise.all(this.pages_.map((page) => page.send('Emulation.setDeviceMetricsOverride', {
         width, height, deviceScaleFactor: 1, mobile: false
      })))
   }

   /* detach. The browsers are yours, so they are left running. */
   detach () {
      for (const page of this.pages_) page.detach()
   }
}

export async function attach ({ ports = process.env.CDP_PORTS || '9222,9223,9224' } = {}) {
   const list = String(ports).split(',').map((p) => Number(p.trim())).filter(Boolean)
   const reachable = []

   for (const port of list) {
      try {
         const res = await fetch(`http://127.0.0.1:${port}/json/version`)
         if (res.ok) reachable.push(port)
      } catch {
         /* not running; the check will say so when it asks for that page */
      }
   }

   if (!reachable.length) {
      throw new Error(`no browser is listening on ${list.join(', ')} - start one per page and try again`)
   }

   return new Browser(reachable)
}
