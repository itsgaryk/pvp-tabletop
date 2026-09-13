import { json } from '@sveltejs/kit'
import {
   getStore,
   newMemberId,
   newRoomId,
   readRoom,
   writeRoom
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
      const store = getStore()
      const action = body?.action

      if (action === 'create') {
         const room = {
            id: newRoomId(),
            createdAt: Date.now(),
            seq: 0,
            events: [],
            members: {}
         }

         const memberId = newMemberId()
         room.members[memberId] = { role: 'host', lastSeen: Date.now() }
         await writeRoom(room, store)

         return json({ roomId: room.id, memberId, role: 'host', seq: room.seq, events: [] })
      }

      if (action === 'join') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         if (!roomId) return json({ error: 'roomId is required' }, { status: 400 })

         const room = await readRoom(roomId, store)
         if (!room) return json({ error: `room ${roomId} not found` }, { status: 404 })

         /* Re-attach a member we already know (page reload, reconnect). */
         let memberId = body?.memberId && room.members[body.memberId] ? body.memberId : null
         let role = memberId ? room.members[memberId].role : null

         if (!memberId) {
            if (Object.keys(room.members).length >= MAX_MEMBERS) {
               return json({ error: `room ${roomId} is already full` }, { status: 409 })
            }
            memberId = newMemberId()
            role = 'guest'
         }

         room.members[memberId] = { role, lastSeen: Date.now() }
         await writeRoom(room, store)

         return json({
            roomId: room.id,
            memberId,
            role,
            seq: room.seq,
            events: room.events
         })
      }

      if (action === 'leave') {
         const roomId = String(body?.roomId || '').toUpperCase().trim()
         const memberId = body?.memberId
         if (roomId && memberId) {
            const room = await readRoom(roomId, store)
            if (room && room.members[memberId]) {
               delete room.members[memberId]
               if (Object.keys(room.members).length === 0) await store.del(roomId)
               else await writeRoom(room, store)
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
