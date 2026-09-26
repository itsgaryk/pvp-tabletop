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
   'oppDamageUpdated',
   /*
      Reveal and Look. `cardsRevealed` states which cards are on show to both
      players; `cardsLooked` states the same for a *Look*, which is shown to the
      player who took it and to the room's watchers and to nobody else - see
      `audienceOf`, which is the enforcement rather than a convention;
      `backToDeck` is the shuffle that ends such a window (the deck it names is
      the one whose order is gone); `oppCardAction` is one player asking the
      *owner* of a card to move it, which is the only way an action on the other
      half can be performed at all - the owner's board is the authority for its
      own cards (see docs/reveal.md).
   */
   'cardsRevealed',
   'cardsLooked',
   'backToDeck',
   'oppCardAction'
])

/*
   Which members an event is for, or null for the whole room.

   Every event here is the room's - both players and every watcher are told what
   happened - with one exception, and it is the reason this exists at all. A **Look**
   is private to the player who took it: `cardsLooked` carries the ids of cards out of
   a face-down deck, and handing those ids to that deck's *owner* would tell them what
   was looked at, which is the whole of what a face-down deck withholds (see
   `lookLine` in the client's reveal.js).

   **`chatMessage` is in the list for the same reason and one line further on**: a Look
   writes two lines, and the one that *names* the cards goes to the same audience as the
   window - the looker and the watchers (see `publishLogTo` and `lookedLine` in the
   client). The unnamed line is the room's and rides the ordinary path. It is the same
   list because it is the same rule: the cards a look names are for the people who were
   shown them.

   So the sender names its audience as `{ to: [ memberId, ... ] }` and the relay
   splices that field back out before the payload is stored or delivered: a member
   is told what it needs and never who else was named, and the event in the log
   carries only the game's own state.

   It is a *list* rather than a role, because the audience is who it is: the
   looker's member id is the sender's own, and every spectator in the room is
   found from membership here rather than trusted to the client.
*/
const ADDRESSED = new Set([ 'cardsLooked', 'chatMessage' ])

function audienceOf (name, data, room, memberId) {
   if (!ADDRESSED.has(name)) return null

   /*
      A line that named nobody is the room's, and null is what says so.

      It matters for `chatMessage` above all: almost every chat line is the room's, and the
      one field this function reads is only there when somebody asked for an audience. Without
      this the set of addressed types was enough to send every ordinary log line to "the
      sender and the room's spectators" - the opponent's game log went silent for reveals,
      shuffles, draws and everything else (see the note at the call site).
   */
   const asked = Array.isArray(data?.to) ? data.to.map(String) : []
   if (!asked.length) return null

   /* who the sender asked for, and only ever members of this room */
   const named = new Set([ memberId, ...asked ])

   return room.members
      .map((m) => m.id)
      .filter((id) => named.has(id) || room.members.find((m) => m.id === id)?.role === 'spectator')
}

/* the payload without the audience field: what travels is the game's own state */
function withoutAudience (data) {
   if (!data || typeof data !== 'object' || !('to' in data)) return data
   const { to, ...rest } = data
   return rest
}

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
         Who this event is for, decided here and stored with it, so the poll can
         answer a member without re-deriving the rule (see `audienceOf`).

         **`to` is read from the request's own `data`, not from `payload`**, and that is the
         whole of why this looks redundant: the reshape above *builds a new object* for a
         chat line - message, type and name and nothing else - so an audience asked for in
         `data.to` was not in `payload` at all. Every chat line then fell back to "the sender
         and the room's spectators", which is what an absent audience means for a Look, and
         the other player stopped being told anything: the game log on their board went
         silent for reveals, shuffles and every other line. Measured against the dev relay -
         one room, a player, an opponent and a watcher - a room-wide `chatMessage` reached
         the sender and the watcher and never the opponent.
      */
      const to = audienceOf(name, name === 'chatMessage' ? data : payload, room, memberId)

      /*
         `from` lets the poll tell the sender's own echo apart from the
         opponent's events. Without it a player sees their own message twice -
         once when they publish it locally, once relayed back to them.
      */
      const event = await appendEvent(roomId, name, withoutAudience(payload), {
         from: memberId,
         meta: room,
         to
      })
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
