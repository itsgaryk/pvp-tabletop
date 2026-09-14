import { json } from '@sveltejs/kit'
import { appendEvent, getRoom, touchMember } from '$lib/relay/store.js'

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
   'prizeToggle',
   'handToggle',
   'oppDamageUpdated'
])

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
      const event = await appendEvent(roomId, name, payload, { from: memberId })
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
