/*
   Room maintenance, run on the poll's exit path.

   The poll already re-reads the room before it answers - that read is how it
   knows which members hold the seats and whether anything arrived while the
   request was held open - so everything here is decided from state that has
   already been fetched. This module adds no store command of its own beyond the
   writes it actually decides to make.

   Three things belong here, and all three only matter to a room that is already
   being read:

   - a room with no playing seat left occupied is not a game any more, so it is
     closed. A spectator must never be able to hold a dead room open, which is
     exactly what closing on "no members left" got wrong.

   - members whose presence has gone stale are swept. Presence comes from the
     poll's own refresh, so a tab that was killed simply stops refreshing, and a
     spectator count is otherwise inflated by a browser that is no longer there.

   - idle: a room where nothing has been *done* for a while is prompted, and a
     prompt nobody answers closes it. Presence is deliberately not activity -
     two people sitting on a board are present and idle, which is the case the
     prompt exists for - so the clock runs from the last appended event
     (meta.lastActionAt), not from the last poll.

   Nothing here sweeps a room nobody is polling. That is a deliberate limit
   rather than an oversight: this runs when a client asks, so a room with no
   readers is never visited. A clean tab close removes its member and, when it
   was the last player, closes the room on the way; a crashed tab leaves a room
   that the 6h TTL collects. Adding a scheduler to catch that last case would
   cost more than it saves (Vercel's Hobby cron runs about daily, and every five
   minutes needs Pro), which is why the players' own polls are the timer.
*/

import {
   appendEvent,
   closeRoom,
   countSeats,
   getRoom,
   isPlayer,
   saveMeta,
   SEAT_HELD,
   setRejoinDeadline,
   setIdlePrompted,
   spectatorsOf
} from './store.js'
import {
   RELAY_IDLE_MS,
   RELAY_PROMPT_MS,
   RELAY_MEMBER_STALE_MS,
   RELAY_HOST_WAIT_MS,
   RELAY_REJOIN_WAIT_MS
} from './timing.js'

/*
   Sweep members whose presence has stopped being refreshed, and say what is
   left.

   A playing seat is *held* rather than removed: the member record stays, and
   only its presence mark goes. That is the whole point of the rejoin wait - the
   player who comes back with the same member id is recognized as the person who
   was sitting there, and gets their own seat and role back rather than being
   seated as somebody new (or refused, because the room still counted them).
   Their presence is what the room stops trusting, and `fresh` below is what
   says so.

   A spectator is removed outright. There is no seat to hold and nothing to come
   back to, and the watcher count in everybody else's header is exactly what a
   killed tab inflates.

   The writes only happen for a member that has actually gone: a live room costs
   one comparison per member and no commands.
*/
export async function pruneStaleMembers (store, roomId, members, now = Date.now()) {
   const cutoff = now - RELAY_MEMBER_STALE_MS
   /*
      A held seat is not stale - it is the mark left by an earlier sweep - so it
      is excluded here rather than swept over and over.
   */
   const stale = (members || []).filter(
      (m) => typeof m.lastSeen === 'number' && m.lastSeen !== SEAT_HELD && m.lastSeen < cutoff
   )
   if (!stale.length) return { members, fresh: members, pruned: [], seatsLost: 0, heldSeats: countSeats(members) }

   for (const member of stale) {
      try {
         if (isPlayer(member)) await store.clearPresence(roomId, member.id)
         else await store.delMember(roomId, member.id)
      } catch (err) {
         /* a sweep that fails must not fail the poll that triggered it */
         console.error('[relay] could not prune a stale member', err)
      }
   }

   const staleIds = new Set(stale.map((m) => m.id))
   const held = stale.filter((m) => isPlayer(m))

   return {
      /*
         The room as it stands: players keep their seat records but read as
         absent, and swept spectators are gone entirely. `SEAT_HELD` is how a
         seat that is being held is told from one somebody is sitting in.
      */
      members: members.map((m) => (staleIds.has(m.id) ? { ...m, lastSeen: SEAT_HELD } : m)),
      fresh: members.filter((m) => !staleIds.has(m.id)),
      pruned: stale,
      seatsLost: held.length,
      /* who is actually sitting there, which is what decides if a room is over */
      heldSeats: countSeats(members) - held.length
   }
}

/*
   Decide what to do about the room the poll has just read, and do it.

   Answers one of:

      { gone: true, reason }        the room is not a game any more and has been
                                    closed
      { idle: null }                nothing to say
      { idle: { at, deadlineAt } }  an idle prompt is outstanding

   `players` and `spectators` describe the room as it stands now, after the
   sweep, so the reply does not have to describe a room that is no longer there.
   `rejoin`, when present, is a wait that is running for a player who vanished.

   `seats` is the subtle one. A playing seat whose player has gone quiet is
   *held* rather than given up (see pruneStaleMembers), so the room still knows
   whose it is - but nobody is sitting in it. A room with no seats left at all
   is over; a room with seats held is waiting.
*/
export async function maintainRoom (store, roomId, room, now = Date.now(), seats = null) {
   const seatsHeld = seats === null ? countSeats(room.members, now) : seats
   const spectators = spectatorsOf(room.members)

   /*
      Nobody is in a playing seat, held or otherwise. Either every player has
      left - in which case the leave itself closed the room, and this is a room
      only a spectator was holding open - or the sweep above removed a stale one.
   */
   if (!seatsHeld) {
      await closeRoom(roomId, 'closed')
      return { gone: true, reason: 'closed', players: 0, spectators: spectators.length }
   }

   /*
      One player, waiting for the other to join at all. A room is not a game
      until somebody sits opposite, and a code nobody ever used should not hold
      a room - and its keys - for the six hours the TTL would otherwise allow.
      The window a room was created under is stamped in its own metadata, so
      this needs no second opinion about what the deployment is running with.

      This is deliberately *not* "one player and nobody else ever came". A room
      that had two players and lost one is a game waiting for somebody to come
      back, which is a different wait with a different ending - and closing it
      as "the opponent never arrived" because the creator's original window had
      since passed is exactly the wrong thing to say. `guestJoined` is what
      tells the two apart, and it is set when a second player first sits down.

      The deadline is reached or passed rather than compared for equality:
      polls are the only clock here, so the moment it expires is sooner or
      later than any particular request.
   */
   const hostDeadlineAt = Number(room.hostDeadlineAt || (Number(room.createdAt || 0) + RELAY_HOST_WAIT_MS))
   const neverJoined = !room.guestJoined
   if (neverJoined && seatsHeld === 1 && hostDeadlineAt && now >= hostDeadlineAt) {
      await closeRoom(roomId, 'opponentTimeout')
      return { gone: true, reason: 'opponentTimeout', players: seatsHeld, spectators: spectators.length }
   }

   /*
      A game whose player vanished without leaving: their seat is waiting for
      them, but not for ever. When the wait runs out the room closes for
      whoever is still in it, which is the difference between a game that is
      paused and one that can never be played again.
   */
   const rejoinDeadlineAt = Number(room.rejoinDeadlineAt || 0)
   if (rejoinDeadlineAt && now >= rejoinDeadlineAt) {
      await closeRoom(roomId, 'rejoinTimeout')
      return { gone: true, reason: 'rejoinTimeout', players: seatsHeld, spectators: spectators.length }
   }

   const lastActionAt = Number(room.lastActionAt || room.createdAt || 0)
   if (now - lastActionAt < RELAY_IDLE_MS) {
      return {
         gone: false,
         idle: null,
         rejoin: rejoinDeadlineAt ? { at: rejoinDeadlineAt - RELAY_REJOIN_WAIT_MS, deadlineAt: rejoinDeadlineAt } : null,
         players: seatsHeld,
         spectators: spectators.length
      }
   }

   const promptedAt = Number(room.idlePromptedAt || 0)

   /* asked, and nobody said they were still playing */
   if (promptedAt && now - promptedAt >= RELAY_PROMPT_MS) {
      await closeRoom(roomId, 'idle')
      return { gone: true, reason: 'idle', players: seatsHeld, spectators: spectators.length }
   }

   /*
      Idle long enough to ask, and nobody has asked yet. The marker goes down
      first, so two polls arriving together still produce one prompt, and the
      event carries the same clock the marker does - that timestamp is what a
      late joiner counts down from, so it must not be the event's own arrival
      time.
   */
   const at = promptedAt || await setIdlePrompted(roomId, now)
   if (!at) {
      /* the room went between reading it and marking it */
      return { gone: true, reason: 'expired', players: seatsHeld, spectators: spectators.length }
   }

   if (!promptedAt) {
      await appendEvent(roomId, 'idlePrompt', { at, promptMs: RELAY_PROMPT_MS }, { from: null })
   }

   return {
      gone: false,
      idle: { at, promptMs: RELAY_PROMPT_MS, deadlineAt: at + RELAY_PROMPT_MS },
      rejoin: rejoinDeadlineAt ? { at: rejoinDeadlineAt - RELAY_REJOIN_WAIT_MS, deadlineAt: rejoinDeadlineAt } : null,
      players: seatsHeld,
      spectators: spectators.length
   }
}

/*
   A player gave up their seat without a game to end, which in practice means
   the tab went away: a close, a refresh, a crash, a browser that lost the
   network before it could say goodbye.

   The seat is held for them and the clock starts, because coming back to the
   same seat is the normal way a reload is meant to behave. The first wait wins,
   so two of them noticing at once do not extend each other; joining again
   clears it (see joinRoom).
*/
export async function startRejoinWait (roomId, now = Date.now()) {
   const deadline = await setRejoinDeadline(roomId, now + RELAY_REJOIN_WAIT_MS)
   return deadline ? { at: now, deadlineAt: deadline, waitMs: RELAY_REJOIN_WAIT_MS } : null
}

/*
   Somebody said they are still playing: clear the marker and say so, so the
   other player's prompt goes away too. The dismissal is an event like any
   other, so `lastActionAt` moves with it and the next prompt is a whole idle
   window away rather than arriving again at once.
*/
export async function dismissIdlePrompt (roomId, now = Date.now()) {
   const room = await getRoom(roomId)
   if (!room) return null

   await saveMeta(roomId, room, { idlePromptedAt: 0 })
   /*
      Re-read rather than reusing `room`: appending writes the activity stamp
      back with the metadata it was given, so handing it a copy taken before the
      marker was cleared would put the marker back.
   */
   return appendEvent(roomId, 'idleDismissed', { at: now }, { from: null })
}
