import { json } from '@sveltejs/kit'
import {
   appendEvent,
   clearRejoinDeadline,
   closeRoom,
   createRoom,
   getRoom,
   getStore,
   isPlayer,
   joinRoom,
   removeMember,
   roomSummary
} from '$lib/relay/store.js'
import { startRejoinWait } from '$lib/relay/maintain.js'
import { RELAY_HOST_WAIT_MS, RELAY_REJOIN_WAIT_MS } from '$lib/relay/timing.js'

/*
   Room lifecycle.

   action 'create'   -> makes a new room, caller takes the first playing seat
   action 'join'     -> join as a player, or as a spectator when `role` is
                        'spectator' (or when both seats are taken)
   action 'leave'    -> removes the caller from the room; a player giving up a
                        seat ends the game for everybody still in it, and the
                        last player to leave closes the room outright

   The lobby is limited to two players; once both seats are filled it is locked
   and any further arrival can only spectate.

   A game is the people playing it, so one player leaving ends it for the other
   player and for any watchers - the room is closed and they are told why. A
   spectator leaving is only a count change and never closes anything, which is
   the distinction that matters: watching a game must not be able to keep a dead
   one open.
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
            /*
               When this room stops waiting for a second player. Sent so the
               creator can watch the clock they are on rather than being
               returned to the lobby with no warning at all.
            */
            hostWait: { deadlineAt: Number(room?.hostDeadlineAt || 0), waitMs: RELAY_HOST_WAIT_MS },
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

         /*
            Back in the seat that was being held. The wait for them is over, so
            the room says so before it is described back to them - a client that
            reconnected must not still be shown a countdown it has beaten.
         */
         if (role !== 'spectator' && Number(room.rejoinDeadlineAt || 0)) {
            await clearRejoinDeadline(roomId)
            room.rejoinDeadlineAt = 0
         }

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
         if (!roomId || !memberId) return json({ ok: true })

         const room = await getRoom(roomId)
         const leaving = room ? room.members.find((m) => m.id === memberId) : null

         /*
            A player pulling the tab closed sends the same leave as the button,
            because there is no other request a browser promises to finish while
            a page unloads - and the two mean opposite things. So the beacon
            says which it is (`agentOffline`), and that answer decides whether
            this is a game ending or a seat being held.

            Somebody still sitting in the other playing seat is what makes the
            wait worth setting: a beacon from the last player in the room leaves
            nobody to wait, and that room closes as any empty one does.

            A tab that was *killed* rather than closed sends nothing at all,
            which is what the stale-member sweep is for: that path sets the same
            wait from the poll that notices the absence.
         */
         const otherSeat = room
            ? room.members.some((m) => m.id !== memberId && (m.role === 'host' || m.role === 'guest'))
            : false
         const vanished = Boolean(
            body?.agentOffline && otherSeat && leaving && leaving.role !== 'spectator'
         )

         const { members, players } = await removeMember(roomId, memberId)

         /* the game waits for them, so the clock starts before anything is answered */
         if (vanished) await startRejoinWait(roomId)

         /* fresh state: the leaver is out, and the wait above has moved the metadata on */
         const remaining = vanished ? await getRoom(roomId) : room

         /*
            Every other member's poll is what tells them the room has gone, so
            this reply is only for the leaver: they are already out, and the
            client uses it to clear its own board rather than to show itself a
            dialog it does not need.
         */
         if (!room && !members.length) return json({ ok: true, closed: true, reason: 'closed' })

         /*
            The tab went away rather than the player walking out. The game is
            not over: their seat is held, the room carries on for whoever is
            still in it, and the wait started above is what ends it if they
            never come back.
         */
         if (vanished) {
            return json({
               ok: true,
               closed: false,
               waiting: true,
               players: players.length,
               spectators: (remaining?.members || members).filter((m) => m.role === 'spectator').length,
               rejoin: remaining?.rejoinDeadlineAt
                  ? { at: remaining.rejoinDeadlineAt - RELAY_REJOIN_WAIT_MS, deadlineAt: remaining.rejoinDeadlineAt }
                  : null
            })
         }

         /*
            Somebody gave up a playing seat while another player is still
            sitting in one. A game is the people playing it, so it ends here for
            everyone left: saying so is the whole point, because the player who
            stayed would otherwise sit on a board nothing can ever update.

            The note is written before the close so a poll already in flight -
            and the leaver's own next request - can still be told which ending
            this was.
         */
         const others = players.filter((m) => m.id !== memberId)

         if (leaving && leaving.role !== 'spectator' && others.length) {
            if (members.length) await appendEvent(roomId, 'roomClosed', { reason: 'playerLeft' })
            await closeRoom(roomId, 'playerLeft')
            return json({ ok: true, closed: true, reason: 'playerLeft', closedRoom: roomId })
         }

         if (!players.length) {
            /*
               The last playing seat has been given up. That is the end of the
               game whatever else is still watching: a room is a game, and a game
               with nobody sitting in it must not be kept open by spectators.
               Tell whoever is left first - the event is how the room's own log
               records why it ended, and a poll already in flight may still carry
               it - then close the room.

               The ending is named separately from a player walking out on
               another, because to a watcher they are different games: one had
               somebody leave it, the other simply ran out of players.
            */
            if (members.length) await appendEvent(roomId, 'roomClosed', { reason: 'allPlayersLeft' })
            await closeRoom(roomId, 'allPlayersLeft')
            return json({ ok: true, closed: true, reason: 'allPlayersLeft', closedRoom: roomId })
         }

         /* players remain, so a spectator leaving is just a count change */
         if (leaving && leaving.role === 'spectator') await announceSpectators(roomId)

         return json({ ok: true, closed: false, players: players.length, spectators: members.filter((m) => m.role === 'spectator').length })
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
