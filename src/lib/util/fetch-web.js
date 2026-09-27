import { LIMITLESS_WEB as target } from './env.js'

/*
   The deck API, asked for a list.

   Three things live here, and all three are about the answer rather than the
   request, because this API is somebody else's: it can be slow, rate-limited,
   unreachable, and it does not always answer in the same shape (see docs/gotchas.md).

      the shape    `answer()` below: a decklist import answers `{ cards, errors }`,
                   and the random endpoint answers `{ cards }` with **no `errors` key
                   at all**. A reader that asks for `res.errors.length` therefore
                   throws on a random deck - inside the import's own callback, after
                   the board has already been given the deck and before the caller is
                   told anything, so the only symptom is a window that never closes.
                   Both fields are settled here, once, where the API's shape is this
                   file's business.

      a deadline   a request with no deadline is a window that never closes either.
                   It is abandoned after DEADLINE_MS, the way the relay's own requests
                   are (REQUEST_TIMEOUT_MS in relay/client.js), and the abort is what
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

/*
   What every caller of this file may assume: `cards` is an array, and so is `errors`.

   A body that carries no `cards` is not a decklist at all - an error object, a
   redirect, somebody else's HTML that happened to parse as JSON - and it is answered
   as the import's own kind of failure rather than loaded, so the board keeps the deck
   it has and the window says what came back instead.
*/
function answer (res) {
   const body = (res && typeof res === 'object') ? res : {}

   if (!Array.isArray(body.cards)) {
      return {
         cards: [],
         errors: [ typeof body.error === 'string' ? body.error : 'The deck API sent something that is not a deck.' ]
      }
   }

   if (!Array.isArray(body.errors)) body.errors = []

   return body
}

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
         (res) => callback(answer(res)),
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
