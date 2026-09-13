import { json } from '@sveltejs/kit'
import { getRoom, touchMember } from '$lib/relay/store.js'

/*
   Long-poll for events after `since`.

   The request is held open for up to `WAIT_MS` so an action by one player
   reaches the other as soon as it is written, without a websocket. The client
   aborts the outstanding poll whenever it emits, so in practice a move lands in
   milliseconds and the hold only runs out while the board is idle.

   Holding the request open is what costs function time on Vercel (wall clock is
   billed, not just CPU), so the window is deliberately modest.
*/

const WAIT_MS = clamp(Number(process.env.RELAY_POLL_WAIT_MS) || 20000, 0, 50000)
const POLL_INTERVAL_MS = 400
const MAX_EVENTS = 200

/*
   A member counts as present while their poll keeps refreshing. A single poll
   can legitimately be in flight for WAIT_MS plus the client's timeout, plus
   request latency, so the window has to clear that or a healthy player would
   flicker offline.
*/
const PRESENCE_MS = WAIT_MS + 15000

function clamp (value, min, max) {
   return Math.min(Math.max(value, min), max)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const opponentState = (room, memberId) => {
   const now = Date.now()
   const others = room.members.filter((m) => m.id !== memberId)
   return {
      present: others.some((m) => now - (m.lastSeen || 0) < PRESENCE_MS),
      count: others.length
   }
}

/** @type {import('./$types').RequestHandler} */
export async function GET ({ url }) {
   const roomId = String(url.searchParams.get('roomId') || '').toUpperCase().trim()
   const memberId = url.searchParams.get('memberId')
   const since = Number(url.searchParams.get('since') || 0)
   const wait = clamp(Number(url.searchParams.get('wait') || WAIT_MS), 0, WAIT_MS)

   if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

   try {
      const started = Date.now()

      /* Refresh our own presence up front: a long poll means "still here". */
      await touchMember(roomId, memberId)

      for (;;) {
         const room = await getRoom(roomId)
         if (!room) return json({ gone: true, events: [], seq: since })

         const events = room.events.filter((e) => e.seq > since).slice(0, MAX_EVENTS)

         if (events.length) {
            /*
               Refresh again on the way out. Without this, a player who is
               actively receiving events would still look stale to the other
               side once their last poll exceeded the presence window.
            */
            await touchMember(roomId, memberId)
            return json({
               events,
               seq: room.events[room.events.length - 1].seq,
               opponent: opponentState(room, memberId),
               waited: Date.now() - started
            })
         }

         if (Date.now() - started >= wait) {
            return json({
               events: [],
               seq: room.events.length ? room.events[room.events.length - 1].seq : since,
               opponent: opponentState(room, memberId),
               waited: Date.now() - started
            })
         }

         await sleep(POLL_INTERVAL_MS)
      }
   } catch (err) {
      console.error('[relay] poll failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}
