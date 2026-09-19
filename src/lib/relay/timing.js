/*
   Relay timing that only the server needs, in one place beside config.js.

   config.js holds the two numbers a *client* has to agree with the server about
   (how long a poll is held open, and how often it re-reads the cursor) and is
   imported by the browser. Everything here is server-side only, so it reads
   process.env directly and is never part of the browser bundle - the values
   below decide when the relay prompts an idle room and when it stops believing
   a member is there.

   All of them are env-overridable so the behaviour can be verified in seconds
   rather than in tens of minutes:

      RELAY_IDLE_MS        quiet time before an idle room is prompted
      RELAY_PROMPT_MS      how long that prompt waits for an answer before the
                           room is closed
      RELAY_MEMBER_STALE_MS how long without a poll before a member is dropped
      RELAY_HOST_WAIT_MS   how long a room waits for a second player to join it
                           before the room closes
      RELAY_REJOIN_WAIT_MS how long a game waits for a player who vanished
                           without leaving to come back before it closes

   The defaults are the real ones: ten minutes idle, ten minutes of prompt. A
   test sets them to a couple of seconds and gets the same code path.

   A default of a *thousandth* of the prompt window is deliberate for the stale
   member floor: a member is only ever dropped after missing many polls, so a
   misconfigured value cannot delete somebody who is sitting there watching.
*/

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/* TEN_MINUTES: the idle window and the prompt's own countdown in production */
const MINUTE_MS = 60 * 1000
const TEN_MINUTES_MS = 10 * MINUTE_MS
const FIFTEEN_MINUTES_MS = 15 * MINUTE_MS

export const RELAY_IDLE_MS = clamp(
   Number(process.env.RELAY_IDLE_MS) || TEN_MINUTES_MS,
   1000,
   24 * 60 * MINUTE_MS
)

export const RELAY_PROMPT_MS = clamp(
   Number(process.env.RELAY_PROMPT_MS) || TEN_MINUTES_MS,
   1000,
   24 * 60 * MINUTE_MS
)

/*
   How long a member's presence may go unrefreshed before the relay stops
   counting them. The poll refreshes presence on the way in and on the way out,
   so a healthy member is never close to this; a tab that was killed is, and a
   killed spectator inflates the count in the header for as long as it is
   believed.

   Four times the longest a healthy poll can legitimately run (its hold plus the
   client's own timeout), with a floor so a very short test window cannot prune a
   member who is mid-poll.
*/
export const RELAY_MEMBER_STALE_MS = clamp(
   Number(process.env.RELAY_MEMBER_STALE_MS) || 4 * (Number(process.env.RELAY_POLL_WAIT_MS) || 20000) + 60000,
   5000,
   6 * 60 * MINUTE_MS
)

/*
   Two waits about a seat that is not being sat in.

   RELAY_HOST_WAIT_MS is how long a room waits for a second player at all. A
   room is made by one person and only becomes a game when somebody joins it, so
   a code nobody ever used should not hold a room (and its keys) for six hours:
   the creator's own countdown closes it and says why.

   RELAY_REJOIN_WAIT_MS is how long a game carries on after a player vanishes
   without saying goodbye - a tab closed, a browser refreshed, a machine that
   died. Their seat is held for them and the game waits, because coming back to
   the same seat is the normal way a reload is meant to behave; when the wait
   runs out the room closes for whoever is left, rather than leaving them on a
   board that can never be played.

   Both are counted from the room's metadata, so they need no scheduler: the
   players' own polls notice, exactly as the idle prompt does.
*/
export const RELAY_HOST_WAIT_MS = clamp(
   Number(process.env.RELAY_HOST_WAIT_MS) || TEN_MINUTES_MS,
   1000,
   24 * 60 * MINUTE_MS
)

export const RELAY_REJOIN_WAIT_MS = clamp(
   Number(process.env.RELAY_REJOIN_WAIT_MS) || FIFTEEN_MINUTES_MS,
   1000,
   24 * 60 * MINUTE_MS
)
