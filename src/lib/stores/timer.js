import { writable } from './custom/writable.js'
import { socket } from './connection.js'

/*
   The game timer, and the one place it is understood.

   The clock is shared as a **value**, not a tick: "this much time is left as of
   this moment". Every client counts down from that itself, so a running clock
   costs no traffic at all - starting, pausing and setting it are the only events.

   There are two clocks in that sentence, and getting them mixed up is what made
   the display stick and then skip:

      the relay's  what `at` is on the wire, because two players' machines do not
                   agree on what time it is
      this browser what a countdown has to run on, because it has to be smooth
                   and nothing here should depend on a round trip

   So a value is converted **once**, as it arrives, from the relay's clock into
   this browser's, and everything after that counts down in local time. The
   conversion is the only place `socket.serverNow()` is consulted for the clock,
   and it is why this module exists: the mirror had its own copy of this, in the
   relay's clock, and the two disagreed the moment either was behind.

   The countdown itself is measured against a *monotonic* reading, not the wall
   clock, so a machine whose clock is corrected mid-round does not make the clock
   on screen jump.
*/

/*
   The clock a room starts with: fifty minutes, paused. A round of this game is
   played to a time limit rather than to a stopwatch, so the useful default is
   the limit itself.
*/
export const DEFAULT_TIMER_MS = 50 * 60 * 1000
const STOPPED = { running: false, remaining: DEFAULT_TIMER_MS, at: 0 }

/*
   A reading that only ever moves forward at one second per second, whatever the
   machine's clock does. `performance.now()` is that reading and is in every
   browser this app runs in; `Date.now()` is the fallback, and the two are never
   mixed inside one value because `at` is always taken from here.
*/
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export const timer = writable(STOPPED)

/*
   Set while this browser's own change to the clock is on its way to the relay.

   The change is applied here at once and sent behind it, so for as long as it is
   in the send queue the relay is still describing the clock as it was - and a
   poll already in flight, or answered before the event landed, carries the value
   from before. Re-anchoring to that would put the old time back on screen for a
   moment, which is a clock that jumps when somebody presses pause. So a sync is
   ignored for as long as the change could still be in the post.
*/
const SYNC_HOLD_MS = 1500
let heldUntil = 0

export function holdSync (forMs = SYNC_HOLD_MS) {
   heldUntil = Math.max(heldUntil, Date.now() + forMs)
}

/* the clock a fresh room starts on, in this browser's own reading */
export function resetTimer () {
   timer.set(STOPPED)
}

/*
   What the clock reads at a given local reading. One function, used by the clock
   itself, by the prompt that sets it and by anything else that wants to know -
   so no two of them can disagree about how a running clock is aged.
*/
export function remainingAt (state, at = now()) {
   if (!state?.running) return Math.max(0, Number(state?.remaining) || 0)

   const remaining = Math.max(0, Number(state.remaining) || 0)
   const since = Math.max(0, at - (Number(state.at) || at))
   return Math.max(0, remaining - since)
}

/*
   A timer value from the relay, in this browser's clock.

   `at` is the relay's clock: the moment the sender set the clock, on the clock
   everyone shares. How much has been spent since then is therefore the same for
   everyone, and taking it off the value here is exact - what differs between two
   clients is only when they apply it, which is their own latency and not an
   error that grows.

   Only a clock that is *running* has spent anything. A paused one is a number
   somebody chose, and it is the same number a second later: taking the trip off
   that would make a clock set to 12:34 read 12:33 on the other board - and keep
   reading it until the relay's own snapshot arrived on a later poll, which is up
   to a whole long poll away. The snapshot does not age a paused clock (see
   timerSnapshot in the relay), so this is the same rule, applied as the news
   lands rather than up to twenty seconds after it.
*/
export function fromRelay ({ running, remaining, at }, receivedAt = now()) {
   const left = Math.max(0, Number(remaining) || 0)
   const setAt = Number(at) || socket.serverNow()
   const spent = running ? Math.max(0, socket.serverNow() - setAt) : 0

   return {
      running: Boolean(running),
      remaining: Math.max(0, left - spent),
      at: receivedAt
   }
}

/*
   The relay's periodic snapshot of the clock, applied to the countdown.

   This is what keeps two browsers together over fifty minutes rather than for
   the first thirty seconds of them: the relay owns the clock's anchor, so each
   poll it can say what the clock reads *now* rather than leaving every client to
   work it out from an event that may be an hour old.

   Re-anchoring alone would be enough on a perfect clock, but a client whose
   clock runs a little fast or slow drifts away from the relay between syncs -
   and every client drifts a different amount, which is exactly how two people
   watching the same game end up a second or two apart. Correcting that is the
   point of the snapshot.

   A snapshot is never a step backwards on screen, or a step forwards beyond the
   round trip's own noise. They arrive as regularly as the poll, so a value that
   is out by more than that is not news - it is the old value arriving late, or a
   browser whose own clock was corrected and which therefore misreads the relay's.
   Dropping it costs nothing: the next one puts it right, and the player is never
   shown time moving in the wrong direction. What that means in practice is that a
   client a little fast is pulled back a fraction of a second every couple of
   seconds, rather than being handed a jump.
*/
/*
   How far a snapshot may move a clock that is already running, before it is
   treated as a bad sample rather than a correction.

   Both directions can be wrong, and for the same reason: a snapshot is derived
   from the browser's idea of the relay's clock, and that estimate is only as good
   as the moment it was measured. A machine whose clock is corrected under it -
   NTP, a laptop waking - reads the relay wrongly for as long as it takes to
   notice, and a snapshot converted through that would move the table's clock by
   the size of the jump. So a correction is a small thing: a client that is a
   little fast is pulled back, and a poll answered before it should have been is
   ignored.

   What is *not* restricted is a clock that stops, starts or is set. That is a
   different state rather than a different number, and it is how a paused clock
   that somebody adds ten minutes to reaches the other side.
*/
const SYNC_JUMP_MS = 1000

export function syncTimer (snapshot, receivedAt = now()) {
   if (!snapshot || typeof snapshot !== 'object') return false
   if (Date.now() < heldUntil) return false

   const left = Math.max(0, Number(snapshot.remaining) || 0)
   const running = Boolean(snapshot.running)
   if (!running && left <= 0 && !snapshot.at) return false

   const current = timer.get()
   const showing = remainingAt(current, receivedAt)

   /*
      A clock already running only ever takes a small correction. A larger one is
      the old value arriving late or a mis-measured relay clock, and putting it on
      screen would be the clock jumping - which is the fault this is all here to
      remove.
   */
   if (current.running && running && Math.abs(left - showing) > SYNC_JUMP_MS) return false

   /*
      And a snapshot that says what the clock already says is not worth a store
      write: a running clock is re-anchored every couple of seconds, and waking
      every subscriber to tell them nothing would be work for no change. One
      millisecond is the round trip's own noise, not a difference in the time.
   */
   if (current.running === running && Math.abs(left - showing) <= 1) return false

   timer.set({ running, remaining: left, at: receivedAt })
   return true
}

/*
   One way to change the clock: a player's own action, applied here at once in
   this browser's clock.

   The event that tells the other side is not sent from here. Publishing belongs
   to the store that owns the relay, so a spectator is refused in one place
   rather than two - what this returns is the value to publish, on the relay's
   clock, which is the only form the other side can convert.
*/
export function changeTimer ({ running, remaining }) {
   const left = Math.max(0, Number(remaining) || 0)
   const state = { running: Boolean(running), remaining: left, at: now() }

   timer.set(state)

   return {
      running: state.running,
      remaining: left,
      /* what the other side reads, in the clock everyone shares */
      at: socket.serverNow()
   }
}
