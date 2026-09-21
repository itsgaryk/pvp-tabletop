/*
   Does a relay that never answers end in a sentence, or in a dead dialog?

   This exists because of a specific, expensive hang: `HttpSocket.request()` had no
   deadline, so a connection that answers nothing - a relay up but with its database
   unreachable, a black-holing proxy, a machine asleep - left the promise unsettled
   for ever. The prompt that asks for a name disables OK *and* Cancel and refuses
   Escape while its action is in flight (RoomIdPrompt.svelte), because the request is
   already going and there is nowhere to report it. An action that never settles
   therefore leaves the player looking at "Working…" with no button left to press.

   The long poll has had its own deadline since it was written; this is about the
   other calls. So the checks below are the two halves of that claim:

     1. a request that hangs is abandoned and rejects, with a message that belongs on
        a form - rather than leaving a promise that never settles
     2. a relay that *does* answer is unaffected, which is what stops a deadline from
        being a bug of its own
     3. the long poll keeps its own, longer window - it is not cut off by the shorter
        deadline for ordinary requests

   Read-only, no server, no network, no browser: it drives the real transport with a
   stand-in `fetch`. Nothing is started.

     node tools/relay-timeout-check.mjs
     node tools/relay-timeout-check.mjs --quiet
*/

import { readFileSync } from 'node:fs'

const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* the real transport, from the real source - no copy of it here */
const { HttpSocket } = await import(new URL('../src/lib/relay/client.js', import.meta.url).href)

/* a reply shaped like the relay's, for a request that should succeed */
const okResponse = (payload) => ({
   ok: true,
   status: 200,
   text: async () => JSON.stringify(payload)
})

/*
   1. A relay that never answers.

   The stand-in has to honour its signal, because that is what makes a deadline work
   at all: `fetch` rejects with an AbortError when the signal aborts. A promise that
   simply never settles and ignores the signal cannot be abandoned by anything - and
   a check written that way would fail against a transport that was working, which
   is what happened here first.
*/
{
   const socket = new HttpSocket({
      baseUrl: 'http://relay.invalid',
      /* accepts the request, says nothing, and gives up when the caller aborts */
      fetchImpl: (url, options) => new Promise((resolve, reject) => {
         const signal = options?.signal
         if (signal) {
            signal.addEventListener('abort', () => {
               const err = new Error('The operation was aborted.')
               err.name = 'AbortError'
               reject(err)
            })
         }
      }),
      requestTimeout: 120
   })

   const started = Date.now()
   let outcome = 'never settled'
   let message = ''

   const settled = socket.createRoom('Alice')
      .then(() => { outcome = 'resolved' })
      .catch((err) => { outcome = 'rejected'; message = err.message })

   /* the harness's own backstop, well past the socket's deadline */
   await Promise.race([ settled, new Promise((r) => setTimeout(r, 3000)) ])
   const took = Date.now() - started

   check('a request that never answers is abandoned rather than left pending',
      outcome === 'rejected', outcome === 'never settled' ? `still pending after ${took}ms` : outcome)
   check('and it rejects quickly, not when the harness gave up', took < 2000, `${took}ms`)
   check('and the message belongs on a form', /did not answer/.test(message), message)
   check('and it does not claim the request failed',
      !/failed|refused|rejected/i.test(message), message)
}

/*
   2. A relay that answers. The deadline must not be a bug of its own: nothing here
   should be cut short.
*/
{
   const socket = new HttpSocket({
      baseUrl: 'http://relay.invalid',
      fetchImpl: async () => okResponse({
         roomId: 'ABC123',
         memberId: 'm1',
         role: 'host',
         players: [{ id: 'm1', name: 'Alice' }],
         seq: 0,
         events: [],
         now: Date.now()
      }),
      requestTimeout: 120
   })

   let roomId = null
   let failed = ''
   try {
      const res = await socket.createRoom('Alice')
      roomId = res?.roomId ?? null
   } catch (err) {
      failed = err.message
   }

   check('a relay that answers is not cut short', !failed && roomId === 'ABC123',
      failed || `roomId = ${roomId}`)
   check('and the socket holds the room it was given', socket.roomId === 'ABC123', String(socket.roomId))
}

/*
   3. A slow request that is still inside its deadline must survive. A deadline that
   fires early is worse than none: it abandons work that was about to succeed.
*/
{
   const socket = new HttpSocket({
      baseUrl: 'http://relay.invalid',
      fetchImpl: async () => {
         await new Promise((r) => setTimeout(r, 60))
         return okResponse({ roomId: 'SLOW01', memberId: 'm2', role: 'host', players: [], seq: 0, events: [], now: Date.now() })
      },
      requestTimeout: 400
   })

   let roomId = null
   let failed = ''
   try {
      const res = await socket.createRoom('Bob')
      roomId = res?.roomId ?? null
   } catch (err) {
      failed = err.message
   }

   check('a slow-but-answering relay still lands', !failed && roomId === 'SLOW01', failed || `roomId = ${roomId}`)
}

/*
   4. The poll is not governed by the shorter deadline. It sets its own signal, so a
   long poll must not be aborted by the request timeout - breaking that would turn
   every game into a reconnecting one.
*/
{
   const source = readFileSync('src/lib/relay/client.js', 'utf8')
   const poll = /async poll \(\) \{[\s\S]*?\n   \}/.exec(source)
   check('the poll still sets its own deadline', Boolean(poll) && /POLL_TIMEOUT_MS/.test(poll[0]))
   check('and does not go through request(), which now has a shorter one',
      Boolean(poll) && !/this\.request\(/.test(poll[0]))
   check('and the request deadline is longer than the poll window it must not govern',
      /const REQUEST_TIMEOUT_MS = (\d+)/.test(source) &&
      Number(RegExp.$1) < Number((/const POLL_TIMEOUT_MS = (\d+)/.exec(source) || [])[1] || 0),
      `request ${(/const REQUEST_TIMEOUT_MS = (\d+)/.exec(source) || [])[1]}ms, poll ${(/const POLL_TIMEOUT_MS = (\d+)/.exec(source) || [])[1]}ms`)
}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - a relay that says nothing can still trap the player`)
   process.exit(1)
}
console.log('verdict: ok - a request that never answers ends in a sentence, and a slow one still lands')

/*
   Exit deliberately rather than returning: importing the transport starts no timers,
   but the aborted requests above leave a pending socket/timer handle behind, and a
   check whose work is finished should not then wait for the event loop to drain.
   Every tool here that imports a module with handles ends this way.
*/
process.exit(0)
