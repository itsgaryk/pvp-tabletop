/*
 * The end-to-end game, driven through real browsers: two players and a spectator.
 *
 * tools/relay-check.mjs asks the relay questions directly, which is fast and
 * catches the rules. This asks the *app* - real pages, real clicks, real polls -
 * which is the only way the client half of these behaviours can be seen:
 *
 *   lobby      the lobby has no Room ID field: joining and spectating open a
 *              centred prompt for the code, and all three buttons are the size
 *              of each other
 *   leaving    a player leaving ends the game for the one still sitting there,
 *              who gets the centred "Room closed: player left the room" dialog
 *              and an emptied board behind it; the leaver is not shown it
 *   beacon     a spectator whose TAB CLOSES drops out of the count, with no
 *              button pressed - the pagehide beacon
 *   restart    a room stamped by another deployment closes on the next poll
 *   idle       the prompt appears with a live countdown, either player's answer
 *              clears it for everyone, and an unanswered one closes the room
 *   panel      the board panel's own changes: the glow that stays until it is
 *              clicked, the clock in both directions, the Chat tab lit by a
 *              message that arrived unseen, and both markers at once - each with
 *              its own click, its own used state and its own log line
 *
 *   node tools/browser-check.mjs --only panel      # just that section
 *
 * It does **not** launch browsers. That is deliberate, and it is the lesson from
 * two failed attempts: a helper that spawned its own Edge instances made Edge
 * assert ("a breakpoint has been reached"), and one that multiplexed several
 * pages over a single CDP connection dropped the connection. So one browser per
 * page, started outside, and this attaches to each:
 *
 *   $chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
 *   foreach ($port in 9222, 9223, 9224) {
 *      $profile = Join-Path $env:TEMP "pvp-chrome-$port"
 *      New-Item -ItemType Directory -Force -Path $profile | Out-Null
 *      Start-Process -FilePath $chrome -ArgumentList '--headless=new','--disable-gpu',
 *         '--no-first-run','--no-default-browser-check',"--remote-debugging-port=$port",
 *         "--user-data-dir=$profile",'--window-size=1277,821','about:blank'
 *   }
 *
 * Then, with a dev server running on the short windows these checks need:
 *
 *   RELAY_IDLE_MS=8000 RELAY_PROMPT_MS=12000 RELAY_MEMBER_STALE_MS=600000 \
 *   RELAY_POLL_WAIT_MS=1500 node tools/fake-redis.mjs &
 *   KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev &
 *   node tools/browser-check.mjs
 *
 *   node tools/browser-check.mjs --only idle       # one section
 *   CDP_PORTS=9222,9223 node tools/browser-check.mjs
 *
 * The restart section re-stamps a room's metadata, so it needs the store the
 * relay is reading: locally that is tools/fake-redis.mjs, and against a
 * deployment it must be named (REDIS_URL, REDIS_TOKEN - Upstash's REST protocol,
 * the same credentials the relay uses). Without it that one section is skipped
 * with the reason, rather than writing to some other database and reporting the
 * code as broken.
 *
 * The idle windows have to be short enough that a scripted run reaches them, and
 * long enough that setup (two imports and two set-ups, a few seconds) does not
 * trip them first: 8s idle and 12s prompt is the arrangement these checks were
 * written against.
 *
 * It leaves one room per section behind, all of them closed or left to expire.
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const FAKE = (process.env.FAKE || 'http://127.0.0.1:6390').replace(/\/+$/, '')

const argv = process.argv.slice(2)
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* ------------------------------------------------------------- the store -- */

/*
   The restart section re-stamps a room's metadata, which only means anything if
   that store is the one the relay under test is reading. Writing to a local
   stand-in while the relay reads a deployment's database does not fail loudly -
   the room simply stays as it was, and the section reports that the *code* is
   broken. That is the worst possible answer from a verification tool, so the
   restart section refuses to run unless the store is one we can name.
*/
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)
const STORE_URL = process.env.REDIS_URL
   ? process.env.REDIS_URL.replace(/\/+$/, '')
   : (LOCAL ? FAKE : null)
const STORE_TOKEN = process.env.REDIS_TOKEN || 'local'
const STORE_REASON = STORE_URL
   ? null
   : `the store ${BASE} reads is not named - set REDIS_URL and REDIS_TOKEN to check this`

async function redis (...args) {
   if (!STORE_URL) throw new Error(STORE_REASON)
   const res = await fetch(STORE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STORE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
   })
   if (!res.ok) throw new Error(`store ${args[0]} failed: ${res.status}`)
   const body = await res.json()
   if (body.error) throw new Error(`store error: ${body.error}`)
   return body.result
}

/* ------------------------------------------------------------- the pages -- */

const browser = await attach()
const [alice, bob, watcher] = await browser.pages(3)
await browser.setViewport(1277, 821)
for (const page of [alice, bob, watcher]) page.autoDialogs(true)

/*
   The dev server re-optimises dependencies on and off, and a page whose imports
   are in flight while it does lands on SvelteKit's error page - a fact about
   `vite dev`, not about the app. Reload until it is genuinely in the lobby.
*/
async function lobby (page, label) {
   for (let attempt = 1; attempt <= 8; attempt++) {
      await page.reset(BASE)
      const mode = (await page.counts()).mode
      if (mode === 'lobby') return
      console.log(`  ${label}: not up yet (${mode}), reloading`)
      await sleep(1500)
   }
   throw new Error(`${label} never reached the lobby`)
}

const zones = (page) => page.counts().then((c) => c.bottom)
const emptyBoard = (z) => z.deck === 0 && z.hand === 0 && z.prizes === 0 && z.active === 0 && z.bench === 0
const header = (page) => page.watchLine()

/*
   Wait for a board to read as empty. Clearing a board is several store writes
   and one render, so reading the DOM the instant a click lands catches it
   half-applied and reports a bug that is not there.
*/
async function emptyBoardWhen (page, { timeout = 10000 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      const zones_ = await zones(page)
      if (emptyBoard(zones_)) return zones_
      if (Date.now() > deadline) return zones_
      await sleep(250)
   }
}

async function dialogWhenUp (page, kind = null, { timeout = 60000 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      const dialog = await page.dialog()
      if (dialog && (!kind || dialog.kind === kind)) return dialog
      if (Date.now() > deadline) return null
      await sleep(300)
   }
}

async function dialogCleared (page, { timeout = 20000 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      if ((await page.dialog()) === null) return true
      if (Date.now() > deadline) return false
      await sleep(300)
   }
}

/* a game with two seated players who have both set up */
async function seatGame (label, { withWatcher = false } = {}) {
   console.log(`\n${label}`)
   await Promise.all([lobby(alice, 'alice'), lobby(bob, 'bob')])
   if (withWatcher) await lobby(watcher, 'watcher')

   const room = await alice.createRoom('Alice')
   await bob.joinRoom(room, 'Bob')
   if (withWatcher) await watcher.spectate(room, 'Watcher')

   await alice.importDeck()
   await bob.importDeck()
   await alice.setup()
   await bob.setup()
   await sleep(2500)

   return room
}

const health = await (await fetch(`${BASE}/api/relay/health`)).json()
console.log(`browser check against ${BASE}`)
console.log(`  idle ${health.idle?.idleMs}ms, prompt ${health.idle?.promptMs}ms, epoch ${health.epoch}`)

const want = (name) => !only || only === name

/* --------------------------------------------------------- 0. the lobby --- */

if (want('lobby')) {
   console.log('\nthe lobby asks in a prompt, for a name and a room')

   /*
      The name is remembered in localStorage, which survives a page reset - so a
      check about an empty name has to clear it as well. `reset` does that here,
      and the rest of the suite keeps the remembered name it would have anyway.
   */
   const forgetName = (page) => page.evaluate(`(() => { localStorage.removeItem('player_name'); return true })()`)

   await lobby(alice, 'alice')
   await forgetName(alice)
   await lobby(alice, 'alice')

   const fields = () => alice.evaluate(`[...document.querySelectorAll('input[name]')].map((i) => i.name)`)
   check('the lobby has no Room ID field', !(await fields()).includes('roomId'), JSON.stringify(await fields()))
   check('and no name field either', !(await fields()).includes('playerName'), JSON.stringify(await fields()))

   /* every lobby button the same size, which is the point of dropping the fields */
   const boxes = await alice.evaluate(`(() => {
      const box = (text) => {
         const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
         if (!el) return null
         const r = el.getBoundingClientRect()
         return { w: Math.round(r.width), h: Math.round(r.height) }
      }
      return { create: box('Create Room'), join: box('Join Room'), spectate: box('Spectate Game') }
   })()`)

   check('Join Room is the size of Create Room',
      Boolean(boxes.create && boxes.join) && boxes.create.w === boxes.join.w && boxes.create.h === boxes.join.h,
      JSON.stringify(boxes))
   check('so is Spectate Game',
      Boolean(boxes.create && boxes.spectate) && boxes.create.w === boxes.spectate.w && boxes.create.h === boxes.spectate.h,
      JSON.stringify(boxes))
   check('there is no OK button before a prompt is opened',
      (await alice.evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'OK')`)) === false)

   /*
      What the prompt is showing, in the order it is showing it. It waits for the
      prompt to be up rather than reading at a fixed moment: opening it is a click
      handler and a Svelte update, and how long that takes depends on everything
      else the page is doing.
   */
   const promptNow = async (page = alice) => {
      for (let i = 0; i < 20; i++) {
         const found = await page.evaluate(`(() => {
            const box = document.querySelector('.prompt-dialog')
            if (!box) return null
            const r = box.getBoundingClientRect()
            const labels = [...box.querySelectorAll('input[name]')].map((i) => i.name)
            return {
               text: box.innerText.replace(/\\s+/g, ' ').trim(),
               fields: labels,
               nameFirst: labels[0] === 'playerName',
               ok: box.querySelector('.prompt-ok') ? box.querySelector('.prompt-ok').textContent.trim() : null,
               cancel: box.querySelector('.prompt-cancel') ? box.querySelector('.prompt-cancel').textContent.trim() : null,
               okDisabled: box.querySelector('.prompt-ok') ? box.querySelector('.prompt-ok').disabled : null,
               required: [...box.querySelectorAll('input[name]')].every((i) => i.required),
               centred: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4 &&
                  Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 4
            }
         })()`)
         if (found) return found
         await sleep(250)
      }
      return null
   }

   /*
      Create Room asks for a name and nothing else. `lobby()` clears the
      remembered name with the session, so this is a browser that has not typed
      one yet - which is what makes the disabled OK below meaningful.
   */
   await alice.clickText('Create Room', { settle: 800 })
   const createPrompt = await promptNow()
   check('Create Room opens a prompt for the name', /create a room/i.test(createPrompt?.text || ''), createPrompt?.text)
   check('with only a name field', JSON.stringify(createPrompt?.fields) === JSON.stringify(['playerName']), JSON.stringify(createPrompt?.fields))
   check('which is required', createPrompt?.required === true, JSON.stringify(createPrompt))
   check('and OK is disabled until it has something in it', createPrompt?.okDisabled === true, JSON.stringify(createPrompt))
   await alice.clickText('Cancel', { settle: 800, kinds: 'button' })
   check('Cancel closes it', (await alice.evaluate(`document.querySelector('.prompt-dialog') === null`)) === true)

   /* Join Room asks for the name first, then the code */
   await alice.clickText('Join Room', { settle: 800 })
   const prompt = await promptNow()

   check('Join Room opens a prompt asking for a room', /room/i.test(prompt?.text || ''), prompt?.text)
   check('it is centred on the screen', prompt?.centred === true, JSON.stringify(prompt))
   check('with a name field and a Room ID field',
      JSON.stringify(prompt?.fields) === JSON.stringify(['playerName', 'roomId']), JSON.stringify(prompt?.fields))
   check('the name sits above the room code', prompt?.nameFirst === true, JSON.stringify(prompt?.fields))
   check('both are required', prompt?.required === true, JSON.stringify(prompt))
   check('an OK and a Cancel', prompt?.ok === 'OK' && prompt?.cancel === 'Cancel', JSON.stringify(prompt))
   check('and OK is disabled until both have something in them', prompt?.okDisabled === true, JSON.stringify(prompt))

   /* a name alone is not enough for a join */
   await alice.setInput('playerName', 'Alice')
   await sleep(300)
   check('filling in only the name leaves OK disabled', (await promptNow())?.okDisabled === true, JSON.stringify(await promptNow()))

   /* Cancel leaves the lobby alone */
   await alice.clickText('Cancel', { settle: 800, kinds: 'button' })
   check('Cancel closes it', (await alice.evaluate(`document.querySelector('.prompt-dialog') === null`)) === true)
   check('and the lobby is still the lobby', (await alice.counts()).mode === 'lobby', (await alice.counts()).mode)

   const room = await alice.createRoom('Alice')
   console.log(`  room ${room}`)

   /*
      A room waiting for a second player does not say so. The wait is real - the
      room closes itself - but a countdown to being thrown back to the lobby is
      not something the player sitting alone needs on screen.
   */
   check('a room waiting for an opponent does not count down on screen',
      (await alice.evaluate(`document.body.innerText.includes('Waiting for an opponent')`)) === false)

   /* a browser that has been somewhere else has to be back in the lobby first */
   await lobby(bob, 'bob')
   await bob.clickText('Spectate Game', { settle: 800 })
   const spectatePrompt = await promptNow(bob)
   check('Spectate Game asks for a name and a code too',
      JSON.stringify(spectatePrompt?.fields) === JSON.stringify(['playerName', 'roomId']),
      JSON.stringify(spectatePrompt))
   check('and the name it remembers is filled in, not typed again',
      (await bob.evaluate(`document.querySelector('input[name="playerName"]').value.length > 0`)) === true)
   await bob.answerPrompt({ name: 'Bob', room })
   await sleep(2500)
   check('and it lands in the room as a watcher', (await bob.counts()).mode === 'spectating', (await bob.counts()).mode)

   /* Alice's name was kept, so her next prompt opens with it filled in */
   await bob.forgetSession()
   await lobby(bob, 'bob')
   check('the fields are gone again once back in the lobby',
      !(await fields()).includes('roomId') && !(await fields()).includes('playerName'), JSON.stringify(await fields()))
}

/* ---------------------------------------------------------- 1. leaving --- */

if (want('leave')) {
   const room = await seatGame('leaving: a spectator, a player, and the last player', { withWatcher: true })
   console.log(`  room ${room}`)

   check('both players are on their boards', (await zones(alice)).hand > 0, JSON.stringify(await zones(alice)))
   check('the players see the watcher', /1 spectator/.test(String(await alice.waitForWatchers(1))), JSON.stringify(await header(alice)))

   await watcher.clickText('Stop Spectating', { settle: 3000 })
   check('the spectator count drops for the players', !/spectator/.test(String(await bob.waitForWatchers(0))), JSON.stringify(await header(bob)))
   check('and the spectator session is voided', (await watcher.relayEvents()) === null)
   check('the spectator is back in the lobby', (await watcher.counts()).mode === 'lobby')

   await watcher.spectate(room, 'Watcher2')
   await sleep(3000)
   check('a second spectator is counted', /1 spectator/.test(String(await bob.waitForWatchers(1))), JSON.stringify(await header(bob)))

   /* a tab close: no button, only the beacon can reach the relay */
   await watcher.evaluate(`window.dispatchEvent(new Event('pagehide'))`)
   check('closing the tab drops the count', !/spectator/.test(String(await bob.waitForWatchers(0))), JSON.stringify(await header(bob)))
   check('and voids that session too', (await watcher.relayEvents()) === null)

   await alice.clickText('Leave Room', { settle: 4000 })
   await sleep(3000)
   check('the leaver is back in the lobby', (await alice.counts()).mode === 'lobby', (await alice.counts()).mode)
   check('the leaver is not shown the dialog', (await alice.dialog()) === null, JSON.stringify(await alice.dialog()))
   check('the leaver\'s board is emptied', emptyBoard(await emptyBoardWhen(alice)), JSON.stringify(await zones(alice)))
   check('and not reset, which would deal the deck back', (await zones(alice)).deck === 0, JSON.stringify(await zones(alice)))
   /*
      Both halves, not just the leaver's own. The player still in the room
      publishes a full board state when the room changes, and a client that
      applied it after leaving ended up in the lobby showing somebody else's
      game.
   */
   await sleep(2000)
   check('and the other half is empty, not a game they have left',
      (await alice.counts()).top.deck === 0 && (await alice.counts()).top.prizes === 0,
      JSON.stringify((await alice.counts()).top))

   /*
      A game is the people playing it: the player who walked out ends it for the
      one still sitting there, who is told which ending this was rather than
      being left on a board nothing can update.
   */
   const walked = await dialogWhenUp(bob, 'closed', { timeout: 30000 })
   check('the player left behind is told the game ended', walked !== null, JSON.stringify(walked))
   check('and which ending it was', /player left the room/.test(walked?.text || ''), walked?.text)
   check('they are back in the lobby', (await bob.counts()).mode === 'lobby', (await bob.counts()).mode)
   check('with their board emptied', emptyBoard(await emptyBoardWhen(bob)), JSON.stringify(await zones(bob)))

   await bob.clickText('OK', { settle: 1500, kinds: 'button' })
   await sleep(1000)
   check('the last player out is the one who left, so nothing else closes', (await bob.dialog()) === null, JSON.stringify(await bob.dialog()))
}

/* ------------------------------------------------- 2. the closed dialog --- */

if (want('closed')) {
   const room = await seatGame('a closed room tells the people still in it')
   console.log(`  room ${room}`)

   await watcher.forgetSession()
   await lobby(watcher, 'watcher')
   await watcher.spectate(room, 'Watcher')
   await sleep(2500)

   await alice.clickText('Leave Room', { settle: 4000 })
   await bob.clickText('Leave Room', { settle: 4000 })

   const gone = await dialogWhenUp(watcher, 'closed', { timeout: 30000 })
   check('the watcher is told the game closed', gone !== null, JSON.stringify(gone))
   check('the dialog is centre-screen', gone?.centred === true, JSON.stringify(gone))
   check('with the wording for the ending that happened', /player left the room/.test(gone?.text || ''), gone?.text)
   check('and an OK button', gone?.button === 'OK', gone?.button)
   if (gone) check('OK dismisses it', (await watcher.clickText('OK', { settle: 1500, kinds: 'button' })) === true)
   check('the dialog goes away', await dialogCleared(watcher, { timeout: 6000 }))
   check('and the watcher is in the lobby', (await watcher.counts()).mode === 'lobby', (await watcher.counts()).mode)
}

/* ------------------------------------------------------------ 3. restart -- */

if (want('restart')) {
   if (!STORE_URL) {
      console.log(`\nskipped the restart section - ${STORE_REASON}`)
   } else {
      const room = await seatGame('a restart closes a room somebody is sitting in')
      console.log(`  room ${room}`)

      /*
         Re-stamp the room as belonging to another deployment, which is exactly
         the state a previous deploy leaves behind. Read it back first: if the
         store we just wrote to is not the one the relay reads, the write is
         invisible to it and this section would blame the code for it.
      */
      const key = `pvp:room:${room}:meta`
      const meta = JSON.parse(await redis('GET', key))
      const stamped = { ...meta, epoch: 'sha:0000000000000000000000000000000000000000' }
      await redis('SET', key, JSON.stringify(stamped))

      const readBack = JSON.parse(await redis('GET', key) || 'null')
      if (readBack?.epoch !== stamped.epoch) {
         throw new Error(`the store did not keep the re-stamp (${readBack?.epoch}), so it is not the store under test`)
      }
      console.log('  re-stamped the room with another deployment\'s epoch')

      const dialog = await dialogWhenUp(alice, 'closed', { timeout: 40000 })
      check('the player is told the game closed', dialog !== null, JSON.stringify(dialog))
      check('and that it was the update, not a player', /server was updated/.test(dialog?.text || ''), dialog?.text)
      if (dialog) await alice.clickText('OK', { settle: 1500, kinds: 'button' })
      check('the player lands in the lobby', (await alice.counts()).mode === 'lobby', (await alice.counts()).mode)
      check('with an empty board', emptyBoard(await emptyBoardWhen(alice)), JSON.stringify(await zones(alice)))
      check('and the room forgotten', (await alice.relayEvents()) === null)
      check('the other player is told too', (await dialogWhenUp(bob, 'closed', { timeout: 40000 })) !== null)
   }
}

/* --------------------------------------------------------------- 4. idle -- */

if (want('idle')) {
   const room = await seatGame('the idle prompt')
   console.log(`  room ${room}`)

   const prompt = await dialogWhenUp(alice, 'idle', { timeout: 60000 })
   check('the idle prompt appears', prompt !== null, JSON.stringify(prompt))
   check('it is centred', prompt?.centred === true, JSON.stringify(prompt))
   check('it asks the question', /Still playing\?/.test(prompt?.text || ''), prompt?.text)
   check('it offers the button', prompt?.button === 'Still playing', prompt?.button)
   check('and shows a countdown', /^\d+:\d\d$/.test(String(prompt?.clock)), String(prompt?.clock))

   const first = prompt?.clock
   await sleep(3000)
   check('the countdown runs', (await alice.dialog())?.clock !== first, `${first} -> ${(await alice.dialog())?.clock}`)

   check('the other player is asked too', (await dialogWhenUp(bob, 'idle', { timeout: 30000 }))?.kind === 'idle')

   await watcher.forgetSession()
   await lobby(watcher, 'watcher')
   await watcher.spectate(room, 'Watcher')
   const late = await dialogWhenUp(watcher, 'idle', { timeout: 30000 })
   check('a late spectator replays into the prompt', late?.kind === 'idle', JSON.stringify(late))
   check('read-only for a spectator', late?.button === null, JSON.stringify(late?.button))

   const seconds = (clock) => {
      const [m, s] = String(clock || '0:00').split(':').map(Number)
      return m * 60 + s
   }
   const window = Number(health.idle?.promptMs || 0) / 1000
   check('with the time actually left, not a fresh window', seconds(late?.clock) < window, `${late?.clock} of ${window}s`)

   await alice.clickText('Still playing', { settle: 2500 })
   check('answering clears it for the answerer', (await alice.dialog()) === null)
   check('for the other player', await dialogCleared(bob, { timeout: 20000 }))
   check('and for the spectator', await dialogCleared(watcher, { timeout: 20000 }))
   check('the game goes on', (await alice.counts()).mode === 'room', (await alice.counts()).mode)

   await alice.clickText('Setup', { settle: 2500 })
   check('and the board still works', (await alice.counts()).bottom.hand > 0, JSON.stringify(await alice.counts().bottom))

   const again = await dialogWhenUp(alice, 'idle', { timeout: 60000 })
   check('it is prompted again a full window later', again?.kind === 'idle', JSON.stringify(again))

   const closed = await dialogWhenUp(alice, 'closed', { timeout: 60000 })
   check('an unanswered prompt closes the room', closed?.kind === 'closed', JSON.stringify(closed))
   check('the player is told why', /idle prompt/.test(closed?.text || ''), closed?.text)
   if (closed) await alice.clickText('OK', { settle: 1500, kinds: 'button' })
   check('and lands in the lobby with an empty board',
      (await alice.counts()).mode === 'lobby' && emptyBoard(await emptyBoardWhen(alice)),
      JSON.stringify(await zones(alice)))
   check('the other player is told too', (await dialogWhenUp(bob, 'closed', { timeout: 30000 }))?.kind === 'closed')
}

/* ------------------------------------------------------------- 5. panel --- */

/*
   The board panel's own changes, which nothing in relay-check can see because
   none of them cross the wire: they are what the page does with a click. Each
   one is a thing that used to be wrong, so each check is written against the
   thing that was wrong rather than against the code that replaced it.
*/
if (want('panel')) {
   const room = await seatGame('the board panel: the glow, the clock, the Chat tab and both markers')
   console.log(`  room ${room}`)

   const hideButton = () => alice.evaluate(`(() => {
      const b = [...document.querySelectorAll('.game-actions button')].find((el) => /Pok/.test(el.textContent))
      return b ? { text: b.textContent.trim(), glow: b.classList.contains('glow') } : null
   })()`)

   const chatTab = () => alice.evaluate(`(() => {
      const b = [...document.querySelectorAll('.tabs button')].find((el) => el.textContent.trim() === 'Chat')
      return b ? { unread: b.classList.contains('unread'), active: b.classList.contains('active') } : null
   })()`)

   const timerRowFor = (page) => page.evaluate(`(() => {
      const row = document.querySelector('.timer-row')
      if (!row) return null
      const clock = row.querySelector('.clock')
      return {
         labels: [...row.querySelectorAll('button')]
            .filter((b) => !b.classList.contains('clock'))
            .map((b) => b.textContent.trim()),
         disabled: [...row.querySelectorAll('button')].filter((b) => b.disabled).map((b) => b.textContent.trim()),
         clock: clock ? clock.textContent.trim() : null,
         clockButton: clock ? clock.tagName.toLowerCase() === 'button' : false
      }
   })()`)

   const timerRow = () => timerRowFor(alice)

   const markers = (page) => page.evaluate(`[...document.querySelectorAll('.power-marker')].map((el) => ({
      marks: [...el.querySelectorAll('img.mark')].map((i) => i.getAttribute('alt')),
      used: [...el.querySelectorAll('img.mark.used')].map((i) => i.getAttribute('alt')),
      widths: [...el.querySelectorAll('img.mark')].map((i) => Math.round(i.getBoundingClientRect().width)),
      mine: [...el.querySelectorAll('img.mark.mine')].length > 0,
      paired: el.classList.contains('pair'),
      gap: getComputedStyle(el).rowGap
   }))`)

   /* Setup hides the board and says so; the glow used to fade on a timer */
   await alice.clickText('Show Pokémon', { settle: 1500, kinds: 'button' })
   await alice.clickText('Setup', { settle: 2500 })
   const lit = await hideButton()
   check('Setup lights the Hide Pokemon button', lit?.glow === true, JSON.stringify(lit))
   await sleep(5000)
   check('and it stays lit rather than fading', (await hideButton())?.glow === true, JSON.stringify(await hideButton()))
   await alice.clickText('Show Pokémon', { settle: 2000, kinds: 'button' })
   check('clicking the button is what puts it out', (await hideButton())?.glow === false, JSON.stringify(await hideButton()))

   /*
      A shortcut is the board's, not the button's. Clicking Setup leaves that
      button focused, and Ctrl+V used to do nothing at all until the player
      clicked somewhere else first - because a focused button was treated as
      somebody typing. Only the two keys that press a button belong to it.
   */
   const deckOpen = (page) => page.evaluate(`document.querySelector('.inspection') !== null`)
   const keyOnFocused = (page, key, code, modifiersText = '') => page.evaluate(`(() => {
      const el = document.activeElement || document.body
      el.dispatchEvent(new KeyboardEvent('keydown', {
         key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)},
         ctrlKey: ${modifiersText.includes('ctrl')}, metaKey: ${modifiersText.includes('meta')},
         bubbles: true, cancelable: true
      }))
      return el.tagName
   })()`)

   await alice.evaluate(`[...document.querySelectorAll('.game-actions button')].find((b) => b.textContent.includes('Setup')).focus()`)
   check('the Setup button is focused', /Setup/.test(await alice.evaluate(`(document.activeElement.textContent || '').trim()`)))
   check('the deck is not open to begin with', (await deckOpen(alice)) === false)

   await keyOnFocused(alice, 'v', 'KeyV', 'ctrl')
   await sleep(900)
   check('Ctrl+V opens the deck while that button has focus', (await deckOpen(alice)) === true)
   if (await deckOpen(alice)) await alice.clickText('Close', { settle: 1200, kinds: 'button' })

   /* and Space still presses the focused button rather than the board */
   await alice.evaluate(`[...document.querySelectorAll('.game-actions button')].find((b) => b.textContent.includes('Setup')).focus()`)
   await keyOnFocused(alice, ' ', 'Space')
   await sleep(900)
   check('space on a focused button is still the button\'s own', (await deckOpen(alice)) === false)
   await alice.evaluate(`document.activeElement && document.activeElement.blur()`)

   /*
      The timer is set rather than nudged. A room's clock starts at fifty minutes,
      the six adjustment buttons are gone, and the clock itself is the control
      that opens the prompt - while the one button left beside it starts and
      pauses.
   */
   const both = await timerRow()
   check('a room clock starts at fifty minutes', both?.clock === '50:00', both?.clock)
   check('the six adjustment buttons are gone',
      JSON.stringify(both?.labels) === JSON.stringify(['\u23EF\uFE0F']) && both?.clockButton === true,
      JSON.stringify(both))

   await alice.clickText('50:00', { settle: 800, kinds: 'button' })
   const timerPrompt = await alice.evaluate(`(() => {
      const box = document.querySelector('.timer-dialog')
      if (!box) return null
      const r = box.getBoundingClientRect()
      return {
         text: box.innerText.replace(/\\s+/g, ' ').trim(),
         minutes: box.querySelector('input[name="timerMinutes"]') ? box.querySelector('input[name="timerMinutes"]').value : null,
         seconds: box.querySelector('input[name="timerSeconds"]') ? box.querySelector('input[name="timerSeconds"]').value : null,
         ok: box.querySelector('.timer-ok') ? box.querySelector('.timer-ok').textContent.trim() : null,
         cancel: box.querySelector('.timer-cancel') ? box.querySelector('.timer-cancel').textContent.trim() : null,
         centred: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4 &&
            Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 4
      }
   })()`)

   check('clicking the clock opens a prompt to set the time', /set the timer/i.test(timerPrompt?.text || ''), timerPrompt?.text)
   check('it is centred on the screen', timerPrompt?.centred === true, JSON.stringify(timerPrompt))
   check('it opens on the time the clock is showing', timerPrompt?.minutes === '50' && timerPrompt?.seconds === '0', JSON.stringify(timerPrompt))
   check('with an OK and a Cancel', timerPrompt?.ok === 'OK' && timerPrompt?.cancel === 'Cancel', JSON.stringify(timerPrompt))

   /*
      Each field caps at 60, because that is all a minutes or seconds field
      holds. The cap is applied as you type, so the number on screen is the
      number that will be set - which is why this reads the field back rather
      than checking what the store ended up with.
   */
   await alice.evaluate(`(() => {
      const set = (name, value) => {
         const el = document.querySelector('input[name="' + name + '"]')
         el.value = value
         el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('timerMinutes', '99')
      set('timerSeconds', '75')
      return true
   })()`)
   /* the binding writes back on the next tick, so read it after one */
   await sleep(400)
   const capped = await alice.evaluate(`(() => ({
      minutes: document.querySelector('input[name="timerMinutes"]').value,
      seconds: document.querySelector('input[name="timerSeconds"]').value
   }))()`)
   check('a field cannot be typed past 60', capped.minutes === '60' && capped.seconds === '60', JSON.stringify(capped))

   await alice.evaluate(`(() => {
      const set = (name, value) => {
         const el = document.querySelector('input[name="' + name + '"]')
         el.value = value
         el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('timerMinutes', '12')
      set('timerSeconds', '34')
      return true
   })()`)
   await alice.clickText('OK', { settle: 1500, kinds: 'button' })
   await sleep(1000)
   check('OK sets the clock to what was typed', (await timerRow())?.clock === '12:34', (await timerRow())?.clock)

   /* and the other player sees the same clock, because it is the table's */
   await sleep(3000)
   check('and the opponent sees it too', (await timerRowFor(bob))?.clock === '12:34', (await timerRowFor(bob))?.clock)

   /* Cancel leaves the clock alone */
   await alice.clickText('12:34', { settle: 800, kinds: 'button' })
   await alice.clickText('Cancel', { settle: 1000, kinds: 'button' })
   await sleep(700)
   check('Cancel leaves the clock as it was', (await timerRow())?.clock === '12:34', (await timerRow())?.clock)

   /*
      Setting a time is not the clock running out. A room clock that opens at
      50:00 would otherwise look like one that had just finished the moment
      anybody set it to zero.
   */
   await alice.clickText('12:34', { settle: 800, kinds: 'button' })
   await alice.evaluate(`(() => {
      const set = (name, value) => {
         const el = document.querySelector('input[name="' + name + '"]')
         el.value = value
         el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('timerMinutes', '0')
      set('timerSeconds', '0')
      return true
   })()`)
   await sleep(300)
   await alice.clickText('OK', { settle: 1000, kinds: 'button' })
   await sleep(800)
   check('a clock set to zero reads 00:00', (await timerRow())?.clock === '00:00', (await timerRow())?.clock)
   check('and nobody is told time is up for a clock that was set, not run out',
      (await alice.evaluate(`document.querySelector('.time-up') === null`)) === true)

   /* back to a working clock for the play button */
   await alice.clickText('00:00', { settle: 800, kinds: 'button' })
   await alice.evaluate(`(() => {
      const set = (name, value) => {
         const el = document.querySelector('input[name="' + name + '"]')
         el.value = value
         el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      set('timerMinutes', '12')
      set('timerSeconds', '34')
      return true
   })()`)
   await sleep(300)
   await alice.clickText('OK', { settle: 1200, kinds: 'button' })
   await sleep(800)
   check('and it can be set back to a real time', (await timerRow())?.clock === '12:34', (await timerRow())?.clock)

   /* the play button starts and pauses it, and was not part of the removal */
   await alice.clickText('\u23EF\uFE0F', { settle: 1200, kinds: 'button' })
   const started = (await timerRow())?.clock
   await sleep(2500)
   check('the play button starts the clock', (await timerRow())?.clock !== started, `${started} -> ${(await timerRow())?.clock}`)
   await alice.clickText('\u23EF\uFE0F', { settle: 1200, kinds: 'button' })
   const paused = (await timerRow())?.clock
   await sleep(2500)
   check('and pauses it again', (await timerRow())?.clock === paused, `${paused} -> ${(await timerRow())?.clock}`)

   /* the Chat tab, which is only ever lit by a message that arrived unseen */
   check('the Chat tab starts quiet', (await chatTab())?.unread === false, JSON.stringify(await chatTab()))
   await bob.clickText('Chat', { settle: 1200, kinds: 'button' })
   await bob.setInput('message', 'hello there')
   await bob.clickText('Send', { settle: 1500, kinds: 'button' })
   await sleep(4000)
   check('a chat line lights it while the log is showing', (await chatTab())?.unread === true, JSON.stringify(await chatTab()))
   await alice.clickText('Chat', { settle: 1500, kinds: 'button' })
   check('looking at the tab puts it out', (await chatTab())?.unread === false, JSON.stringify(await chatTab()))
   check('and the message is there', (await alice.counts()).chat > 0, String((await alice.counts()).chat))
   await alice.clickText('Game', { settle: 1200, kinds: 'button' })
   await alice.clickText('Flip Coin', { settle: 2000, kinds: 'button' })
   await sleep(2500)
   check('a game-log line does not light it', (await chatTab())?.unread === false, JSON.stringify(await chatTab()))

   /* both markers at once, and the settings panel around them */
   await alice.evaluate(`(() => {
      const cog = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Settings')
      if (cog) cog.click()
      return Boolean(cog)
   })()`)
   await sleep(1200)

   const shape = await alice.evaluate(`[...document.querySelectorAll('.setting')].map((b) => ({
      title: b.querySelector('.title')?.textContent.trim() || null,
      tinted: getComputedStyle(b).backgroundColor
   }))`)
   check('every setting has a heading', shape.length > 0 && shape.every((s) => s.title), JSON.stringify(shape.map((s) => s.title)))
   check('and they share one look', new Set(shape.map((s) => s.tinted)).size === 1, JSON.stringify(shape.map((s) => s.tinted)))

   /*
      The panel is the settings that can be set, and nothing else. "Appearance"
      held one line of prose about dark mode and no control at all, and the lines
      that only restated what the control already says are gone with it.
   */
   check('and only settings that can be set are there',
      JSON.stringify(shape.map((s) => s.title)) === JSON.stringify(['Mulligans', 'VSTAR / GX marker', 'Card Size', 'Board zones', 'Diagnostics']),
      JSON.stringify(shape.map((s) => s.title)))

   const described = await alice.evaluate(`[...document.querySelectorAll('.setting')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
   check('with nothing restating what a control already says',
      !described.some((t) => /Talonflame|once you have used that power|Outlines each area|events this browser has received|always shown in dark mode/.test(t)),
      JSON.stringify(described))

   check('the marker list ends with Both', (await alice.evaluate(`[...document.querySelectorAll('input[name="powerMarker"]')].map((i) => i.parentElement.textContent.trim()).join(',')`)) === 'Off,VStar,GX,Both')

   await alice.clickText('Both', { settle: 1500, kinds: 'label' })
   await sleep(2500)
   const mine = (await markers(alice)).find((m) => m.mine)
   check('Both shows the two marks together', JSON.stringify(mine?.marks) === JSON.stringify(['VSTAR', 'GX']), JSON.stringify(mine))
   check('paired, not one instead of the other', mine?.paired === true, JSON.stringify(mine))
   check('and the two marks are the same width',
      Array.isArray(mine?.widths) && mine.widths.length === 2 && mine.widths[0] === mine.widths[1],
      JSON.stringify(mine?.widths))
   check('with a gap between them so they do not read as one mark', parseFloat(mine?.gap || '0') > 0, mine?.gap)
   check('and neither is dimmed to begin with', (mine?.used || []).length === 0, JSON.stringify(mine?.used))

   /*
      Each mark is its own button. Clicking one says that power has been used and
      must not dim - or write to the log about - the other.
   */
   const clickMark = (page, alt) => page.evaluate(`(() => {
      const mark = [...document.querySelectorAll('.power-marker img.mark.mine')].find((i) => i.getAttribute('alt') === ${JSON.stringify(alt)})
      if (!mark) return false
      mark.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
      return true
   })()`)

   check('VSTAR is clickable on its own', await clickMark(alice, 'VSTAR'))
   await sleep(2000)
   const afterVstar = (await markers(alice)).find((m) => m.mine)
   check('using VSTAR dims only VSTAR', JSON.stringify(afterVstar?.used) === JSON.stringify(['VSTAR']), JSON.stringify(afterVstar?.used))
   check('and says so in the log', /Used VStar/.test(await alice.evaluate(`document.querySelector('.chat')?.innerText || ''`)), 'log')

   check('GX is clickable on its own too', await clickMark(alice, 'GX'))
   await sleep(2000)
   const afterBoth = (await markers(alice)).find((m) => m.mine)
   check('using GX dims GX as well, and leaves the two apart',
      JSON.stringify((afterBoth?.used || []).slice().sort()) === JSON.stringify(['GX', 'VSTAR']),
      JSON.stringify(afterBoth?.used))
   check('and the log names GX, not the pair', /Used GX/.test(await alice.evaluate(`document.querySelector('.chat')?.innerText || ''`)), 'log')

   /* clicking one again takes only that one back */
   await clickMark(alice, 'VSTAR')
   await sleep(1500)
   const afterUndo = (await markers(alice)).find((m) => m.mine)
   check('clicking a used mark takes just that one back',
      JSON.stringify(afterUndo?.used) === JSON.stringify(['GX']),
      JSON.stringify(afterUndo?.used))

   await sleep(3000)
   const far = (await markers(bob)).find((m) => !m.mine)
   check('and the opponent sees both as well', JSON.stringify(far?.marks) === JSON.stringify(['VSTAR', 'GX']), JSON.stringify(far))
   check('with the used one dimmed on their side too', JSON.stringify(far?.used) === JSON.stringify(['GX']), JSON.stringify(far?.used))

   await alice.clickText('Off', { settle: 1500, kinds: 'label' })
   await sleep(2000)
   check('turning it off clears them', (await markers(alice)).length === 0, JSON.stringify(await markers(alice)))
}

await browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
