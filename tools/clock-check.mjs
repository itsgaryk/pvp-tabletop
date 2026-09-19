/*
 * The table clock, on two real browsers at once, over time.
 *
 * Why this is its own tool rather than a section of browser-check.mjs: it is the
 * only check in this project that is about *time*, so it has to run for twenty
 * seconds without anything else wanting the page, and it sets up the room it
 * needs itself. A section that continued in whatever room another section left
 * open was a section that could be skipped - and the fault it exists for (a
 * client that throws while a board is being built, so the room will not open)
 * shows up as every later section failing for the wrong reason.
 *
 * What it checks, and why each one is worth a browser:
 *
 *   the clock opens      a room's clock appears and reads 50:00. This is the one
 *                        that catches a client-side crash in the clock component
 *                        - which is a room that never opens (seen once: a store
 *                        read in a top-level declaration, before Svelte's own
 *                        subscription for it exists)
 *   it counts down       sampled every 700ms for twelve seconds: never up,
 *                        never stuck for three samples, never several seconds at
 *                        once, and the two players never drift apart
 *   it is the table's    the clock reads the same on both boards, and neither
 *                        follows the other's machine clock
 *   a wall-clock jump    one browser's `Date.now()` moved +8s and then -9s. The
 *                        countdown must not notice either: a machine being
 *                        corrected by NTP is not time passing on the table
 *
 * One browser per page, started outside, exactly as browser-check.mjs needs:
 *
 *   $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
 *   foreach ($port in 9222, 9223) {
 *      $profile = Join-Path $env:TEMP "pvp-chrome-$port"
 *      New-Item -ItemType Directory -Force -Path $profile | Out-Null
 *      Start-Process -FilePath $chrome -ArgumentList '--headless=new','--disable-gpu',
 *         '--no-first-run','--no-default-browser-check',"--remote-debugging-port=$port",
 *         "--user-data-dir=$profile",'--window-size=1277,821','about:blank'
 *   }
 *
 *   KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev &
 *   node tools/clock-check.mjs
 *
 *   CDP_PORTS=9222,9223 node tools/clock-check.mjs
 *
 * The dev server's idle windows have to be longer than this run: it is a clock,
 * so it deliberately sits still for twenty seconds at a time, and a room that
 * prompts - or closes - for inactivity in the middle of that reports the room
 * ending rather than the clock being wrong. Two minutes is comfortable.
 */
import { attach, sleep } from './browser.mjs'

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')

let failures = 0
const check = (label, ok, detail = '') => {
   console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const health = await (await fetch(`${BASE}/api/relay/health`)).json()
console.log(`clock check against ${BASE}`)
console.log(`  idle ${health.idle?.idleMs}ms, epoch ${health.epoch}`)

const browser = await attach()
const [alice, bob] = await browser.pages(2)
await browser.setViewport(1277, 821)
for (const page of [alice, bob]) page.autoDialogs(true)

/*
   The dev server re-optimises dependencies on and off, and a page whose imports
   are in flight while it does lands on SvelteKit's error page - a fact about
   `vite dev`, not about the app.
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

const clockOf = (page) => page.evaluate(`(() => {
   const el = document.querySelector('.timer-row .clock')
   return el ? el.textContent.trim() : null
})()`)

const secs = (text) => {
   const parts = String(text || '').split(':').map(Number)
   if (parts.some((n) => !Number.isFinite(n))) return null
   return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1]
}

/* both boards in a room, which is all this needs: no decks, no setup */
console.log('\ntwo players in a room')
await Promise.all([lobby(alice, 'alice'), lobby(bob, 'bob')])
const room = await alice.createRoom('Alice')
await bob.joinRoom(room, 'Bob')
await sleep(2500)

check('the room opened at all', (await alice.counts()).mode === 'room', (await alice.counts()).mode)
check('and the other player is in it', (await bob.counts()).mode === 'room', (await bob.counts()).mode)
check('a room clock starts at fifty minutes', (await clockOf(alice)) === '50:00', await clockOf(alice))
check('and the other board reads the same', (await clockOf(bob)) === '50:00', await clockOf(bob))

/* six minutes, running: long enough that the count is obvious, short enough to read */
console.log('\na running clock, sampled for twelve seconds')
await alice.clickText('50:00', { settle: 800, kinds: 'button' })
await alice.evaluate(`(() => {
   const set = (name, value) => {
      const el = document.querySelector('input[name="' + name + '"]')
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
   }
   set('timerMinutes', '6')
   set('timerSeconds', '0')
   return true
})()`)
await sleep(300)
await alice.clickText('OK', { settle: 1500, kinds: 'button' })
check('setting the time works', (await clockOf(alice)) === '06:00', await clockOf(alice))

await alice.clickText('\u23EF\uFE0F', { settle: 1500, kinds: 'button' })
await sleep(2500)
check('the play button starts it', secs(await clockOf(alice)) < 360, await clockOf(alice))

const SAMPLE_MS = 700
const SAMPLES = 17
const mine = []
const theirs = []

for (let i = 0; i < SAMPLES; i++) {
   mine.push(secs(await clockOf(alice)))
   theirs.push(secs(await clockOf(bob)))
   await sleep(SAMPLE_MS)
}

const known = (list) => list.filter((value) => value !== null)
const a = known(mine)
const b = known(theirs)

const backwards = (list) => list.reduce((worst, value, i) =>
   i && value > list[i - 1] ? Math.max(worst, value - list[i - 1]) : worst, 0)

check('both boards drew the clock throughout',
   a.length === SAMPLES && b.length === SAMPLES,
   `alice ${a.length}/${SAMPLES}, bob ${b.length}/${SAMPLES}`)
check('the clock never counts up on the player who set it', backwards(a) === 0, `gained ${backwards(a)}s`)
check('nor on the other player', backwards(b) === 0, `gained ${backwards(b)}s`)

/*
   Readings are taken every 700ms against a clock that ticks in whole seconds, so
   a sample may show the same second twice and may skip one - but a *run* of them
   is a clock that has stopped, and a three-second drop in 700ms is one that
   stopped and then jumped. Both are the fault this is here to catch, and neither
   is the sampling.
*/
const gaps = (list) => list.slice(1).map((value, i) => list[i] - value)
const worstGap = (list) => gaps(list).reduce((worst, gap) => Math.max(worst, gap), 0)
const stuckFor = (list) => {
   let longest = 1
   let run = 1
   for (let i = 1; i < list.length; i++) {
      run = list[i] === list[i - 1] ? run + 1 : 1
      longest = Math.max(longest, run)
   }
   return longest
}
check('no second is shown over and over while the clock runs',
   stuckFor(a) < 3 && stuckFor(b) < 3,
   `alice ${stuckFor(a)}, bob ${stuckFor(b)}`)
check('and it never drops several seconds at once',
   worstGap(a) <= 3 && worstGap(b) <= 3,
   `worst gap alice ${worstGap(a)}s, bob ${worstGap(b)}s`)

/*
   And the two agree. They cannot read the same to the second - one of them set
   the clock, and either may be shown a value a round trip later - so what is
   checked is that neither has *drifted*: the gap between them at the end is the
   gap at the start.
*/
const gapAt = (i) => Math.abs(a[i] - b[i])
const gapStart = gapAt(0)
const gapEnd = gapAt(a.length - 1)
check('the two players read the same clock, not two of them',
   gapStart <= 1 && gapEnd <= 1 && Math.abs(gapEnd - gapStart) <= 1,
   `gap ${gapStart}s at the start, ${gapEnd}s at the end`)
check('and it really ran for the twelve seconds sampled',
   a[0] - a[a.length - 1] >= 10 && a[0] - a[a.length - 1] <= 14, `${a[0]}s -> ${a[a.length - 1]}s`)

/*
   The clock, on a browser whose wall clock has moved under it. This is the one
   thing a countdown must not notice: the machine's clock being corrected - by
   NTP, by the user, by waking from sleep - is not time passing on the table, and
   a clock that jumps because the laptop did is a clock nobody can trust.
*/
console.log('\nthe wall clock moved under one browser')
const jump = (page, seconds) => page.evaluate(`(() => {
   const real = Date.now
   Date.now = () => real.call(Date) + ${seconds}
   window.__restoreClock = () => { Date.now = real }
   return true
})()`)

await jump(alice, 8000)
const before = secs(await clockOf(alice))
await sleep(6000)
const afterJump = await clockOf(alice)
const after = secs(afterJump)
await alice.evaluate(`window.__restoreClock && window.__restoreClock()`)

check('a wall clock that jumps forward does not move the clock on screen',
   before - after >= 4 && before - after <= 7,
   `${before} -> ${afterJump}`)

await jump(alice, -9000)
const beforeBack = secs(await clockOf(alice))
await sleep(4000)
const afterBack = secs(await clockOf(alice))
await alice.evaluate(`window.__restoreClock && window.__restoreClock()`)

check('and one that jumps backward does not freeze it either',
   beforeBack - afterBack >= 2 && beforeBack - afterBack <= 5,
   `${beforeBack} -> ${afterBack}`)

/* the other player never saw any of it */
const bobStill = await clockOf(bob)
check('neither player sees the other\'s machine clock',
   secs(bobStill) !== null && Math.abs(secs(bobStill) - afterBack) <= 2,
   `${bobStill} vs alice ${afterBack}`)

/* leave the clock stopped, and the room closed */
await alice.clickText('\u23EF\uFE0F', { settle: 1200, kinds: 'button' })
await alice.clickText('Leave Room', { settle: 1500, kinds: 'button' })

await browser.detach()
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed')
process.exitCode = failures ? 1 : 0
