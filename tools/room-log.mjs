/*
 * A room's story, in one command.
 *
 * Reading a broken room by hand - fetch /api/relay/poll?since=0, scan for the
 * last boardState, look for a boardReset - is exactly the improvised work this
 * replaces, because it is easy to scan badly and reach the wrong conclusion.
 *
 *   node tools/room-log.mjs ABC123                 # against the dev server
 *   BASE=https://your-app.vercel.app node tools/room-log.mjs ABC123
 *   node tools/room-log.mjs ABC123 --json > room.json
 *   node tools/room-log.mjs ABC123 --tail 40
 *
 * It is **read-only**, and deliberately so: it never sends a memberId, so the
 * relay refreshes no presence for it and the room's own cost is unaffected. It
 * spends only the store reads a poll always spends, and none of the writes.
 *
 * The summary at the end is the point: a "board is blank" verdict names the
 * sequence number of the last full state and the reset that wiped it, so the
 * answer to "is it the state or the client?" comes from the relay's own log
 * rather than from a guess.
 *
 * Note on pagination: the poll route replies with the room's *latest* seq even
 * when it had to trim the batch it returned, so the cursor here advances by the
 * highest seq actually received, never by the reply's `seq`. Using the reply's
 * value would silently skip a page of a busy room.
 */

const POLL_PAGE = 200 // the poll route's per-response event cap

/* ------------------------------------------------------------------- args -- */

const argv = process.argv.slice(2)
/*
   `localhost` rather than 127.0.0.1: `vite dev` binds IPv6 (::1) on some
   machines and an IPv4 literal is then refused outright, while `localhost`
   resolves to whichever the server actually bound.
*/
const opts = { base: process.env.BASE || 'http://localhost:3005', json: false, tail: 0, help: false }
let room = null

for (let i = 0; i < argv.length; i++) {
   const arg = argv[i]

   if (arg === '--json') opts.json = true
   else if (arg === '--help' || arg === '-h') opts.help = true
   else if (arg === '--tail') opts.tail = Number(argv[++i]) || 0
   else if (arg.startsWith('--tail=')) opts.tail = Number(arg.slice(7)) || 0
   else if (arg === '--base') opts.base = argv[++i] || opts.base
   else if (arg.startsWith('--base=')) opts.base = arg.slice(7)
   else if (arg.startsWith('-')) fail(`unknown option ${arg}`)
   else if (!room) room = arg
   else fail(`unexpected argument ${arg}`)
}

function fail (message) {
   console.error(`room-log: ${message}`)
   console.error('usage: node tools/room-log.mjs <ROOM> [--base URL] [--tail N] [--json]')
   process.exit(1)
}

if (opts.help || !room) {
   console.log(`Read a room's event log from the relay and say what happened to it.

usage: node tools/room-log.mjs <ROOM> [--base URL] [--tail N] [--json]

  --base URL   relay to read (default ${opts.base}, or $BASE)
  --tail N     print only the last N events of the timeline
  --json       structured output, for attaching to a bug report

Read-only: no memberId is sent, so the relay records no presence for it.`)
   process.exit(opts.help ? 0 : 1)
}

opts.base = opts.base.replace(/\/+$/, '')
room = String(room).toUpperCase().trim()

/* -------------------------------------------------------------------- wire -- */

async function getJson (url) {
   let res
   try {
      res = await fetch(url)
   } catch (err) {
      throw new Error(`could not reach ${url} - is the relay running? (${err.message})`)
   }

   const text = await res.text()
   let body
   try {
      body = text ? JSON.parse(text) : {}
   } catch {
      throw new Error(`${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 120)}`)
   }

   return { res, body }
}

/*
 * Read the whole log, oldest first.
 *
 * The room keeps its most recent 400 events, so two pages cover it; the loop
 * exists so a room that grows past a page still comes back whole, and so the
 * "history was trimmed" case is detectable rather than silent.
 */
async function readRoom (base, roomId) {
   const events = []
   const seen = new Set()
   let cursor = 0
   let gone = false
   let players = []
   let now = null
   let requests = 0

   for (let page = 0; page < 20; page++) {
      const url = `${base}/api/relay/poll?roomId=${encodeURIComponent(roomId)}&since=${cursor}&wait=0`
      const { res, body } = await getJson(url)
      requests++

      if (!res.ok) throw new Error(`poll failed (HTTP ${res.status}): ${body.error || 'no message'}`)
      if (body.gone) { gone = true; break }

      if (Array.isArray(body.players) && body.players.length) players = body.players
      if (typeof body.now === 'number') now = body.now

      const batch = (Array.isArray(body.events) ? body.events : [])
         .filter((event) => event && !seen.has(event.seq))

      if (!batch.length) break

      for (const event of batch) {
         seen.add(event.seq)
         events.push(event)
      }

      const highest = batch.reduce((max, event) => Math.max(max, Number(event.seq) || 0), cursor)
      if (highest <= cursor) break
      cursor = highest

      /* a short page is the last page - nothing was trimmed off the end */
      if (batch.length < POLL_PAGE) break
   }

   events.sort((a, b) => a.seq - b.seq)
   return { events, gone, players, now, requests }
}

async function health (base) {
   try {
      const { res, body } = await getJson(`${base}/api/relay/health`)
      return res.ok ? body : { ok: false, error: body.error || `HTTP ${res.status}` }
   } catch (err) {
      return { ok: false, error: err.message }
   }
}

/* ---------------------------------------------------------------- reading -- */

/* every card a board state accounts for, by zone, so "blank" is a number */
const PILES = ['deck', 'hand', 'prizes', 'discard', 'lz', 'table', 'pickup']

const slotSize = (slot) => slot
   ? (slot.pokemon || []).length + (slot.energy || []).length + (slot.trainer || []).length
   : 0

function tally (board) {
   const zones = {}
   for (const pile of PILES) zones[pile] = (board?.[pile] || []).length

   zones.active = slotSize(board?.active)
   zones.bench = (board?.bench || []).reduce((sum, slot) => sum + slotSize(slot), 0)
   zones.stadium = board?.stadium ? 1 : 0
   zones.total = Object.values(zones).reduce((sum, n) => sum + n, 0)
   return zones
}

/* the zones worth naming in a one-line summary, empties left out */
function zonesLine (zones) {
   const parts = PILES
      .filter((pile) => zones[pile])
      .map((pile) => `${pile} ${zones[pile]}`)

   if (zones.active) parts.push(`active ${zones.active}`)
   if (zones.bench) parts.push(`bench ${zones.bench}`)
   if (zones.stadium) parts.push('stadium 1')

   return parts.length ? parts.join(', ') : 'nothing'
}

/* member ids are uuids; the first 8 characters are enough to tell two apart */
const shortId = (id) => (id ? String(id).slice(0, 8) : null)

function nameBook (events, players) {
   const names = new Map()
   for (const player of players || []) {
      if (player?.id) names.set(player.id, player.name || 'unnamed')
   }
   /* chat carries the sender's own display name, so it names non-players too */
   for (const event of events) {
      if (event.name === 'chatMessage' && event.from && event.data?.name && !names.has(event.from)) {
         names.set(event.from, event.data.name)
      }
   }
   return names
}

function whoLabel (from, players, names) {
   if (!from) return 'relay'
   const name = names.get(from)
   const seat = (players || []).findIndex((player) => player?.id === from)
   const role = seat === 0 ? 'host' : seat === 1 ? 'guest' : 'member'
   return `${name || shortId(from)} (${role})`
}

/* one readable line per event: the shape of the log is the point */
function describe (event) {
   const data = event.data || {}

   switch (event.name) {
      case 'chatMessage': {
         const kind = data.type === 'log' ? 'log' : 'chat'
         return `[${kind}] ${data.name ? data.name + ': ' : ''}${String(data.message ?? '').slice(0, 80)}`
      }
      case 'spectatorChanged':
         return `spectators now ${data.spectators}`
      case 'idlePrompt':
         return `IDLE PROMPT raised (prompt window ${Math.round((Number(data.promptMs) || 0) / 1000)}s)`
      case 'idleDismissed':
         return 'idle prompt answered - still playing'
      case 'roomClosed':
         return `ROOM CLOSED: ${data.reason || 'unknown reason'}`
      case 'boardState': {
         const zones = tally(data.board)
         const cards = (data.cards || []).length
         return zones.total === 0
            ? `FULL BOARD STATE - empty board (${cards} card list)`
            : `full board state - ${zones.total} cards (${zonesLine(zones)}) [list ${cards}]`
      }
      case 'boardReset':
         return 'BOARD RESET'
      case 'deckLoaded':
         return `deck imported - ${(data.deck || []).length} entries`
      case 'cardsMoved':
         return `${(data.cards || []).length} card(s): ${data.from} -> ${data.to}`
      case 'slotsMoved':
         return `${(data.slots || []).length} slot(s) -> ${data.to}`
      case 'cardsBenched':
         return `${(data.cards || []).length} card(s) -> bench, from ${data.from}`
      case 'activeBenched':
         return 'active -> bench'
      case 'cardPromoted':
         return `card ${shortId(data.cardId)} -> active (from ${data.from})`
      case 'slotPromoted':
         return `slot ${shortId(data.slotId)} -> active`
      case 'cardsEvolved':
         return `${(data.cards || []).length} card(s) evolved onto ${shortId(data.slotId)}`
      case 'cardsAttached':
         return `${(data.cards || []).length} card(s) attached to ${shortId(data.slotId)}`
      case 'damageUpdated':
         return `damage ${data.damage} on ${shortId(data.slotId)}`
      case 'oppDamageUpdated':
         return `opponent set damage ${data.damage} on ${shortId(data.slotId)}`
      case 'statusUpdated':
         return `status on ${shortId(data.slotId)}`
      case 'slotDiscarded':
         return `slot ${shortId(data.slotId)} discarded`
      case 'stadiumPlayed':
         return `stadium ${shortId(data.cardId)} played from ${data.from}`
      case 'pokemonToggle':
         return `pokemon ${data.hidden ? 'hidden' : 'shown'}`
      case 'powerMarker':
         return `marker ${data.marker}`
      case 'powerMarkerUsed':
         return `marker used: ${data.used}`
      case 'turnChanged':
         return `turn ${data.turn}`
      case 'timerUpdated':
         return `clock ${data.running ? 'running' : 'paused'} at ${Math.round((Number(data.remaining) || 0) / 1000)}s (set ${data.at})`
      case 'abilityUpdated':
         return `ability ${data.used ? 'used' : 'cleared'} on ${shortId(data.slotId)}`
      case 'prizeToggle':
         return `prizes ${data.flipped ? 'flipped' : 'face down'}`
      case 'handToggle':
         return `hand ${data.revealed ? 'revealed' : 'hidden'}`
      default:
         return JSON.stringify(data).slice(0, 80)
   }
}

/*
 * The verdict. Each finding is something worth knowing before touching the
 * client: whether the room is gone, whether the last full board state is empty,
 * whether a reset came after it, and whether a watcher arrived after it.
 */
function analyse ({ events, gone, players }) {
   const findings = []

   if (gone) {
      findings.push({ level: 'bad', text: 'the room does not exist any more - expired (6h idle), deleted, or never created' })
      return findings
   }

   if (!events.length) {
      findings.push({ level: 'warn', text: 'the room exists but has no events yet - nobody has done anything in it' })
      return findings
   }

   const first = events[0]
   const last = events[events.length - 1]

   if (first.seq > 1) {
      findings.push({
         level: 'info',
         text: `history is truncated: the first event present is #${first.seq} (a room keeps its most recent 400 events)`
      })
   }

   /* gaps in the sequence mean events were dropped somewhere, which is a store bug, not a client one */
   const gaps = []
   for (let i = 1; i < events.length; i++) {
      if (events[i].seq !== events[i - 1].seq + 1) gaps.push(`${events[i - 1].seq}->${events[i].seq}`)
   }
   if (gaps.length) {
      findings.push({ level: 'bad', text: `sequence gaps: ${gaps.slice(0, 8).join(', ')}${gaps.length > 8 ? ` (+${gaps.length - 8} more)` : ''}` })
   }

   const boards = events.filter((event) => event.name === 'boardState')
   const resets = events.filter((event) => event.name === 'boardReset')
   const lastBoard = boards[boards.length - 1] || null
   const lastReset = resets[resets.length - 1] || null

   if (lastBoard) {
      const zones = tally(lastBoard.data?.board)
      const cards = (lastBoard.data?.cards || []).length
      findings.push({
         level: zones.total === 0 ? 'bad' : 'good',
         text: zones.total === 0
            ? `the last full board state (#${lastBoard.seq}) is EMPTY - deck ${zones.deck}, hand ${zones.hand}, prizes ${zones.prizes}, active ${zones.active}, bench ${zones.bench}`
            : `the last full board state (#${lastBoard.seq}) holds ${zones.total} cards (${zonesLine(zones)})`
      })

      if (cards === 0 && zones.total === 0) {
         findings.push({ level: 'warn', text: 'that state carries no card list either, so its owner had not imported a deck when they published it' })
      }
   } else {
      findings.push({ level: 'warn', text: 'no boardState event at all - a watcher or a reconnecting opponent would have nothing to render' })
   }

   if (lastReset && (!lastBoard || lastReset.seq > lastBoard.seq)) {
      findings.push({
         level: 'bad',
         text: `a boardReset (#${lastReset.seq}) came after the last full state${lastBoard ? ` (#${lastBoard.seq})` : ''}, so the room's own log says the board is blank until somebody publishes again`
      })
   }

   /* the spectator signature: a watcher arrived after the last state was published */
   const watcher = [...events].reverse().find((event) => event.name === 'spectatorChanged' && Number(event.data?.spectators) > 0)
   if (watcher && lastBoard && watcher.seq > lastBoard.seq) {
      findings.push({
         level: 'bad',
         text: `spectators were present from #${watcher.seq} but the last full board state is older (#${lastBoard.seq}) - a watcher replaying the log would end up with an empty board unless a player republished`
      })
   } else if (watcher) {
      findings.push({ level: 'good', text: `the last full board state (#${lastBoard.seq}) is newer than the last spectator change (#${watcher.seq}) - a watcher replaying the log ends up with the real board` })
   }

   /* bursts: two clients answering each other is a real shape, and visible here */
   const counts = new Map()
   for (const event of events) counts.set(event.name, (counts.get(event.name) || 0) + 1)

   for (const [name, count] of counts) {
      if (count >= 20) {
         findings.push({ level: 'warn', text: `burst: ${name} x${count} in this room - check for two clients echoing each other` })
      }
   }

   const span = last.ts - first.ts
   findings.push({
      level: 'info',
      text: `${events.length} events over ${formatSpan(span)} (first #${first.seq} at ${iso(first.ts)}, last #${last.seq} at ${iso(last.ts)})`
   })

   if (last.name === 'boardReset') {
      findings.push({ level: 'warn', text: 'the very last thing that happened in this room was a board reset' })
   }

   /*
      The idle story, which is otherwise easy to misread: a prompt with no answer
      after it means the relay closed the room, and a prompt followed by a
      dismissal means somebody was there.
   */
   const prompts = events.filter((event) => event.name === 'idlePrompt')
   const dismissals = events.filter((event) => event.name === 'idleDismissed')
   const lastPrompt = prompts[prompts.length - 1] || null

   if (lastPrompt) {
      const answered = dismissals.some((event) => event.seq > lastPrompt.seq)
      findings.push({
         level: answered ? 'good' : 'warn',
         text: answered
            ? `the last idle prompt (#${lastPrompt.seq}) was answered - somebody was still playing`
            : `the last idle prompt (#${lastPrompt.seq}) was never answered, so the relay closed the room when its window ran out`
      })
   }

   return findings
}

function formatSpan (ms) {
   if (!Number.isFinite(ms) || ms < 0) return 'an unknown time'
   const seconds = Math.round(ms / 1000)
   if (seconds < 90) return `${seconds}s`
   const minutes = Math.round(seconds / 60)
   if (minutes < 90) return `${minutes}m`
   return `${(minutes / 60).toFixed(1)}h`
}

const iso = (ts) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : 'unknown')
const clock = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : '--:--:--')

/* ------------------------------------------------------------------ output -- */

const pad = (value, width) => String(value ?? '').padEnd(width)

function printHuman (model) {
   const { roomId, base, health, events, gone, players, now, requests } = model
   const names = nameBook(events, players)
   const findings = analyse(model)

   console.log(`room ${roomId}   via ${base}`)
   console.log(`relay store: ${health?.store || 'unknown'}${health?.from ? ` (from ${health.from})` : ''}` +
      `${health?.poll ? `   poll: hold ${health.poll.waitMs}ms, check every ${health.poll.intervalMs}ms` : ''}`)
   console.log(`read: ${events.length} event(s) in ${requests} request(s)` +
      `${gone ? '   ROOM NOT FOUND' : ''}`)

   if (players?.length) {
      console.log('\nseats (join order)')
      players.forEach((player, index) => {
         console.log(`  ${index + 1}. ${pad(player.name || 'unnamed', 20)} ${player.id || ''}`)
      })
   } else if (!gone) {
      console.log('\nseats: none taken')
   }

   if (!events.length) {
      console.log('\ntimeline: empty')
   } else {
      const lastCount = events.filter((event) => event.name === 'spectatorChanged').pop()
      if (lastCount) console.log(`spectators at the end: ${lastCount.data?.spectators ?? 0}`)

      const shown = opts.tail > 0 ? events.slice(-opts.tail) : events
      console.log(`\ntimeline${shown.length < events.length ? ` (last ${shown.length} of ${events.length})` : ''}`)
      console.log(`  ${pad('#', 5)}${pad('+', 9)}${pad('time', 11)}${pad('who', 22)}${pad('event', 19)}detail`)

      const origin = events[0].ts
      for (const event of shown) {
         const delta = `+${((event.ts - origin) / 1000).toFixed(1)}s`
         console.log(`  ${pad(event.seq, 5)}${pad(delta, 9)}${pad(clock(event.ts), 11)}` +
            `${pad(whoLabel(event.from, players, names), 22)}${pad(event.name, 19)}${describe(event)}`)
      }

      const counts = new Map()
      for (const event of events) counts.set(event.name, (counts.get(event.name) || 0) + 1)
      const byName = [...counts].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} x${n}`)
      console.log(`\nevents by name: ${byName.join(', ')}`)

      const senders = new Map()
      for (const event of events) {
         const key = whoLabel(event.from, players, names)
         senders.set(key, (senders.get(key) || 0) + 1)
      }
      console.log(`events by sender: ${[...senders].map(([who, n]) => `${who} x${n}`).join(', ')}`)
      if (now) console.log(`last activity: ${formatSpan(now - events[events.length - 1].ts)} ago`)
   }

   console.log('\nwhat this log says')
   const marks = { bad: 'x', warn: '!', good: 'ok', info: '-' }
   for (const finding of findings) {
      console.log(`  [${marks[finding.level] || '-'}] ${finding.text}`)
   }

   const bad = findings.filter((finding) => finding.level === 'bad')
   const warn = findings.filter((finding) => finding.level === 'warn')
   const verdict = gone
      ? 'the room is gone'
      : !events.length
         ? 'nothing has happened in this room'
         : bad.length
            ? `${bad.length} problem(s) visible in the log - the state is wrong, not the client`
            : warn.length
               ? `nothing broken, but ${warn.length} thing(s) worth a look`
               : 'no problem visible in the log - if the board is wrong, suspect the client'

   console.log(`\nverdict: ${verdict}`)
}

function printJson (model) {
   const names = nameBook(model.events, model.players)

   console.log(JSON.stringify({
      room: model.roomId,
      base: model.base,
      readAt: new Date().toISOString(),
      relay: model.health || null,
      gone: model.gone,
      requests: model.requests,
      seats: (model.players || []).map((player, index) => ({ seat: index + 1, id: player.id, name: player.name || null })),
      eventCount: model.events.length,
      firstSeq: model.events[0]?.seq ?? null,
      lastSeq: model.events[model.events.length - 1]?.seq ?? null,
      spectators: [...model.events].reverse().find((event) => event.name === 'spectatorChanged')?.data?.spectators ?? 0,
      findings: analyse(model),
      names: Object.fromEntries(names),
      events: model.events
   }, null, 2))
}

/* -------------------------------------------------------------------- main -- */

let model
try {
   const healthBody = await health(opts.base)
   const read = await readRoom(opts.base, room)
   model = { roomId: room, base: opts.base, health: healthBody, ...read }
} catch (err) {
   fail(err.message)
}

if (opts.json) printJson(model)
else printHuman(model)
