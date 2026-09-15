import { json } from '@sveltejs/kit'
import {
   appendEvent,
   createRoom,
   getRoom,
   getStore,
   joinRoom,
   removeMember,
   roomSummary
} from '$lib/relay/store.js'

/*
   Room lifecycle.

   action 'create'   -> makes a new room, caller takes the first playing seat
   action 'join'     -> join as a player, or as a spectator when `role` is
                        'spectator' (or when both seats are taken)
   action 'leave'    -> removes the caller from the room

   The lobby is limited to two players; once both seats are filled it is locked
   and any further arrival can only spectate.
*/

/* keep everyone's spectator count in step while a room is open */
async function announceSpectators (roomId) {
   const summary = await roomSummary(roomId)
   if (summary) await appendEvent(roomId, 'spectatorChanged', { spectators: summary.spectators })
   return summary
}

/* the two playing seats, with the names their players gave, in join order */
const seats = (room) => (room?.members || [])
   .filter((m) => m.role === 'host' || m.role === 'guest')
   .map((m) => ({ id: m.id, name: m.name || null }))

/** @type {import('./$types').RequestHandler} */
export async function POST ({ request }) {
   let body
   try {
      body = await request.json()
   } catch {
      return json({ error: 'expected a JSON body' }, { status: 400 })
   }

   try {
      getStore() // fails loudly when no database is configured
      const action = body?.action

      if (action === 'create') {
         const { roomId, memberId, role } = await createRoom(body?.name)
         const room = await getRoom(roomId)
         return json({
            roomId,
            memberId,
            role,
            players: seats(room),
            seq: 0,
            events: [],
            summary: { players: 1, maxPlayers: 2, locked: false, spectators: 0 }
         })
      }

      if (action === 'join') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

         const result = await joinRoom(roomId, {
            memberId: body?.memberId || null,
            role: body?.role === 'spectator' ? 'spectator' : 'guest',
            name: body?.name ?? null
         })

         if (result.error) {
            return json(
               { error: result.error, locked: Boolean(result.locked) },
               { status: result.status || 400 }
            )
         }

         const { room, memberId, role } = result

         /* tell the room a watcher arrived so the count updates everywhere */
         let summary = null
         if (role === 'spectator') summary = await announceSpectators(roomId)

         /*
            Which members hold the playing seats, and what they are called. A
            spectator needs this to know whose board goes on which half of its
            screen; both players use it to label the halves.
         */
         const players = seats(room)

         return json({
            roomId,
            memberId,
            players,
            role,
            seq: room.events.length ? room.events[room.events.length - 1].seq : 0,
            events: room.events,
            /* the relay's clock, so a client can age the events it just replayed */
            now: Date.now(),
            summary: summary || await roomSummary(roomId)
         })
      }

      if (action === 'leave') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         const memberId = body?.memberId
         if (roomId && memberId) {
            const room = await getRoom(roomId)
            const leaving = room ? room.members.find((m) => m.id === memberId) : null
            await removeMember(roomId, memberId)
            if (leaving && leaving.role === 'spectator' && await getRoom(roomId)) {
               await announceSpectators(roomId)
            }
         }
         return json({ ok: true })
      }

      return json({ error: `unknown action "${action}"` }, { status: 400 })
   } catch (err) {
      console.error('[relay] room request failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}

/*
   Lobby status without joining anything - used by the UI to tell a prospective
   player that the seats are taken before they try.
*/
/** @type {import('./$types').RequestHandler} */
export async function GET ({ url }) {
   const roomId = String(url.searchParams.get('roomId') || '').toUpperCase().trim()
   if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

   try {
      const summary = await roomSummary(roomId)
      if (!summary) return json({ error: `room ${roomId} not found` }, { status: 404 })
      return json(summary)
   } catch (err) {
      console.error('[relay] room lookup failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}
