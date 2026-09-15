/*
   Relay timing, in one place so the health endpoint can report what a deployment
   is actually running with. These two numbers decide what the relay costs: the
   poll interval is how often a waiting client asks the store whether anything
   has happened, and the wait is how long its request is held open.

   RELAY_POLL_INTERVAL_MS is the one worth turning. At 2000 an idle client costs
   about 0.85 store commands a second (~3,000 an hour); doubling it halves that,
   at the price of that much delay before an opponent's or a spectator's view
   catches up with a move.
*/

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

export const WAIT_MS = clamp(Number(process.env.RELAY_POLL_WAIT_MS) || 20000, 0, 50000)
export const POLL_INTERVAL_MS = clamp(Number(process.env.RELAY_POLL_INTERVAL_MS) || 2000, 50, 5000)

/* a client may ask for a lazier check than the default, never a keener one */
export const MAX_REQUESTED_INTERVAL_MS = 30000
