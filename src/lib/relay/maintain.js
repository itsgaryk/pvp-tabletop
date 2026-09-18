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
   getRoom,
   playersOf,
   saveMeta,
   setIdlePrompted,
   spectatorsOf
} from './store.js'
import { RELAY_IDLE_MS, RELAY_PROMPT_MS, RELAY_MEMBER_STALE_MS } from './timing.js'

/*
   Sweep members whose presence has stopped being refreshed, and say what is
   left. The writes only happen for a member that has actually gone: a live room
   costs one comparison per member and no commands.
*/
export async function pruneStaleMembers (store, roomId, members, now = Date.now()) {
   const cutoff = now - RELAY_MEMBER_STALE_MS
   const stale = (members || []).filter((m) => (m.lastSeen || 0) < cutoff)
   if (!stale.length) return { members, pruned: [] }

   for (const member of stale) {
      try {
         await store.delMember(roomId, member.id)
      } catch (err) {
         /* a sweep that fails must not fail the poll that triggered it */
         console.error('[relay] could not prune a stale member', err)
      }
   }

   const prunedIds = new Set(stale.map((m) => m.id))
   return { members: members.filter((m) => !prunedIds.has(m.id)), pruned: stale }
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
*/
export async function maintainRoom (store, roomId, room, now = Date.now()) {
   const players = playersOf(room.members)
   const spectators = spectatorsOf(room.members)

   /*
      Nobody is sitting in a playing seat. Either every player has left - in
      which case the leave itself closed the room, and this is a room only a
      spectator was holding open - or the sweep above removed a stale one.
   */
   if (!players.length) {
      await closeRoom(roomId, 'closed')
      return { gone: true, reason: 'closed', players: 0, spectators: spectators.length }
   }

   const lastActionAt = Number(room.lastActionAt || room.createdAt || 0)
   if (now - lastActionAt < RELAY_IDLE_MS) {
      return { gone: false, idle: null, players: players.length, spectators: spectators.length }
   }

   const promptedAt = Number(room.idlePromptedAt || 0)

   /* asked, and nobody said they were still playing */
   if (promptedAt && now - promptedAt >= RELAY_PROMPT_MS) {
      await closeRoom(roomId, 'idle')
      return { gone: true, reason: 'idle', players: players.length, spectators: spectators.length }
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
      return { gone: true, reason: 'expired', players: players.length, spectators: spectators.length }
   }

   if (!promptedAt) {
      await appendEvent(roomId, 'idlePrompt', { at, promptMs: RELAY_PROMPT_MS }, { from: null })
   }

   return {
      gone: false,
      idle: { at, promptMs: RELAY_PROMPT_MS, deadlineAt: at + RELAY_PROMPT_MS },
      players: players.length,
      spectators: spectators.length
   }
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
