import { json } from '@sveltejs/kit'
import { closedReason, getRoom, getRoomSeq, getStore, touchMember } from '$lib/relay/store.js'
import { maintainRoom, pruneStaleMembers } from '$lib/relay/maintain.js'
import { WAIT_MS, POLL_INTERVAL_MS, MAX_REQUESTED_INTERVAL_MS } from '$lib/relay/config.js'

/*
   Long-poll for events after `since`.

   The request is held open for up to `WAIT_MS` so an action by one player
   reaches the other as soon as it is written, without a websocket. The client
   aborts the outstanding poll whenever it emits, so in practice a move lands in
   milliseconds and the hold only runs out while the board is idle.

   Holding the request open is what costs function time on Vercel (wall clock is
   billed, not just CPU), so the window is deliberately modest. While it waits,
   the loop reads one cheap key - the room's event cursor - per turn and only
   reads the rest of the room when that cursor actually moves, which keeps the
   store's command count down to about one per turn while the board is idle.

   Every answer is built in one of two places (see `finish`) rather than at the
   four points that can end a request. That is deliberate: the room has to be
   maintained on the way out - a game with no players left is over, an idle room
   is prompted - and one exit path is how that stays true for all of them.
*/

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

/*
   Which members hold the two playing seats, in join order, with their names. A
   spectator needs this to know whose board goes on which half of its screen, and
   both players label the halves with it - so it is sent on every poll, because
   the seats are not fixed when the watcher arrives: the second player may only
   sit down later.
*/
const seats = (room) => room.members
   .filter((m) => m.role === 'host' || m.role === 'guest')
   .map((m) => ({ id: m.id, name: m.name || null }))
   .slice(0, 2)

const opponentState = (room, memberId) => {
   const now = Date.now()
   const others = room.members.filter((m) => m.id !== memberId)
   const fresh = others.filter((m) => now - (m.lastSeen || 0) < PRESENCE_MS)
   const me = room.members.find((m) => m.id === memberId)

   return {
      /* a spectator has no opponent; it watches both seats */
      present: me && me.role !== 'spectator'
         ? fresh.some((m) => m.role !== 'spectator')
         : false,
      count: fresh.filter((m) => m.role !== 'spectator').length,
      /* watchers are counted from membership, not presence, so somebody who
         just joined shows up immediately - stale presence is swept instead
         (see maintain.js), which is what keeps a killed tab out of the count */
      spectators: room.members.filter((m) => m.role === 'spectator').length,
      role: me ? me.role : null
   }
}

/* the last event number in a room that is known to have events */
const lastSeq = (room) => room.events.length ? room.events[room.events.length - 1].seq : null

/** @type {import('./$types').RequestHandler} */
export async function GET ({ url }) {
   const roomId = String(url.searchParams.get('roomId') || '').toUpperCase().trim()
   const memberId = url.searchParams.get('memberId')
   const since = Number(url.searchParams.get('since') || 0)
   const wait = clamp(Number(url.searchParams.get('wait') || WAIT_MS), 0, WAIT_MS)

   /*
      A client may ask to be checked on *less* often than the default - a board in
      a hidden tab does exactly that - but never more often, so the cost of one
      client cannot be raised by the client itself.
   */
   const interval = clamp(Number(url.searchParams.get('interval') || POLL_INTERVAL_MS), POLL_INTERVAL_MS, MAX_REQUESTED_INTERVAL_MS)

   if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

   const store = getStore()
   const started = Date.now()

   /*
      Why the room is not there. Read only when it is already missing, so no path
      that finds a room spends anything on it: 'closed' means a game ended (a
      player left, or the room sat idle through its prompt) and is worth saying
      on screen; anything else is the 6h TTL, which is not news.
   */
   const goneReason = async () => {
      try {
         const reason = await closedReason(roomId)
         return reason === 'closed' || reason === 'idle' ? reason : 'expired'
      } catch {
         return 'expired'
      }
   }

   /*
      The room is not a game any more. Say goodbye rather than answering with
      nothing, because the client's next poll would only ask again.
   */
   const goneReply = async () => json({ gone: true, reason: await goneReason(), events: [], seq: since })

   /*
      One exit for every way this request can end, so the room is maintained and
      the members are described identically wherever it came from.
   */
   async function finish (room, { events = [], waited = null } = {}) {
      const now = Date.now()
      const { members } = await pruneStaleMembers(store, roomId, room.members, now)
      room.members = members

      const verdict = await maintainRoom(store, roomId, room, now)
      if (verdict.gone) return goneReply()

      const seq = lastSeq(room)
      const answer = {
         events,
         seq: seq === null ? since : seq,
         opponent: opponentState(room, memberId),
         players: seats(room),
         /* the relay's clock, so a client can work out how stale a replayed
            event is (the game timer counts down from one) */
         now,
         /* an outstanding idle prompt, with the relay clock it was raised at:
            the client counts down from `deadlineAt` against this same clock, so
            a board that arrives late sees the time actually left on it. Carried
            in the reply as well as in the prompt event, because a long prompt
            can outlive the room's retained event log. */
         idle: verdict.idle,
         waited: waited === null ? now - started : waited
      }

      if (events.length) await touchMember(roomId, memberId)
      return json(answer)
   }

   try {
      /*
         A room with no events at all has no cursor to read, so telling "quiet"
         from "gone" needs the room itself - but only now and then, not on every
         turn of the loop.
      */
      let checkedRoomAt = 0

      /* Refresh our own presence up front: a long poll means "still here". */
      await touchMember(roomId, memberId)

      for (;;) {
         /*
            One cheap read decides whether anything happened: the room's event
            cursor. While it holds still there is nothing else to read at all.
         */
         const seq = await getRoomSeq(roomId)

         if (seq === null && Date.now() - checkedRoomAt > 2000) {
            checkedRoomAt = Date.now()
            const room = await getRoom(roomId)
            if (!room) return goneReply()
            return finish(room)
         }

         if (seq !== null && seq > since) {
            const room = await getRoom(roomId)
            if (!room) return goneReply()

            const events = room.events.filter((e) => e.seq > since).slice(0, MAX_EVENTS)
            if (events.length) return finish(room, { events })
         }

         if (Date.now() - started >= wait) {
            const room = await getRoom(roomId)
            if (!room) return goneReply()
            return finish(room)
         }

         await sleep(interval)
      }
   } catch (err) {
      console.error('[relay] poll failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}
