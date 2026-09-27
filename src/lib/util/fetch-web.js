import { LIMITLESS_WEB as target } from './env.js'

/*
   The deck API, asked for a list.

   The two things here are about the answer rather than the request, and both exist
   because this API is somebody else's: it can be slow, rate-limited or unreachable
   (see docs/gotchas.md).

      a deadline   a request with no deadline is a window that never closes. It is
                   abandoned after DEADLINE_MS, the way the relay's own requests are
                   (REQUEST_TIMEOUT_MS in relay/client.js), and the abort is what
                   actually ends it rather than merely walking away from it.

      onError      is called when no answer came at all: the deadline ran out, the
                   host could not be reached, or the body was not JSON. It used to end
                   at `console.error` with the callback never called, and nothing on
                   screen can tell that from a request still in flight - the Import
                   Deck window sat on its spinner, and in a room, where it cannot be
                   dismissed until a deck lands, the player was stuck with no button
                   left to press.

   The import's own callback is deliberately *not* called for a failure: nothing
   arrived, and a request that never got there is not an empty decklist. Loading one
   would rebuild the board the player already has out of nothing (see importDeck in
   player.js).
*/
const DEADLINE_MS = 30000

/* why no answer came, in the caller's terms rather than the browser's */
function reason (err, controller) {
   if (err && (err.name === 'AbortError' || controller.signal.aborted)) {
      return `The deck API did not answer within ${Math.round(DEADLINE_MS / 1000) || 1} seconds.`
   }

   return `Could not reach the deck API. (${err?.message || err})`
}

function request (endpoint, options, callback, onError) {
   const controller = new AbortController()
   const timer = setTimeout(() => controller.abort(), DEADLINE_MS)

   fetch(target + endpoint, { ...options, signal: controller.signal })
      .then((res) => res.json())
      .then(
         (res) => callback(res),
         (err) => {
            console.error(err)
            if (onError) onError(reason(err, controller))
         }
      )
      .finally(() => clearTimeout(timer))
}

function get (endpoint, callback, onError = null) {
   request(endpoint, {
      method: 'GET',
      headers: {
         'Content-Type': 'application/json',
      }

   }, callback, onError)
}

function post (endpoint, body, callback, onError = null) {
   request(endpoint, {
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)

   }, callback, onError)
}

export { get, post }
