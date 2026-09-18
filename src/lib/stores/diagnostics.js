/*
   What the relay actually delivered to this browser, and what went wrong.

   The relay can be asked what it *stored* (tools/room-log.mjs). This is the
   other half of that question, and the half the spectator bugs lived in: the
   log was healthy, the poll delivered everything, and the client quietly did
   nothing with it. No error, no console line, nothing on screen.

   So two things are kept here, both bounded:

      relayEvents   the last events the transport delivered, each with whether
                    any handler was listening for it. `handled: false` is an
                    event this client received and ignored, which is the single
                    most useful line on the diagnostics screen.
      socket.errors the last faults the transport recorded (see
                    src/lib/relay/client.js) - failed sends, failed polls, and
                    handlers that threw.

   Nothing here changes behaviour: it observes the transport and never feeds
   anything back into it.
*/

import { writable } from './custom/writable.js'
import { socket } from './connection.js'

/* enough to see a pattern, small enough to read on one screen */
const MAX_EVENTS = 50

export const relayEvents = writable([])

/*
   `handled` is the fifth argument the transport passes to onAny observers; it is
   false when no `socket.on(name)` handler exists for the event that just
   arrived.
*/
socket.onAny((name, data, meta, local, handled) => {
   relayEvents.update((list) => {
      list.push({
         at: Date.now(),
         seq: meta?.seq ?? null,
         ts: meta?.ts ?? null,
         name,
         from: meta?.from ?? null,
         /* our own action, echoed back by the relay as part of the room log */
         self: Boolean(meta?.from) && meta.from === socket.id,
         /* raised locally rather than received (connect, leftRoom, idle ...) */
         received: Boolean(meta),
         handled: handled !== false,
         local: Boolean(local)
      })

      return list.length > MAX_EVENTS ? list.slice(-MAX_EVENTS) : list
   })
})

export function clearRelayEvents () {
   relayEvents.set([])
}

/*
   What is on a board, by zone.

   Read through `exportBoard()`, which is the same shape a player sends the relay
   - so "deck 45, hand 7, bench 3" here is the number the other side is being
   told, not a second opinion about the board. A disagreement between this and
   what the other half shows is then a transport or handler fault, which is
   exactly the distinction worth making.
*/
const PILES = ['deck', 'hand', 'prizes', 'discard', 'lz', 'table', 'pickup']

const slotSize = (slot) => slot
   ? (slot.pokemon || []).length + (slot.energy || []).length + (slot.trainer || []).length
   : 0

export function boardZones (board = {}) {
   const zones = {}

   for (const pile of PILES) zones[pile] = (board?.[pile] || []).length

   zones.active = slotSize(board?.active)
   zones.bench = (board?.bench || []).reduce((sum, slot) => sum + slotSize(slot), 0)
   zones.stadium = board?.stadium ? 1 : 0
   zones.total = PILES.reduce((sum, pile) => sum + zones[pile], 0)
      + zones.active + zones.bench + zones.stadium

   return zones
}

/*
   Which zone counts are worth showing, in the order they sit on the board. The
   labels are the ones a player would use, not the store's field names.
*/
export const ZONE_LABELS = [
   ['deck', 'deck'],
   ['hand', 'hand'],
   ['prizes', 'prizes'],
   ['active', 'active'],
   ['bench', 'bench'],
   ['discard', 'discard'],
   ['lz', 'lost zone'],
   ['stadium', 'stadium'],
   ['table', 'table'],
   ['pickup', 'in hand (moving)']
]
