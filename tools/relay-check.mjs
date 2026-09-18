/*
 * The relay's own behaviour, checked against a running deployment.
 *
 * Four things this project has got wrong, and that a change can get wrong
 * again without anything on screen to say so:
 *
 *   leaving    a room is a game, so it closes when no playing seat is occupied -
 *              a spectator must never be able to hold a dead one open
 *   restart    a room belongs to the deployment that made it, so a new build
 *              closes the old rooms rather than replaying them into new handlers
 *   idle       a room where nothing has been *done* is prompted, and a prompt
 *              nobody answers closes it; presence is not activity
 *   sweeping   a killed tab stops being counted, without any cron
 *
 * It is written to run against a server started with SHORT windows, so the whole
 * ten-minutes-then-ten-minutes lifecycle happens in seconds:
 *
 *   node tools/fake-redis.mjs &
 *   RELAY_IDLE_MS=3000 RELAY_PROMPT_MS=5000 RELAY_MEMBER_STALE_MS=8000 \
 *   RELAY_POLL_WAIT_MS=1000 RELAY_POLL_INTERVAL_MS=300 \
 *   KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev &
 *   node tools/relay-check.mjs
 *
 *   BASE=https://your-app.vercel.app node tools/relay-check.mjs
 *
 * Against a deployment with the default ten-minute windows it runs the checks
 * that do not depend on timing and says plainly which ones it skipped, rather
 * than either failing or pretending to have tested them.
 *
 * It needs the room store to answer directly for two of the checks (re-stamping
 * a room's epoch, and reading a room's metadata), so it speaks Upstash's REST
 * protocol if it is given a URL and a token:
 *
 *   REDIS_URL=... REDIS_TOKEN=... node tools/relay-check.mjs
 *
 * Read-only outside the rooms it creates itself. Every room it makes is its own,
 * and they are all closed or left to expire on their own.
 */

const BASE = (process.env.BASE || 'http://localhost:3005').replace(/\/+$/, '')
const REDIS_URL = (process.env.REDIS_URL || process.env.FAKE || 'http://127.0.0.1:6390').replace(/\/+$/, '')
const REDIS_TOKEN = process.env.REDIS_TOKEN || 'local'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ wire -- */

async function request (path, { method = 'GET', body } = {}) {
   const options = { method, headers: {} }
   if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
   }

   const res = await fetch(BASE + path, options)
   const text = await res.text()

   let parsed
   try {
      parsed = text ? JSON.parse(text) : {}
   } catch {
      throw new Error(`${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`)
   }

   return { status: res.status, body: parsed }
}

const get = (path) => request(path)
const post = (path, body) => request(path, { method: 'POST', body })

const create = (name = 'Check') => post('/api/relay/room', { action: 'create', name })
const join = (roomId, name = 'Other', memberId = null) => post('/api/relay/room', { action: 'join', roomId, name, memberId })
const spectate = (roomId, name = 'Watcher', memberId = null) => post('/api/relay/room', { action: 'join', roomId, name, role: 'spectator', memberId })
const leave = (roomId, memberId) => post('/api/relay/room', { action: 'leave', roomId, memberId })
const emit = (roomId, memberId, event, data = {}) => post('/api/relay/events', { roomId, memberId, event, data })
const summary = (roomId) => get(`/api/relay/room?roomId=${encodeURIComponent(roomId)}`)
const poll = (roomId, memberId, since = 0, wait = 0) =>
   get(`/api/relay/poll?roomId=${encodeURIComponent(roomId)}&memberId=${encodeURIComponent(memberId || '')}&since=${since}&wait=${wait}`)

/* the store, spoken to directly - only used where the relay cannot help */
async function redis (...args) {
   const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
   })
   if (!res.ok) throw new Error(`store ${args[0]} failed: ${res.status}`)
   const body = await res.json()
   if (body.error) throw new Error(`store error: ${body.error}`)
   return body.result
}

const readMeta = async (roomId) => {
   const raw = await redis('GET', `pvp:room:${roomId}:meta`)
   return raw ? JSON.parse(raw) : null
}

const writeMeta = (roomId, meta) => redis('SET', `pvp:room:${roomId}:meta`, JSON.stringify(meta))

/* --------------------------------------------------------------- report -- */

let passed = 0
let failed = 0
let skipped = 0

const check = (label, ok, detail = '') => {
   if (ok) {
      passed++
      console.log(`  ok    ${label}${detail ? ` - ${detail}` : ''}`)
   } else {
      failed++
      console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`)
   }
   return ok
}

const skip = (label, why) => {
   skipped++
   console.log(`  skip  ${label} - ${why}`)
}

/* Poll a room until its reply says something worth looking at. A poll of wait=0
   returns at once, so this is a tight loop against the relay's own clock. */
async function pollUntil (roomId, memberId, predicate, { timeout = 30000 } = {}) {
   const deadline = Date.now() + timeout
   for (;;) {
      const res = await poll(roomId, memberId)
      if (predicate(res.body)) return res.body
      if (Date.now() > deadline) return res.body
      await sleep(150)
   }
}

/* ------------------------------------------------------------------ main -- */

console.log(`relay check against ${BASE}`)

let health
try {
   health = (await get('/api/relay/health')).body
} catch (err) {
   console.error(`cannot reach the relay at ${BASE}: ${err.message}`)
   process.exit(2)
}

if (!health.ok) {
   console.error(`the relay is not usable: ${JSON.stringify(health)}`)
   process.exit(2)
}

const IDLE = Number(health.idle?.idleMs) || 0
const PROMPT = Number(health.idle?.promptMs) || 0
const STALE = Number(health.idle?.memberStaleMs) || 0
const fast = IDLE > 0 && IDLE <= 30000 && PROMPT <= 60000
const quick = STALE > 0 && STALE <= 30000

console.log(`  store ${health.store}${health.from ? ` (from ${health.from})` : ''}, epoch ${health.epoch}`)
console.log(`  idle ${IDLE}ms, prompt ${PROMPT}ms, member stale ${STALE}ms, poll hold ${health.poll?.waitMs}ms`)
if (!fast) console.log('  windows are the production ones: the timing checks will be skipped')

/* ------------------------------------------------------- 1. leaving ------- */

console.log('\nleaving')
{
   const a = (await create()).body
   const b = (await join(a.roomId)).body
   const w = (await spectate(a.roomId)).body

   const left = await leave(a.roomId, a.memberId)
   check('one player leaving a live game keeps the room open', left.body.closed === false, JSON.stringify(left.body))

   const bPoll = await poll(a.roomId, b.memberId)
   check('the remaining player is not evicted', bPoll.body.gone !== true)
   check('and holds the only seat', bPoll.body.players?.length === 1, JSON.stringify(bPoll.body.players))

   const last = await leave(a.roomId, b.memberId)
   check('the last player leaving closes the room', last.body.closed === true && last.body.reason === 'playerLeft', JSON.stringify(last.body))

   const wPoll = await poll(a.roomId, w.memberId)
   check('the spectator is told it is gone', wPoll.body.gone === true, JSON.stringify(wPoll.body))
   check('as a closed game rather than an expiry', wPoll.body.reason === 'closed', String(wPoll.body.reason))

   check('the room is gone from the lobby', (await summary(a.roomId)).status === 404)
}

{
   const a = (await create()).body
   const b = (await join(a.roomId)).body
   const w = (await spectate(a.roomId)).body

   check('a spectator is counted', (await summary(a.roomId)).body.spectators === 1)
   const left = await leave(a.roomId, w.memberId)
   check('a spectator leaving does not close the room', left.body.closed === false, JSON.stringify(left.body))
   check('and the count drops', (await summary(a.roomId)).body.spectators === 0)
   check('the players are untouched', (await summary(a.roomId)).body.players === 2)
}

{
   const a = (await create()).body
   await leave(a.roomId, a.memberId)
   check('a player alone in a room closes it by leaving', (await summary(a.roomId)).status === 404)
}

{
   const missing = await poll('ZZZZZZ', 'nobody')
   check('an unknown room reads as expired, not closed', missing.body.gone === true && missing.body.reason === 'expired', JSON.stringify(missing.body))
}

/* ------------------------------------------------------- 2. restart ------- */

console.log('\nrestart')
if (!health.epoch) {
   skip('a room carries the deployment epoch', 'the health probe does not report one')
} else {
   const a = (await create()).body
   const meta = await readMeta(a.roomId)
   check('a new room is stamped with the deployment epoch', meta?.epoch === health.epoch, `${meta?.epoch}`)

   await writeMeta(a.roomId, { ...meta, epoch: 'boot:some-previous-deployment' })
   const gone = await poll(a.roomId, a.memberId)
   check('a room from another deployment reads as gone', gone.body.gone === true, JSON.stringify(gone.body))
   check('and as a closed game', gone.body.reason === 'closed', String(gone.body.reason))
   check('the stale room is deleted', (await readMeta(a.roomId)) === null)
   check('and cannot be joined back into', (await join(a.roomId)).status === 404)
}

/* ---------------------------------------------------------- 3. idle ------- */

console.log('\nidle')
if (!fast) {
   skip('an idle room is prompted', `idle window is ${IDLE}ms`)
   skip('a prompt carries the relay clock', '')
   skip('an unanswered prompt closes the room', '')
   skip('answering keeps the room open', '')
   skip('activity (not presence) resets the clock', '')
} else {
   const a = (await create()).body
   const b = (await join(a.roomId)).body

   const prompt = await pollUntil(a.roomId, a.memberId, (body) => body.idle || body.gone)
   check('an idle room is prompted', Boolean(prompt.idle), JSON.stringify(prompt.idle))
   check('the prompt carries the relay clock it was raised at', typeof prompt.idle?.at === 'number', JSON.stringify(prompt.idle))
   check('and the window the deployment runs with', prompt.idle?.promptMs === PROMPT, JSON.stringify(prompt.idle))

   const names = (await redis('LRANGE', `pvp:room:${a.roomId}:events`, '0', '20') || []).map((line) => JSON.parse(line).name)
   check('the prompt is a normal relayed event', names.includes('idlePrompt'), JSON.stringify(names))

   const late = (await spectate(a.roomId)).body
   check('a late joiner replays into the prompt', (late.events || []).some((e) => e.name === 'idlePrompt'), JSON.stringify((late.events || []).map((e) => e.name)))

   const dismissed = await emit(a.roomId, b.memberId, 'idleDismissed')
   check('answering is relayed', dismissed.status === 200 && dismissed.body.event?.name === 'idleDismissed')
   check('and the room stops waiting for an answer', Number((await readMeta(a.roomId)).idlePromptedAt) === 0)
   check('the room stays open', (await summary(a.roomId)).status === 200)

   /*
      The second prompt, and then the close, are watched by BOTH players still
      polling. That matters when the deployment's stale window is short: a room
      whose players have aged out closes because it has no players, which is a
      different (and correct) reason - so this check has to keep them alive to
      be testing the prompt at all.
   */
   const keepAlive = setInterval(() => {
      poll(a.roomId, a.memberId).catch(() => {})
      poll(a.roomId, b.memberId).catch(() => {})
   }, Math.max(300, Math.floor((PROMPT + IDLE) / 6)))

   try {
      const observed = await pollUntil(a.roomId, a.memberId, (body) => body.idle || body.gone, { timeout: IDLE + PROMPT + 20000 })
      check('it is prompted again a window later', Boolean(observed.idle), JSON.stringify(observed.idle || observed.reason))

      const closed = await pollUntil(a.roomId, a.memberId, (body) => body.gone, { timeout: PROMPT + 20000 })
      check('an unanswered prompt closes the room', closed.gone === true, JSON.stringify(closed))
      check('and says it was idle', closed.reason === 'idle', String(closed.reason))
   } finally {
      clearInterval(keepAlive)
   }

   /* activity resets the clock: a room with events is never prompted */
   const busy = (await create()).body
   const other = (await join(busy.roomId)).body
   const deadline = Date.now() + IDLE * 2 + 4000
   while (Date.now() < deadline) {
      await emit(busy.roomId, other.memberId, 'boardReset')
      await sleep(Math.max(200, IDLE / 3))
   }
   const names2 = (await redis('LRANGE', `pvp:room:${busy.roomId}:events`, '0', '40') || []).map((line) => JSON.parse(line).name)
   check('appended events count as activity, so no prompt is raised', !names2.includes('idlePrompt'), JSON.stringify(names2.slice(0, 6)))
}

/* -------------------------------------------------------- 4. sweeping ----- */

console.log('\nsweeping stale members')
if (!quick) {
   skip('a killed spectator stops being counted', `member stale window is ${STALE}ms`)
} else {
   const a = (await create()).body
   const b = (await join(a.roomId)).body
   const w = (await spectate(a.roomId)).body
   check('the watcher is counted to begin with', (await summary(a.roomId)).body.spectators === 1)

   const deadline = Date.now() + STALE + 20000
   let spectators = 1
   let absent = false
   while (Date.now() < deadline) {
      await emit(a.roomId, b.memberId, 'boardReset')
      const res = await poll(a.roomId, b.memberId)
      if (res.body.gone) { absent = true; break }
      spectators = res.body.opponent?.spectators
      if (spectators === 0) break
      await sleep(300)
   }

   check('a killed spectator stops being counted', spectators === 0, `spectators=${spectators}`)
   check('and the room is still open for the players', absent === false && (await summary(a.roomId)).status === 200)
}

/* --------------------------------------------------------------- verdict -- */

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`)
if (failed) console.log('verdict: the relay does not behave as documented')
else if (skipped) console.log('verdict: everything that could be checked here passed')
else console.log('verdict: all checks passed')

process.exitCode = failed ? 1 : 0
