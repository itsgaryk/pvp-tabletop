/*
 * Times a poll against the running relay and counts the store commands it costs.
 *
 * Meant to be run next to tools/fake-redis.mjs, with the dev server pointed at
 * it, so the numbers are the relay's own commands rather than a real bill:
 *
 *   node tools/fake-redis.mjs
 *   KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev
 *   node tools/poll-cost.mjs
 *
 * Set RELAY_POLL_INTERVAL_MS on the dev server to compare settings.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3005'
const FAKE = process.env.FAKE || 'http://127.0.0.1:6390'
const WAIT = Number(process.env.WAIT_S || 10) * 1000

const stats = async () => (await fetch(`${FAKE}/__stats`)).json()

/* a room, one member, so the poll has a cursor to read */
const created = await (await fetch(`${BASE}/api/relay/room`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ action: 'create', name: 'Cost' })
})).json()
if (!created.roomId) {
   console.error('could not create a room:', JSON.stringify(created))
   process.exit(1)
}

/* one event, so the room has a seq key: the steady state during a game */
await fetch(`${BASE}/api/relay/events`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ roomId: created.roomId, memberId: created.memberId, event: 'boardReset', data: {} })
})

const before = await stats()
const started = Date.now()
const body = await (await fetch(`${BASE}/api/relay/poll?roomId=${created.roomId}&memberId=${created.memberId}&since=99&wait=${WAIT}`)).json()
const seconds = (Date.now() - started) / 1000
const after = await stats()

const by = {}
for (const k of Object.keys(after.byName)) by[k] = (after.byName[k] || 0) - (before.byName[k] || 0)
const commands = after.commands - before.commands

console.log(`room ${created.roomId}, one idle poll of ${seconds.toFixed(1)}s (server waited ${body.waited}ms)`)
console.log(`  commands: ${commands}   = ${(commands / seconds).toFixed(2)}/s per client`)
console.log(`  per hour: ${Math.round(commands / seconds * 3600).toLocaleString()}`)
console.log(`  by name:  ${JSON.stringify(by)}`)
console.log(`  KEYS:     ${by.KEYS || 0}`)
