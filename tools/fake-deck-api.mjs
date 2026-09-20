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
 * The deck is deterministic: the same 60 cards every time, a mix of four-ofs and
 * three-ofs, deliberately including duplicate names. A deck of distinct cards is
 * the easy case - "the card I chose is on top" and "a card of that name is on
 * top" only come apart when a name repeats, and a real deck always repeats.
 *
 * Card objects are shaped like the API's (`fixOld` and `cardImage` are read for
 * the fields they use): `set` + `number` make the image URL, and the image host
 * is *not* stubbed - a check that cares about a card's name reads it off the DOM
 * either way, and whether the picture loaded is not what is being tested.
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_DECK_API_PORT || 6391)
const HOST = '127.0.0.1'

/* names that read like a real deck, with the sets they really come from */
const CARDS = [
   { name: 'Charizard ex', set: 'OBF', number: '125', card_type: 'pokemon' },
   { name: 'Pidgeot ex', set: 'OBF', number: '164', card_type: 'pokemon' },
   { name: 'Charmander', set: 'OBF', number: '26', card_type: 'pokemon' },
   { name: 'Pidgey', set: 'OBF', number: '162', card_type: 'pokemon' },
   { name: 'Rotom V', set: 'LOR', number: '58', card_type: 'pokemon' },
   { name: 'Manaphy', set: 'BRS', number: '41', card_type: 'pokemon' },
   { name: 'Radiant Greninja', set: 'ASR', number: '46', card_type: 'pokemon' },
   { name: 'Lumineon V', set: 'BRS', number: '40', card_type: 'pokemon' },
   { name: 'Iono', set: 'PAL', number: '185', card_type: 'trainer' },
   { name: 'Professor\'s Research', set: 'SVI', number: '189', card_type: 'trainer' },
   { name: 'Boss\'s Orders', set: 'PAL', number: '172', card_type: 'trainer' },
   { name: 'Arven', set: 'SVI', number: '166', card_type: 'trainer' },
   { name: 'Rare Candy', set: 'SVI', number: '191', card_type: 'trainer' },
   { name: 'Ultra Ball', set: 'SVI', number: '196', card_type: 'trainer' },
   { name: 'Nest Ball', set: 'SVI', number: '181', card_type: 'trainer' },
   { name: 'Super Rod', set: 'PAL', number: '188', card_type: 'trainer' },
   { name: 'Switch Cart', set: 'ASR', number: '154', card_type: 'trainer' },
   { name: 'Forest Seal Stone', set: 'SIT', number: '156', card_type: 'trainer' },
   { name: 'Artazon', set: 'PAL', number: '229', card_type: 'trainer' },
   { name: 'Fire Energy', set: 'SVE', number: '2', card_type: 'energy' }
]

/* four of each until the deck is 60: the last few drop to three */
function deck () {
   const cards = []
   let left = 60

   for (const card of CARDS) {
      if (left <= 0) break
      const count = Math.min(4, left)
      cards.push({ ...card, count, region: 'int' })
      left -= count
   }

   return cards
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
