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
 *   stadium    the one zone both players play into: two cards each, drawn side by
 *              side, a third replacing that player's own oldest, and a card one
 *              player plays sending the other player's cards to that player's
 *              discard
 *   beacon     a spectator whose TAB CLOSES drops out of the count, with no
 *              button pressed - the pagehide beacon
 *   restart    a room stamped by another deployment closes on the next poll
 *   idle       the prompt appears with a live countdown, either player's answer
 *              clears it for everyone, and an unanswered one closes the room
 *   panel      the board panel's own changes: the glow that stays until it is
 *              clicked, the clock in both directions, the Chat tab lit by a
 *              message that arrived unseen, the zone names that come with the
 *              outlines and the number the table does not carry, and both markers
 *              at once - each with its own click, its own used state and its own
 *              log line, in the Pokemon Power zone that is the top and bottom
 *              quarter of the Stadium's cell
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
 * They are the *room's* clock, not any one section's, and that is the trap the
 * panel section fell into. It is the slow section - opening the timer dialog and
 * typing into it, waiting five seconds to see whether a glow fades, waiting for
 * the other player's line to arrive - and none of that appends an event, so the
 * relay asked "Still playing?" and, nobody answering, closed the room under it.
 * Everything after that read the main menu: eighteen failures with one
 * unanswered dialog behind them, and three that passed because an empty list
 * satisfies "none of them do X". So a section slower than the window answers the
 * prompt itself (see the panel section), and the idle section is the one that
 * lets it close on purpose.
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

/*
   The main menu's buttons, and whether each can be pressed.

   A menu button that stays disabled is the whole of an action being unreachable,
   and Join Room is worse than that: it is also the only way to type another room
   code, so a `locked` lobby status latched from the room just left took the
   join route off the menu for good. Read from the DOM, because disabled is what
   the player meets - clicking a disabled button does nothing at all.
*/
const menuButtons = (page) => page.evaluate(`(() => {
   const box = document.querySelector('.menu-actions')
   if (!box) return null
   return [...box.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled }))
})()`)

const usable = (buttons, text) => {
   const hit = (buttons || []).find((b) => b.text === text)
   return Boolean(hit && !hit.disabled)
}

/* can this page get as far as the join prompt, which is what Join Room is for */
async function canOpenJoin (page) {
   const pressed = await page.evaluate(`(() => {
      const box = document.querySelector('.menu-actions')
      const btn = box && [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Join Room')
      if (!btn || btn.disabled) return false
      btn.click()
      return true
   })()`)
   await sleep(600)
   const open = await page.evaluate(`Boolean(document.querySelector('.prompt-dialog'))`)
   if (open) await page.clickText('Cancel', { settle: 400, kinds: 'button' })
   return pressed && open
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
   console.log('\nthe main menu: the logo, and the buttons beside it')

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
   check('the menu has no Room ID field', !(await fields()).includes('roomId'), JSON.stringify(await fields()))
   check('and no name field either', !(await fields()).includes('playerName'), JSON.stringify(await fields()))

   /*
      The menu is the logo and the buttons and nothing else: no relay health, no
      "checking relay", no status line, no last-fault note, no divider rules.
   */
   const menuOnly = await alice.evaluate(`(() => {
      const menu = document.querySelector('.menu')
      if (!menu) return null
      const logo = menu.querySelector('img.menu-logo')
      return {
         children: [...menu.children].map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]),
         logo: logo ? logo.getAttribute('src') : null,
         logoLoaded: logo ? logo.naturalWidth > 0 : false,
         buttons: [...menu.querySelectorAll('button')].map((b) => b.textContent.trim()),
         rules: menu.querySelectorAll('hr').length
      }
   })()`)

   check('the menu is there', menuOnly !== null)
   check('with the logo on it, and the logo actually loaded',
      menuOnly?.logo === '/logo.webp' && menuOnly?.logoLoaded === true, JSON.stringify({ src: menuOnly?.logo, loaded: menuOnly?.logoLoaded }))
   check('and the four buttons', JSON.stringify(menuOnly?.buttons) === JSON.stringify(['Play Solo', 'Create Room', 'Join Room', 'Spectate Game']), JSON.stringify(menuOnly?.buttons))
   /*
      And nothing else: no relay health, no "checking relay", no status line, no
      last-fault note, no divider rules. Read off the element rather than its text
      because the logo is an image and contributes no text at all.
   */
   check('and nothing else on the window',
      JSON.stringify(menuOnly?.children) === JSON.stringify(['img.menu-logo', 'div.menu-actions']) && menuOnly?.rules === 0,
      JSON.stringify(menuOnly?.children))

   /*
      The rest of the page stands aside too. The settings cog and Edit Deck belong
      to a board, and there is no board behind the menu - so the window is the
      logo, the buttons, and nothing else at all.
   */
   const elsewhere = await alice.evaluate(`(() => {
      const text = document.body.innerText
      return {
         editDeck: /Edit Deck/.test(text),
         cog: [...document.querySelectorAll('button[aria-label="Settings"]')].length,
         board: document.querySelector('.gameboard') !== null,
         buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean)
      }
   })()`)

   check('with no Edit Deck, no settings cog and no board behind it',
      elsewhere.editDeck === false && elsewhere.cog === 0 && elsewhere.board === false,
      JSON.stringify(elsewhere))
   check('so the only buttons on the window are the four',
      JSON.stringify(elsewhere.buttons) === JSON.stringify(['Play Solo', 'Create Room', 'Join Room', 'Spectate Game']),
      JSON.stringify(elsewhere.buttons))

   /* the logo is to the left of the buttons, which sit in one column */
   const layout = await alice.evaluate(`(() => {
      /*
         Measured on the elements themselves, not on boxes read earlier: a field
         that took focus scrolled the panel, and a rectangle captured before that
         is stale - which is what made this look off-centre when it was not.
      */
      const logo = document.querySelector('.menu-logo')
      const actions = document.querySelector('.menu-actions')
      if (!logo || !actions) return null
      const l = logo.getBoundingClientRect()
      const a = actions.getBoundingClientRect()
      const buttons = [...actions.querySelectorAll('button')].map((b) => {
         const r = b.getBoundingClientRect()
         return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) }
      })
      const left = Math.min(l.left, a.left)
      const right = Math.max(l.right, a.right)
      const top = Math.min(l.top, a.top)
      const bottom = Math.max(l.bottom, a.bottom)
      return {
         logoRight: Math.round(l.right),
         actionsLeft: Math.round(a.left),
         buttons,
         centreOffsetX: Math.abs((left + right) / 2 - window.innerWidth / 2),
         /*
            Vertically the *pair* is not what is centred - each item is centred on
            the row, and the row on the window - so the combined box can sit a few
            pixels off while both are exactly where they should be. The tolerance
            is for that, not for the layout being loose.
         */
         centreOffsetY: Math.abs((top + bottom) / 2 - window.innerHeight / 2),
         width: window.innerWidth,
         height: window.innerHeight
      }
   })()`)

   check('the logo is to the left of the buttons', layout !== null && layout.logoRight <= layout.actionsLeft, JSON.stringify(layout && { logoRight: layout.logoRight, actionsLeft: layout.actionsLeft }))
   check('the pair is centred in the window', Boolean(layout) && layout.centreOffsetX < 3 && layout.centreOffsetY < 12, JSON.stringify(layout && { x: layout.centreOffsetX, y: layout.centreOffsetY }))

   /* evenly spaced, and aligned with one another */
   const tops = layout?.buttons.map((b) => b.top)
   const heights = layout?.buttons.map((b) => b.height)
   const gaps = []
   for (let i = 1; i < (layout?.buttons.length || 0); i++) gaps.push(layout.buttons[i].top - layout.buttons[i - 1].top)

   check('the buttons are evenly spaced down the column',
      gaps.length === 3 && new Set(gaps).size === 1 && gaps[0] > 0, JSON.stringify(gaps))
   check('and every one the same height in the same column',
      new Set(heights || []).size === 1 && new Set((layout?.buttons || []).map((b) => b.left)).size === 1 && new Set((layout?.buttons || []).map((b) => b.right)).size === 1,
      JSON.stringify(layout?.buttons))

   /* every button the same size, which is the point of dropping the fields */
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
   check('and the menu is still the menu', (await alice.counts()).mode === 'lobby', (await alice.counts()).mode)

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
   check('the fields are gone again once back at the menu',
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

   /*
      A spectator watched a room whose two seats were taken - that is the only
      room anybody spectates - so the lobby status it read on the way in said
      "locked". Kept, it disabled Join Room for the rest of the page's life.
   */
   check('and can still press Join Room', usable(await menuButtons(watcher), 'Join Room'),
      JSON.stringify(await menuButtons(watcher)))
   check('which opens the room code prompt', await canOpenJoin(watcher))

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

   /*
      The player who joined typed a room code, and filling the second seat made
      the summary fetched a moment later read "locked". That status was kept
      across leaving, so the menu's Join Room - the one control that opens the
      code prompt - was disabled with no way back. The code belongs to the room
      that was left, so both go with it.
   */
   check('the player who joined can press Join Room again', usable(await menuButtons(bob), 'Join Room'),
      JSON.stringify(await menuButtons(bob)))
   check('and it opens the room code prompt', await canOpenJoin(bob))
}

/* ------------------------------------------- 2. two cards in the Stadium --- */

if (want('stadium')) {
   const room = await seatGame('the Stadium: two cards each, and a play clears the other player\'s')
   console.log(`  room ${room}`)

   /*
      The piles' own counts, which is where a discard is counted: only the top
      card of a discard is drawn, so its cards cannot be counted off the DOM. The
      Stadium is counted in cards instead - it carries no badge.
   */
   const badges = (page) => page.evaluate(`(() => {
      const badge = (sel) => {
         const el = document.querySelector(sel + ' .count')
         return el ? parseInt(el.textContent.trim(), 10) : null
      }
      return {
         own: { hand: badge('.hand'), deck: badge('.deck'), discard: badge('.discard'), prizes: badge('.prizes') },
         far: { hand: badge('.hand2'), deck: badge('.deck2'), discard: badge('.discard2'), prizes: badge('.prizes2') }
      }
   })()`)

   /* the two halves of the one Stadium cell: cards, and whether they sit side by side */
   const stadium = (page) => page.evaluate(`(() => {
      const shape = (sel) => {
         const rects = [...document.querySelectorAll(sel + ' img.card')].map((i) => i.getBoundingClientRect())
         const sorted = rects.slice().sort((a, b) => a.left - b.left)
         return {
            count: rects.length,
            overlap: sorted.length > 1 && sorted[1].left < sorted[0].right - 1,
            widths: rects.map((r) => Math.round(r.width))
         }
      }
      const band = document.querySelector('.stadium-area > .stadium2')?.getBoundingClientRect()
      return { own: shape('.stadium'), far: shape('.stadium2'), band: band ? Math.round(band.width) : null }
   })()`)

   /*
      Play one card of a hand into the Stadium, the way a player does it: right
      click the card, then the menu's own "To Stadium". The menu is portalled onto
      the body, so it is found by its text rather than by where it was written -
      and matched by prefix, because an entry carries its shortcut after its name.
   */
   const playToStadium = async (page, index = 0) => {
      const card = await page.evaluate(`(() => {
         const img = [...document.querySelectorAll('.hand img.card')][${index}]
         if (!img) return null
         img.parentElement.click()
         return img.getAttribute('alt')
      })()`)
      if (!card) return false
      await sleep(900)

      await page.rightClick('.hand img.card')
      await sleep(1000)
      const chosen = await page.evaluate(`(() => {
         const item = [...document.querySelectorAll('.item')].find((el) => el.textContent.trim().startsWith('To Stadium'))
         if (!item) return false
         item.click()
         return true
      })()`)
      await sleep(2200)
      return chosen
   }

   /*
      This section is slower than the room's idle window, and reading the board
      appends nothing, so both players answer the prompt while it works - the same
      arrangement, and for the same reason, as the panel section.
   */
   const answering = setInterval(() => {
      for (const page of [alice, bob]) {
         page.evaluate(`(() => { const go = document.querySelector('.idle-go'); if (go) go.click(); return true })()`).catch(() => {})
      }
   }, 1500)

   const start = await badges(alice)
   check('both players start with cards in hand', start.own.hand === 7 && (await badges(bob)).own.hand === 7,
      JSON.stringify({ alice: start.own, bob: (await badges(bob)).own }))
   check('and nothing in either Stadium',
      (await stadium(alice)).own.count === 0 && (await stadium(alice)).far.count === 0,
      JSON.stringify(await stadium(alice)))

   /* one card, then a second beside it rather than on top of it */
   check('a card can be played into the player\'s Stadium', await playToStadium(alice))
   const one = await stadium(alice)
   check('and it is the only card there', one.own.count === 1, JSON.stringify(one.own))

   check('a second card can be played', await playToStadium(alice))
   const two = await stadium(alice)
   check('so the Stadium holds both', two.own.count === 2, JSON.stringify(two.own))
   check('and they are drawn side by side rather than one over the other', two.own.overlap === false, JSON.stringify(two.own))
   check('each of them narrower than the single card was',
      two.own.widths.length === 2 && two.own.widths.every((w) => w < one.own.widths[0]),
      JSON.stringify({ one: one.own.widths, two: two.own.widths }))
   check('and the pair still fits the band they are in',
      two.own.widths.reduce((sum, w) => sum + w, 0) <= two.band, JSON.stringify({ widths: two.own.widths, band: two.band }))

   const afterTwo = await badges(alice)
   check('neither of them was discarded to make room', afterTwo.own.discard === 0, JSON.stringify(afterTwo.own))
   check('the opponent sees the same two cards',
      (await stadium(bob)).far.count === 2 && (await stadium(bob)).far.overlap === false,
      JSON.stringify((await stadium(bob)).far))

   /* a third card replaces the oldest of that player's own, into their discard */
   check('a third card is played too', await playToStadium(alice))
   const three = await stadium(alice)
   check('the Stadium still holds two, not three', three.own.count === 2, JSON.stringify(three.own))
   check('and the one it replaced went to that player\'s discard',
      (await badges(alice)).own.discard === 1, JSON.stringify((await badges(alice)).own))

   /*
      The other player plays: everything the first player had in the Stadium goes
      to the first player's discard, and the card played is the only one there.
   */
   check('the opponent can play into the Stadium as well', await playToStadium(bob))
   await sleep(2500)
   check('and the player\'s cards in it went to the player\'s discard',
      (await stadium(alice)).own.count === 0 && (await badges(alice)).own.discard === 3,
      JSON.stringify({ stadium: (await stadium(alice)).own, badges: (await badges(alice)).own }))
   check('the opponent\'s own discard is untouched by playing',
      (await badges(alice)).far.discard === 0, JSON.stringify((await badges(alice)).far))
   check('with the card they played on their own half, where the player sees it',
      (await stadium(alice)).far.count === 1, JSON.stringify((await stadium(alice)).far))
   /*
      Read on the opponent's own board, its two halves are the other way round: a
      player's own Stadium is the near half of their own screen, and the one they
      see across the table is the player's.
   */
   check('and on their own board it is their own half that holds it',
      (await stadium(bob)).own.count === 1 && (await stadium(bob)).far.count === 0, JSON.stringify(await stadium(bob)))

   /* and the rule is the same the other way round */
   check('the opponent can keep two of their own in it', await playToStadium(bob))
   const bobTwo = await stadium(bob)
   check('drawn side by side on their half too', bobTwo.own.count === 2 && bobTwo.own.overlap === false, JSON.stringify(bobTwo.own))

   check('and a card played by the player clears the opponent\'s two', await playToStadium(alice))
   await sleep(3000)
   const clearedBob = await stadium(bob)
   const clearedAlice = await stadium(alice)
   check('so their Stadium is empty again', clearedBob.own.count === 0, JSON.stringify(clearedBob.own))
   check('and both of them are in the opponent\'s discard',
      (await badges(bob)).own.discard === 2, JSON.stringify((await badges(bob)).own))
   check('while the card just played is the only one left in the Stadium, on the player\'s half',
      clearedAlice.own.count === 1 && clearedAlice.far.count === 0, JSON.stringify(clearedAlice))

   clearInterval(answering)
}

/* ------------------------------------------------- 3. the closed dialog --- */

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
      heights: [...el.querySelectorAll('img.mark')].map((i) => Math.round(i.getBoundingClientRect().height)),
      mine: [...el.querySelectorAll('img.mark.mine')].length > 0,
      paired: el.classList.contains('pair'),
      gap: getComputedStyle(el).rowGap,
      /*
         Which band of the Stadium's cell the marks are in, and how much of it
         they take. A Power zone is a quarter of that cell, and what is inside
         one is sized by the band it is in.
      */
      zone: el.closest('.power, .power2')?.className.split(' ')[0] || null,
      fill: el.getBoundingClientRect().height / (el.parentElement?.getBoundingClientRect().height || 1)
   }))`)

   /*
      The board's own controls, read in one go.

      The checks here that assert an *absence* - the deck is not open, nobody has
      been told the time is up, no marks are left - are also satisfied by a page
      with no board on it at all, and that is not hypothetical: the run that lost
      its room to the idle prompt (see `stillPlaying` below) reported three of
      them as passes while every query that wanted something found nothing. So an
      absence is asserted about a board that is there, and read in one expression
      so the two cannot disagree.
   */
   const controls = (page) => page.evaluate(`(() => ({
      board: document.querySelector('.game-actions') !== null,
      deck: document.querySelector('.inspection') !== null,
      timeUp: document.querySelector('.time-up') !== null
   }))()`)

   /*
      Answer the relay's "Still playing?" while this section works.

      The idle windows are the room's clock rather than this section's, and they
      are seconds long because the idle section has to reach them. This is the
      slow section: opening the timer dialog and typing into it, waiting five
      seconds to see whether a glow fades, waiting for the other player's line to
      arrive. None of that appends an event, so the relay asks whether anybody is
      still playing - and on an unmodified tree it asked 24s in and closed the
      room at 48s, which is the whole of the eighteen failures below.

      Answering is what a player at the board does, and it is deliberately not
      what the panel is testing: letting the prompt run out is the idle section's
      job, on purpose, in a room of its own. Both players answer here, for as long
      as this section is reading the board - either may see the prompt first, and
      an answer that arrives twice is the same answer.
   */
   const stillPlaying = (page) => page.evaluate(`(() => {
      const go = document.querySelector('.idle-go')
      if (!go) return false
      go.click()
      return true
   })()`)

   const answering = setInterval(() => {
      for (const page of [alice, bob]) stillPlaying(page).catch(() => {})
   }, 1000)

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
      button focused, and a focused button used to be treated as somebody typing,
      which swallowed every shortcut pressed from it. Only the two keys that press
      a button belong to it, so V still opens the deck from there.

      V and only V, though: Ctrl+V is how a player pastes a room code or a
      message, and the deck must not open on top of the paste. The paste chord is
      the platform's own - Cmd+V on a Mac, Ctrl+V anywhere else - which is the
      pair the app treats as its command modifier.
   */
   const keyOnFocused = (page, key, code, modifiersText = '') => page.evaluate(`(() => {
      const el = document.activeElement || document.body
      el.dispatchEvent(new KeyboardEvent('keydown', {
         key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)},
         ctrlKey: ${modifiersText.includes('ctrl')}, metaKey: ${modifiersText.includes('meta')},
         bubbles: true, cancelable: true
      }))
      return el.tagName
   })()`)

   const focusSetup = () => alice.evaluate(`[...document.querySelectorAll('.game-actions button')].find((b) => b.textContent.includes('Setup')).focus()`)

   await focusSetup()
   check('the Setup button is focused', /Setup/.test(await alice.evaluate(`(document.activeElement.textContent || '').trim()`)))
   const shut = await controls(alice)
   check('the deck is not open to begin with', shut.board && !shut.deck, JSON.stringify(shut))

   await keyOnFocused(alice, 'v', 'KeyV')
   await sleep(900)
   const opened = await controls(alice)
   check('V opens the deck while that button has focus', opened.board && opened.deck, JSON.stringify(opened))
   if (opened.deck) await alice.clickText('Close', { settle: 1200, kinds: 'button' })

   const paste = await alice.evaluate(`/mac/i.test(navigator.userAgent) ? 'meta' : 'ctrl'`)
   await focusSetup()
   await keyOnFocused(alice, 'v', 'KeyV', paste)
   await sleep(900)
   const pasted = await controls(alice)
   check(`and ${paste === 'meta' ? 'Cmd+V' : 'Ctrl+V'}, the paste key, does not`,
      pasted.board && !pasted.deck, JSON.stringify(pasted))

   /* and Space still presses the focused button rather than the board */
   await focusSetup()
   await keyOnFocused(alice, ' ', 'Space')
   await sleep(900)
   const stayedShut = await controls(alice)
   check('space on a focused button is still the button\'s own', stayedShut.board && !stayedShut.deck, JSON.stringify(stayedShut))
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
   const zeroed = await controls(alice)
   check('and nobody is told time is up for a clock that was set, not run out',
      zeroed.board && !zeroed.timeUp, JSON.stringify(zeroed))

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
      that only restated what the control already says are gone with it. So is
      "Card Size": a card on the board is the size of the zone it is in now, which
      is not a thing a slider can improve on.
   */
   check('and only settings that can be set are there',
      JSON.stringify(shape.map((s) => s.title)) === JSON.stringify(['Mulligans', 'VSTAR / GX marker', 'Board zones', 'Diagnostics']),
      JSON.stringify(shape.map((s) => s.title)))

   const described = await alice.evaluate(`[...document.querySelectorAll('.setting')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim())`)
   check('with nothing restating what a control already says',
      described.length > 0 && described.length === shape.length &&
         !described.some((t) => /Talonflame|once you have used that power|Outlines each area|events this browser has received|always shown in dark mode|Scale down the size of card images/.test(t)),
      JSON.stringify(described))

   /*
      The zone names, which are drawn with the zone outlines and only then: a line
      says where a zone begins, a word says which zone it is. They are board
      furniture rather than a setting of their own, so this reads them off the
      board - and reads them with the menu closed, because a name the menu is
      covering is a name this cannot say anything about.

      Read against the zone each one lands in rather than against the board, since
      that is where a name belongs: the active area is the one cell holding two
      zones, one per player, and its two names are centred in those.

      A name is also half strength with nothing behind it, and *under* the cards:
      the board's names come before the zones they name, so a card in the middle of
      a zone covers its name. That last one cannot be read the way the rest can -
      a name takes no pointer events, so the browser leaves it out of the stack at
      its own centre - so the stack is read with the label hit-testable for the
      moment it takes to read, which does not change what is painted where.
   */
   const cog = () => alice.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') || el.title) === 'Settings')
      if (b) b.click()
      return Boolean(b)
   })()`)

   const zoneLabels = () => alice.evaluate(`(() => {
      /*
         The zones, not the names: a name is a child of the board too, and asking
         which zone a name is in must not answer "itself". The veil is a shading
         over several zones rather than one of them.

         Two cells hold more than one zone per player, so their zones are a level
         below the cell rather than the cell itself: the active area's two rows,
         and the three bands of the Stadium's cell - a Power zone, the Stadium,
         and the other Power zone. A name is looked up against the smallest zone
         it falls in, which is what those are for.
      */
      const cells = [...document.querySelectorAll('.gameboard > div:not(.zone-label):not(.veil), .active > .active1, .active > .active2, .stadium-area > div:not(.zone-label)')]
         .map((el) => ({ cls: el.className, rect: el.getBoundingClientRect() }))

      return [...document.querySelectorAll('.zone-label')].map((el) => {
         /*
            The words themselves rather than the element around them. They are not
            always the same box: a name stretched to its zone - which the active
            area's first one was, caught by the rule that makes a zone's component
            fill its zone - has a box the size of the zone with its words at the
            top of it, and reads as a name in the wrong place.
         */
         const range = document.createRange()
         range.selectNodeContents(el)
         const rect = range.getBoundingClientRect()
         const box = el.getBoundingClientRect()
         const mid = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
         const x = Math.round(mid.x)
         const y = Math.round(mid.y)
         /*
            the smallest zone the name is in: for a name in the active area that is
            its own row rather than the two rows together.
         */
         const zone = cells
            .filter((c) => mid.x >= c.rect.left - 1 && mid.x <= c.rect.right + 1 &&
               mid.y >= c.rect.top - 1 && mid.y <= c.rect.bottom + 1)
            .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0]

         const under = document.elementFromPoint(x, y)
         const style = getComputedStyle(el)

         /* topmost first, with this label in the stack for the moment it is read */
         el.style.pointerEvents = 'auto'
         const stack = document.elementsFromPoint(x, y)
         el.style.pointerEvents = ''

         return {
            text: el.innerText.replace(/\\s+/g, ' ').trim(),
            lines: el.innerText.split('\\n').filter((line) => line.trim()).length,
            zone: zone ? zone.cls : null,
            centred: zone
               ? Math.abs(mid.x - (zone.rect.left + zone.rect.right) / 2) < 3 &&
                  Math.abs(mid.y - (zone.rect.top + zone.rect.bottom) / 2) < 3
               : false,
            /* a name whose box is the whole zone is a name in the wrong place */
            stretched: zone ? box.width >= zone.rect.width - 1 && box.height >= zone.rect.height - 1 : false,
            upright: style.transform === 'none',
            clickable: under === el || el.contains(under),
            opacity: style.opacity,
            colour: style.color,
            background: style.backgroundColor,
            /* where the name is in the stack, and where the topmost card is */
            at: stack.indexOf(el),
            cardAt: stack.findIndex((node) => node.tagName === 'IMG' && node.classList.contains('card'))
         }
      })
   })()`)

   /* whatever an earlier run left behind, this reads the board from outlines off */
   const outlineBox = () => alice.evaluate(`(() => {
      const label = [...document.querySelectorAll('.setting label')].find((l) => /Show borders/.test(l.textContent))
      const input = label && label.querySelector('input')
      if (!input) return null
      if (input.checked) input.click()
      return input.checked
   })()`)

   check('the zone outlines are off to begin with', (await outlineBox()) === false)
   await sleep(800)
   check('so the board carries no zone names', (await zoneLabels()).length === 0, JSON.stringify(await zoneLabels()))

   await alice.clickText('Show borders around the board zones', { settle: 900, kinds: 'label' })
   await sleep(500)
   await cog()
   await sleep(900)

   const named = await zoneLabels()
   /* sorted, so the check is about which names are there and not where they land */
   const tally = (names) => Object
      .entries(names.reduce((all, name) => ({ ...all, [name]: (all[name] || 0) + 1 }), {}))
      .sort()
   /* the alpha channel of a computed colour, which is where "half strength" lives */
   const alpha = (colour) => {
      const parts = String(colour).match(/rgba?\(([^)]+)\)/)
      if (!parts) return null
      const values = parts[1].split(',').map((v) => Number(v.trim()))
      return values.length === 4 ? values[3] : 1
   }
   check('turning the outlines on names every zone', named.length === 18, JSON.stringify(named.map((l) => l.text)))
   check('both halves, with the table named once and the Stadium\'s cell named per band',
      JSON.stringify(tally(named.map((l) => l.text))) === JSON.stringify([
         ['Active', 2], ['Bench', 2], ['Deck', 2], ['Discard', 2], ['Hand', 2],
         ['Lost Zone', 2], ['Pokemon Power', 2], ['Prizes', 2], ['Stadium', 1], ['Table', 1]
      ]),
      JSON.stringify(tally(named.map((l) => l.text))))
   check('each name in the middle of its own zone, and none of them turned over',
      named.length > 0 && named.every((l) => l.centred && l.upright),
      JSON.stringify(named.filter((l) => !l.centred || !l.upright)))
   /*
      The words, not the box around them: the active area's first name is the first
      child of a cell, and the rule that makes a zone's component fill its zone
      caught it and stretched it - so its words sat at the top of the zone while
      its box was the zone itself, and reading the box said "centred" either way.
   */
   check('and none of them stretched to the zone it names',
      named.length > 0 && named.every((l) => !l.stretched), JSON.stringify(named.filter((l) => l.stretched)))
   check('a name of two words broken over its two lines',
      named.filter((l) => / /.test(l.text)).every((l) => l.lines === 2) &&
         named.filter((l) => !/ /.test(l.text)).every((l) => l.lines === 1),
      JSON.stringify(named.map((l) => [l.text, l.lines])))
   /*
      The half strength is in the name's own colour rather than its `opacity`, and
      that is worth asserting rather than assuming: an element with opacity is a
      layer of its own, which lifts it over every card in a zone whose own markup
      is not positioned - the stadium, for one - instead of leaving it under them.
   */
   check('each name is half strength, in its own colour, with no plate behind it',
      named.length > 0 && named.every((l) => alpha(l.colour) === 0.5 && l.opacity === '1' &&
         (l.background === 'rgba(0, 0, 0, 0)' || l.background === 'transparent')),
      JSON.stringify(named.map((l) => [l.text, l.colour, l.opacity, l.background])))
   check('and a card in the middle of a zone covers its name rather than the other way round',
      named.filter((l) => l.cardAt !== -1).length > 0 &&
         named.filter((l) => l.cardAt !== -1).every((l) => l.at > l.cardAt && l.cardAt === 0),
      JSON.stringify(named.map((l) => [l.text, l.cardAt, l.at])))
   check('and a name takes no click, so the zone under it still does',
      named.length > 0 && named.every((l) => !l.clickable), JSON.stringify(named.filter((l) => l.clickable)))

   /*
      The outline itself: a solid line at half strength, on every zone and on both
      halves. Read as a colour rather than as a style name, because "50%" is the
      alpha channel of it.
   */
   const outlines = await alice.evaluate(`[...document.querySelectorAll('.gameboard > div:not(.veil):not(.zone-label), .active > .active1, .active > .active2, .stadium-area > div:not(.zone-label)')]
      .map((el) => {
         const style = getComputedStyle(el)
         return { cls: el.className.split(' ')[0], style: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor }
      })`)
   check('every zone is outlined', outlines.length >= 18, String(outlines.length))
   check('with a solid line', outlines.every((o) => o.style === 'solid'), JSON.stringify(outlines.filter((o) => o.style !== 'solid')))
   check('at half strength', outlines.every((o) => alpha(o.colour) === 0.5), JSON.stringify(outlines.map((o) => [o.cls, o.colour])))
   check('and the Stadium\'s three bands are among them',
      ['power2', 'stadium', 'power'].every((band) => outlines.some((o) => o.cls === band)), JSON.stringify(outlines.map((o) => o.cls)))

   /*
      Where the Power zones are, measured rather than assumed: the Stadium's cell
      splits into three bands, each Power zone takes a quarter of the cell and the
      Stadium the middle half, and each zone sits between its own player's bench
      and the Stadium - the near one under the Stadium and over the near bench, the
      far one the other way up.
   */
   const bands = await alice.evaluate(`(() => {
      const rect = (sel) => {
         const el = document.querySelector(sel)
         if (!el) return null
         const r = el.getBoundingClientRect()
         return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
      }
      const area = rect('.stadium-area')
      const cell = area ? area.height : 0
      const share = (r) => (r && cell ? r.height / cell : 0)
      return {
         area,
         power2: rect('.stadium-area > .power2'),
         stadium2: rect('.stadium-area > .stadium2'),
         power: rect('.stadium-area > .power'),
         nearBench: rect('.gameboard > .bench'),
         farBench: rect('.gameboard > .bench2'),
         share: { power2: share(rect('.stadium-area > .power2')), power: share(rect('.stadium-area > .power')), stadium: share(rect('.stadium-area > .stadium')) }
      }
   })()`)
   check('a Power zone is a quarter of the Stadium\'s cell, top and bottom',
      Math.abs(bands.share.power2 - 0.25) < 0.02 && Math.abs(bands.share.power - 0.25) < 0.02,
      JSON.stringify(bands.share))
   check('which leaves the Stadium the middle half of it',
      Math.abs(bands.share.stadium - 0.5) < 0.02, JSON.stringify(bands.share))
   check('and the two Stadiums still share that one band',
      bands.stadium2 && Math.abs(bands.stadium2.top - bands.power2.bottom) < 2 && Math.abs(bands.stadium2.bottom - bands.power.top) < 2,
      JSON.stringify({ power2: bands.power2, stadium2: bands.stadium2, power: bands.power }))
   check('the near Power zone is between the Stadium and the near bench',
      bands.power.bottom <= bands.nearBench.top + 2, JSON.stringify({ power: bands.power, bench: bands.nearBench }))
   check('and the far one between the far bench and the Stadium',
      bands.farBench.bottom <= bands.power2.top + 2, JSON.stringify({ power2: bands.power2, bench: bands.farBench }))

   /* the menu this section found open is left open, and the outlines as they were */
   await cog()
   await sleep(700)
   const offAgain = await outlineBox()
   await sleep(800)
   check('turning them off is what puts the names away',
      offAgain === false && (await zoneLabels()).length === 0, JSON.stringify(await zoneLabels()))

   /*
      The table is the one zone with no number on it. It is where cards are played
      rather than a pile anybody counts, and both of its halves ask for no number -
      but the far half's asked a component that had never declared the prop, so the
      count was drawn there on every board. The piles that are counted still show
      theirs, which is what says the number went rather than the badge.
   */
   const counted = () => alice.evaluate(`(() => {
      const zoneOf = (el) => {
         const cell = el.closest('.gameboard > div')
         return cell ? cell.className.split(' ')[0] : null
      }
      const zones = [...document.querySelectorAll('.gameboard .count')].map(zoneOf)
      return {
         tables: zones.filter((zone) => zone === 'play' || zone === 'play2'),
         missing: ['deck', 'deck2', 'discard', 'discard2', 'lz', 'lz2', 'prizes', 'prizes2', 'hand', 'hand2']
            .filter((zone) => !zones.includes(zone))
      }
   })()`)

   const badges = await counted()
   check('neither table zone carries a number', badges.tables.length === 0, JSON.stringify(badges))
   check('while every pile that is counted still shows its own', badges.missing.length === 0, JSON.stringify(badges))

   check('the marker list ends with Both', (await alice.evaluate(`[...document.querySelectorAll('input[name="powerMarker"]')].map((i) => i.parentElement.textContent.trim()).join(',')`)) === 'Off,VStar,GX,Both')

   await alice.clickText('Both', { settle: 1500, kinds: 'label' })
   await sleep(2500)
   /* the whole list is what a missing marker is reported as, so a board with no
      marks on it reads as [] rather than as nothing at all */
   const shown = await markers(alice)
   const mine = shown.find((m) => m.mine)
   check('Both shows the two marks together', JSON.stringify(mine?.marks) === JSON.stringify(['VSTAR', 'GX']), JSON.stringify(mine ?? shown))
   check('paired, not one instead of the other', mine?.paired === true, JSON.stringify(mine ?? shown))
   /*
      The pair shares the dimension its zone has to give. The band it sits in is
      wide and short, so the two logos lie along it and are the same *height* -
      the two images are different shapes, and forcing one width on both would
      leave the taller one sticking out of the band.
   */
   check('and the two marks are the same height',
      Array.isArray(mine?.heights) && mine.heights.length === 2 && mine.heights[0] === mine.heights[1],
      JSON.stringify(mine?.heights ?? shown))
   check('with a gap between them so they do not read as one mark', parseFloat(mine?.gap || '0') > 0, mine?.gap ?? JSON.stringify(shown))
   check('and neither is dimmed to begin with', Array.isArray(mine?.used) && mine.used.length === 0, JSON.stringify(mine ?? shown))
   /*
      The markers are in the Pokemon Power zones now - the quarter of the
      Stadium's cell above it, and the quarter below - rather than floating in the
      free space past the opponent's deck, and they are sized by that band.
   */
   check('the player\'s marks are in the near Power zone', mine?.zone === 'power', JSON.stringify(shown.map((m) => m.zone)))
   check('and a mark fills the band it is in', shown.every((m) => m.fill > 0.9), JSON.stringify(shown.map((m) => m.fill)))

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
   const vstarShown = await markers(alice)
   const afterVstar = vstarShown.find((m) => m.mine)
   check('using VSTAR dims only VSTAR', JSON.stringify(afterVstar?.used) === JSON.stringify(['VSTAR']), JSON.stringify(afterVstar?.used ?? vstarShown))
   check('and says so in the log', /Used VStar/.test(await alice.evaluate(`document.querySelector('.chat')?.innerText || ''`)), 'log')

   check('GX is clickable on its own too', await clickMark(alice, 'GX'))
   await sleep(2000)
   const bothShown = await markers(alice)
   const afterBoth = bothShown.find((m) => m.mine)
   check('using GX dims GX as well, and leaves the two apart',
      JSON.stringify((afterBoth?.used || []).slice().sort()) === JSON.stringify(['GX', 'VSTAR']),
      JSON.stringify(afterBoth?.used ?? bothShown))
   check('and the log names GX, not the pair', /Used GX/.test(await alice.evaluate(`document.querySelector('.chat')?.innerText || ''`)), 'log')

   /* clicking one again takes only that one back */
   await clickMark(alice, 'VSTAR')
   await sleep(1500)
   const undoShown = await markers(alice)
   const afterUndo = undoShown.find((m) => m.mine)
   check('clicking a used mark takes just that one back',
      JSON.stringify(afterUndo?.used) === JSON.stringify(['GX']),
      JSON.stringify(afterUndo?.used ?? undoShown))

   await sleep(3000)
   const farShown = await markers(bob)
   const far = farShown.find((m) => !m.mine)
   check('the opponent sees both as well', JSON.stringify(far?.marks) === JSON.stringify(['VSTAR', 'GX']), JSON.stringify(far ?? farShown))
   check('with the used one dimmed on their side too', JSON.stringify(far?.used) === JSON.stringify(['GX']), JSON.stringify(far?.used ?? farShown))
   /* and on their board it is the far Power zone, the one above the Stadium */
   check('and in the far Power zone, above their Stadium', far?.zone === 'power2', JSON.stringify(farShown.map((m) => m.zone)))

   const turnedOff = await alice.clickText('Off', { settle: 1500, kinds: 'label' })
   await sleep(2000)
   const cleared = await controls(alice)
   const left = await markers(alice)
   check('turning it off clears them', turnedOff && cleared.board && left.length === 0,
      JSON.stringify({ turnedOff, board: cleared.board, marks: left }))

   clearInterval(answering)
}

await browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
