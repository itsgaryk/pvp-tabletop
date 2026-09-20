/*
 * A stand-in for the Limitless TCG deck-import API.
 *
 * "Import Deck" and "Import Random Deck" post a decklist to
 * `VITE_LIMITLESS_WEB` and read back the cards that make it up. Point the app at
 * this instead and a browser check can build a board with a deck on it without
 * reaching the internet - which matters twice over: the real endpoint is not
 * always answering, and a check that depends on somebody else's site going up is
 * not a check.
 *
 *   node tools/fake-deck-api.mjs                          # terminal 1
 *   VITE_LIMITLESS_WEB=http://127.0.0.1:6391 npm run dev   # terminal 2
 *
 * Then:  node tools/deck-order-check.mjs
 *
 * The deck is deterministic and its **60 card names are all distinct** - `Card01`
 * to `Card60`, in deck order. That is the point of it: a check about the *order*
 * of a deck cannot say where a card went while "Pikachu" appears four times in
 * it, and "the card I chose is on top" and "a card of that name is on top" come
 * apart exactly when a name repeats. A real deck repeats, and that is worth
 * knowing - but it is not what this stand-in is for, so the names are unique and
 * a grid cell, a name and a position are all the same statement.
 *
 * Card objects are shaped like the API's (`fixOld` and `cardImage` are read for
 * the fields they use): `set` + `number` make the image URL, and the image host
 * is *not* stubbed - a check that cares about a card's name reads it off the DOM
 * either way, and whether the picture loaded is not what is being tested.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_DECK_API_PORT || 6391)
const HOST = '127.0.0.1'

const CARDS = []
for (let i = 1; i <= 60; i++) {
   CARDS.push({
      name: 'Card' + String(i).padStart(2, '0'),
      set: 'TST',
      number: String(i),
      card_type: i % 3 === 0 ? 'energy' : (i % 2 === 0 ? 'trainer' : 'pokemon')
   })
}

/* one of each, in deck order: the deck's order is what these checks are about */
function deck () {
   return CARDS.map(card => ({ ...card, count: 1, region: 'int' }))
}

/*
   The app fetches this from its own origin, so every answer has to be readable
   cross-origin: without these the request arrives, the status is 200, and the
   browser refuses the body - a failure that looks like a dead endpoint from the
   app's side and like a successful request from this one.
*/
const CORS = {
   'access-control-allow-origin': '*',
   'access-control-allow-methods': 'GET, POST, OPTIONS',
   'access-control-allow-headers': 'content-type'
}

const send = (res, status, body) => {
   const text = JSON.stringify(body)
   res.writeHead(status, {
      ...CORS,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(text)
   })
   res.end(text)
}

const server = createServer((req, res) => {
   if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
   }

   const url = new URL(req.url, `http://${req.headers.host}`)

   if (url.pathname === '/api/dm/random') {
      send(res, 200, { cards: deck(), errors: [] })
      return
   }

   if (url.pathname === '/api/dm/import') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
         /*
            The real API parses the decklist; this answers with the same deck for
            anything non-empty, and an empty list for anything empty - which is
            the one distinction a check could depend on.
         */
         if (!body || !/"input"\s*:\s*"[^"]+/.test(body)) {
            send(res, 200, { cards: [], errors: [ 'no decklist' ] })
            return
         }
         send(res, 200, { cards: deck(), errors: [] })
      })
      return
   }

   send(res, 404, { error: 'not found' })
})

server.listen(PORT, HOST, () => {
   console.log(`fake deck api on http://${HOST}:${PORT} - ${CARDS.length} distinct cards, 60 in the deck`)
})
