import { json } from '@sveltejs/kit'
import {
   addMember,
   createRoom,
   getRoom,
   getStore,
   removeMember
} from '$lib/relay/store.js'

/*
   Room lifecycle.

   action 'create' -> makes a new room, caller becomes player 1
   action 'join'   -> adds the caller as player 2 (or re-attaches a known
                      member), and replays the room's event history so the
                      joiner immediately receives the opponent's board state
   action 'leave'  -> removes the caller from the room
*/

const MAX_MEMBERS = 2

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
         const { roomId, memberId, role } = await createRoom()
         return json({ roomId, memberId, role, seq: 0, events: [] })
      }

      if (action === 'join') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

         const room = await getRoom(roomId)
         if (!room) return json({ error: `room ${roomId} not found` }, { status: 404 })

         /* Re-attach a member we already know (page reload, reconnect). */
         const known = body?.memberId && room.members.some((m) => m.id === body.memberId)
         let memberId = known ? body.memberId : null
         let role = known ? room.members.find((m) => m.id === memberId).role : null

         if (!memberId) {
            if (room.members.length >= MAX_MEMBERS) {
               return json({ error: `room ${roomId} is already full` }, { status: 409 })
            }
            memberId = crypto.randomUUID()
            role = 'guest'
         }

         await addMember(roomId, memberId, role)

         return json({
            roomId,
            memberId,
            role,
            seq: room.events.length ? room.events[room.events.length - 1].seq : 0,
            events: room.events
         })
      }

      if (action === 'leave') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         if (roomId && body?.memberId) await removeMember(roomId, body.memberId)
         return json({ ok: true })
      }

      return json({ error: `unknown action "${action}"` }, { status: 400 })
   } catch (err) {
      console.error('[relay] room request failed', err)
      return json({ error: err.message }, { status: 500 })
   }
}
