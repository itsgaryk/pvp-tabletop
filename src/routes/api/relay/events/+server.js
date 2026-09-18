import { json } from '@sveltejs/kit'
import { appendEvent, getRoom, touchMember } from '$lib/relay/store.js'
import { dismissIdlePrompt } from '$lib/relay/maintain.js'

/*
   Append one game event to a room.

   The event is stamped with a room-wide sequence number and timestamp, then
   handed back so the sender can apply it locally. The sender does not need to
   poll for its own event: the response body is the same envelope the poll
   endpoint returns, so /api/relay/poll is the single delivery path for both
   players.

   Event names are allow-listed. The client only ever emits these, and an open
   endpoint that relays arbitrary names is an easy way to fill the store.
*/

const EVENTS = new Set([
   /* room lifecycle */
   'chatMessage',
   'spectatorChanged',
   'roomClosed',
   /* the idle prompt; both are relayed like any other event so a poll delivers
      them and a late joiner replays into the prompt that is still outstanding */
   'idlePrompt',
   'idleDismissed',
   /* board / game actions */
   'boardState',
   'boardReset',
   'deckLoaded',
   'cardsMoved',
   'slotsMoved',
   'cardsBenched',
   'activeBenched',
   'cardPromoted',
   'slotPromoted',
   'cardsEvolved',
   'cardsAttached',
   'damageUpdated',
   'statusUpdated',
   'slotDiscarded',
   'stadiumPlayed',
   'pokemonToggle',
   'powerMarker',
   'powerMarkerUsed',
   'turnChanged',
   'timerUpdated',
   'abilityUpdated',
   'prizeToggle',
   'handToggle',
   'oppDamageUpdated'
])

/*
   A ceiling on how fast one member may write to a room.

   This is a backstop, not the mechanism. Clients pace their own sending and queue
   the overflow, so ordinary play never reaches it; it is here for what a client
   cannot cover - an old bundle still open in somebody's browser, a script, a
   future bug - because every event costs the store ten commands, and a client
   ignoring that spends a month of quota in minutes.

   The count is free. The room's recent events were read a moment ago to check
   membership, and each carries its sender and timestamp, so asking "how many has
   this member written in the last second?" adds no command at all. Adding a
   counter in Redis to enforce a limit on Redis commands would be self-defeating.

   Being derived from a read rather than an atomic counter, it is approximate
   under concurrency - two simultaneous writes can both pass the check. That is
   acceptable for a cost guard and would not be for a security control.

   Eight a second, against a client pace of six, so the client should never trip
   it; a player who somehow does is queued by their own client rather than losing
   the action.
*/
const MAX_EVENTS_PER_SECOND = 8
const RATE_WINDOW_MS = 1000

/* how many of this member's events landed inside the window */
function recentFrom (room, memberId, now) {
   const cutoff = now - RATE_WINDOW_MS
   let count = 0

   /* events are oldest first, so the recent ones are at the end */
   for (let i = room.events.length - 1; i >= 0; i--) {
      const past = room.events[i]
      if (!past || past.ts < cutoff) break
      if (past.from === memberId) count++
      if (count >= MAX_EVENTS_PER_SECOND) break
   }

   return count
}

/** @type {import('./$types').RequestHandler} */
export async function POST ({ request }) {
   let body
   try {
      body = await request.json()
   } catch {
      return json({ error: 'expected a JSON body' }, { status: 400 })
   }

   const roomId = String(body?.roomId || '').toUpperCase().trim()
   const memberId = body?.memberId
   const name = body?.event
   const data = body?.data ?? {}

   if (!roomId || !memberId) {
      return json({ error: 'roomId and memberId are required' }, { status: 400 })
   }
   if (typeof name !== 'string' || !EVENTS.has(name)) {
      return json({ error: `event "${name}" is not relayed by this server` }, { status: 400 })
   }

   try {
      const room = await getRoom(roomId)
      if (!room) return json({ error: `room ${roomId} not found` }, { status: 404 })

      const member = room.members.find((m) => m.id === memberId)
      if (!member) {
         return json({ error: 'you are not a member of this room' }, { status: 403 })
      }

      /*
         A spectator may talk but must never change the game. The client refuses
         too, but that is only a convenience - the relay is the authority.
      */
      if (name !== 'chatMessage' && member.role === 'spectator') {
         return json({ error: 'spectators cannot change the game' }, { status: 403 })
      }

      /*
         Too many at once. Refused rather than queued here, because a serverless
         function cannot hold a queue: it lives for one request, and two requests
         may run on different instances, so a queue on this side would either be
         lost or have to be stored in Redis - spending commands to save them. The
         sender's own queue is what holds the action and retries it.
      */
      if (recentFrom(room, memberId, Date.now()) >= MAX_EVENTS_PER_SECOND) {
         return json(
            {
               error: `too many actions at once: at most ${MAX_EVENTS_PER_SECOND} events a second are relayed`,
               rateLimited: true,
               retryAfterMs: 250
            },
            { status: 429 }
         )
      }

      /*
         "Still playing" is the one event the relay answers itself as well as
         logging: the outstanding prompt is marked in the room's metadata, so it
         has to be cleared, and the marker is what decides when the room closes.
         The event is published the same way either way, so the other player's
         prompt goes away too.
      */
      if (name === 'idleDismissed') {
         const dismissed = await dismissIdlePrompt(roomId)
         if (!dismissed) return json({ error: `room ${roomId} no longer exists` }, { status: 404 })
         await touchMember(roomId, memberId)
         return json({ seq: dismissed.seq, event: dismissed })
      }

      /*
         chat is the one event the server reshapes: it stamps the time so both
         players agree on ordering, keeps the log/chat distinction, and names the
         sender, who is the only one who knows their own display name.
      */
      const payload =
         name === 'chatMessage'
            ? { message: String(data.message ?? '').slice(0, 2000), type: data.type, name: member.name || null }
            : data

      /*
         `from` lets the poll tell the sender's own echo apart from the
         opponent's events. Without it a player sees their own message twice -
         once when they publish it locally, once relayed back to them.
      */
      const event = await appendEvent(roomId, name, payload, { from: memberId, meta: room })
      if (!event) return json({ error: `room ${roomId} no longer exists` }, { status: 404 })

      /*
         chat carries the relay's timestamp inside its payload: the client
         renders `data.time`, and both players must agree on it, so only the
         server can set it.
      */
      if (name === 'chatMessage') event.data.time = event.ts

      await touchMember(roomId, memberId)

      return json({ seq: event.seq, event })
   } catch (err) {
      console.error('[relay] event request failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}
