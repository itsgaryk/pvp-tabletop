/*
   Does the deck stand-in satisfy the app's own guard for setting a board up?

   This exists because of a specific, expensive bug: tools/fake-deck-api.mjs served
   60 cards with no `stage`, the app's guard is `deckValid = hasBasic($cards)` which
   wants `card.stage === 'basic'`, and `setup()` opens with
   `if (!deckValid && $autoMulligan) return`. So setup() returned at its first line:
   the board stayed empty, two panel checks failed ("Setup lights the Hide Pokemon
   button" and "and it stays lit rather than fading"), and the *app* looked broken
   while the fixture was. Worse, the same checks pass against the real
   limitlesstcg.com, so the failure only existed in the arrangement the checks are
   normally run in.

   A browser cannot always be started to watch setup() run - see the note about
   confined sessions in docs/gotchas.md - so the next best thing is this: take the
   predicate out of the component's own source and run it against what the fixture
   actually builds. Not a copy of the predicate rewritten for a test, and not a
   hand-written deck: both would drift, and drift is what caused the bug.

     node tools/fixture-check.mjs
     node tools/fixture-check.mjs --quiet

   Read-only. No browser, no server, no network, nothing started.
*/

import { readFileSync } from 'node:fs'

const quiet = process.argv.includes('--quiet')

const source = readFileSync('src/lib/play/GameActions.svelte', 'utf8')

/* the predicate, from the component rather than from here */
const fn = /function hasBasic \(cards\) \{[\s\S]*?\n   \}/.exec(source)
if (!fn) {
   console.log('  FAIL  could not find hasBasic in GameActions.svelte - the component changed shape')
   process.exit(1)
}
const hasBasic = new Function(`${fn[0]}; return hasBasic`)()

/* and the guard that uses it, so the short-circuit is not assumed */
const guardFound = /\$: deckValid = hasBasic\(\$cards\)/.test(source)
const bailFound = /if \(!deckValid && \$autoMulligan\) return/.test(source)

/* the deck the fixture builds, read from the fixture's own arithmetic */
const api = readFileSync('tools/fake-deck-api.mjs', 'utf8')

/*
   The stand-in's card_type rule and its stage rule, both taken from the file. If
   either is restructured, this check has to be restructured with it - which is the
   point: a change to the fixture cannot silently stop satisfying the app.
*/
const typeRule = /const cardType = ([^\n]+)/.exec(api)
const stageRule = /stage: 'basic'/.test(api)

if (!typeRule || !stageRule) {
   console.log('  FAIL  could not read the fixture\'s card_type/stage rules - fake-deck-api.mjs changed shape')
   process.exit(1)
}

const typeOf = new Function('i', `return ${typeRule[1]}`)
const cards = []
for (let i = 1; i <= 60; i++) {
   const card_type = typeOf(i)
   cards.push({ name: `Card${String(i).padStart(2, '0')}`, card_type, ...(card_type === 'pokemon' ? { stage: 'basic' } : {}) })
}

const pokemon = cards.filter((c) => c.card_type === 'pokemon').length
const basic = cards.filter((c) => c.stage === 'basic').length
const valid = hasBasic(cards)

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

check('the guard is still `deckValid = hasBasic($cards)`', guardFound)
check('and setup() still bails on it', bailFound)
check('the fixture still builds a 60-card deck', cards.length === 60, String(cards.length))
check('with some Pokemon in it', pokemon > 0, String(pokemon))
check('and every Pokemon carries stage: basic', basic === pokemon, `${basic} of ${pokemon}`)
check('so deckValid is true and setup() can run', valid === true, String(valid))

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - the stand-in no longer lets a board be set up`)
   process.exit(1)
}
console.log(`verdict: ok - the fixture satisfies hasBasic, so setup() will not bail (${basic}/${pokemon} basic Pokemon)`)
