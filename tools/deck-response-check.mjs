/*
   Can the app read the deck API's answer, in every shape that API actually sends?

   This exists because of a bug that reached a player while every check was green.

   A decklist import answers `{ cards, errors }`. The **random** endpoint answers
   `{ cards }` and no `errors` key at all. The import store asked for
   `res.errors.length` on its way to telling its caller anything:

      const callback = (res) => {
         cards.set(res.cards)
         reset()                                  // the deck is in the deck zone now
         if (!res.errors.length) deck.shuffle()   // TypeError: undefined has no length
         cb(res)                                  // never runs
      }

   So a random import left a deck on the board behind a window that never closed and a
   spinner that never stopped, with one swallowed error in the console. Nothing here
   could see it, because `tools/fake-deck-api.mjs` sent `errors: []` on that endpoint:
   the stand-in was the one shape the app could read.

   Two things are asserted, and both are about the *shape* of an answer rather than
   about making a request:

      the stand-in tells the truth   its random endpoint sends no `errors` key, the way
                                     the real one does - a stand-in that fills one in
                                     cannot fail this way, and so cannot catch it

      the answer is settled once      `answer()` in util/fetch-web.js, taken out of that
                                     file and run here, hands every caller an array in
                                     `cards` and an array in `errors`, whatever came back

     node tools/deck-response-check.mjs
     node tools/deck-response-check.mjs --quiet

   Read-only. No browser, no server, no network, nothing started.
*/

import { readFileSync } from 'node:fs'

const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* the normaliser, from the file rather than from here: a copy would drift */
const source = readFileSync('src/lib/util/fetch-web.js', 'utf8')
const fn = /function answer \(res\) \{[\s\S]*?\n\}/.exec(source)

if (!fn) {
   console.log('  FAIL  could not find answer() in util/fetch-web.js - the module changed shape')
   process.exit(1)
}

const answer = new Function(`${fn[0]}; return answer`)()

/*
   The four bodies that can arrive. The last two are not decklists at all, which is a
   thing an intermediary can answer with - a proxy's JSON error, or a body that parsed
   as JSON but is somebody else's.
*/
const RANDOM = { cards: [ { name: 'Miraidon ex', count: 3 } ] }
const IMPORT = { cards: [ { name: 'Ultra Ball', count: 4 } ], errors: [ 'unknown card: Foo' ] }
const ERROR_BODY = { error: 'no decklist' }
const NOT_A_DECK = { status: 'ok' }

const random = answer(RANDOM)
check('a random deck reads: its cards, and an errors array that was not sent',
   Array.isArray(random.cards) && random.cards.length === 1 && Array.isArray(random.errors),
   JSON.stringify(random.errors))
check('so `res.errors.length` cannot throw on it',
   (() => { try { return random.errors.length === 0 } catch { return false } })())

const imported = answer(IMPORT)
check('an import keeps the API\'s own errors',
   imported.errors.length === 1 && imported.errors[0] === 'unknown card: Foo',
   JSON.stringify(imported.errors))
check('and its cards', imported.cards.length === 1, String(imported.cards.length))

const failed = answer(ERROR_BODY)
check('a body with no cards is an import failure, not a deck to load',
   failed.cards.length === 0 && failed.errors[0] === 'no decklist', JSON.stringify(failed))

const junk = answer(NOT_A_DECK)
check('and so is a body that is not an import\'s at all',
   junk.cards.length === 0 && junk.errors.length === 1, JSON.stringify(junk))

/* and the stand-in must not paper over the shape the app has to read */
const api = readFileSync('tools/fake-deck-api.mjs', 'utf8')
const branch = /\/api\/dm\/random'\)[\s\S]{0,400}?send\(res, 200, (\{[^}]*\})\)/.exec(api)

check('the stand-in\'s random endpoint is findable', Boolean(branch))
check('and it sends no errors key, like the real one',
   Boolean(branch) && !/errors/.test(branch[1]), branch ? branch[1] : 'no branch')
check('and it still sends the deck', Boolean(branch) && /cards:/.test(branch[1]),
   branch ? branch[1] : 'no branch')

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - a deck answer the app cannot read, or a stand-in that hides one`)
   process.exit(1)
}
console.log('verdict: ok - a random deck and an import both read, and the stand-in answers like the real API')
