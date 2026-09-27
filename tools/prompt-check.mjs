/*
   Are the board's number prompts asked one way, and do the ids in the components
   exist?

   `src/lib/util/prompts.js` is the one place a count is asked for. Eleven call sites
   across six files used to carry their own copy of the question's words, the parse
   and the bounds, and they had drifted: the same gesture was asked two different
   ways, `parseInt` and `Number` were used for the same question, and the bounds were
   written four different ways - one call site with none at all.

   Two things follow from moving that into a table, and both fail *quietly* without
   this check:

     - **a misspelt id throws.** `numberPrompt` throws rather than asking a dialog
       that says `undefined`, because three other spellings of "nothing was asked"
       would hide it - so the throw is right, and it is also a crash in front of a
       player. A typo is caught here instead.
     - **a new call site can bypass the table.** `parseInt(prompt(...))` still works
       and still looks reasonable, and it is exactly the copy this table replaced.
       The scan below refuses one.

   And the parse itself is asserted rather than assumed, because getting it wrong is
   invisible until somebody cancels a prompt: `Number(null)` is **0**, so the damage
   row - whose floor is 0 - read a cancelled prompt as "set the damage to zero".

     node tools/prompt-check.mjs
     node tools/prompt-check.mjs --quiet
*/

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NUMBER_PROMPTS, numberPrompt, maxFor, DECK_MAX } from '../src/lib/util/prompts.js'

const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const list = (set) => [ ...set ].sort().join(', ') || 'none'

/* ------------------------------------------------------------- the parse -- */

/* the browser's own prompt, answered here so every case is one call away */
let answer = null
globalThis.window = { prompt: () => answer }

const asked = (id, input, decks) => { answer = input; return numberPrompt(id, decks) }

check('a number is returned as a number', asked('draw', '7') === 7)
check('and a numeric string with spaces is read', asked('draw', ' 12 ') === 12)
check('cancel answers null', asked('draw', null) === null)
check('a blank box answers null', asked('draw', '') === null)
check('junk answers null', asked('draw', 'abc') === null)
check('zero answers null for a count of cards', asked('draw', '0') === null)
check('a negative answers null', asked('draw', '-3') === null)
check('Infinity answers null', asked('draw', 'Infinity') === null)

/* a count is a whole number of cards, whatever was typed */
check('a fraction is brought down to a whole card', asked('draw', '2.5') === 2)
check('and rounds towards zero, not to the nearest', asked('draw', '2.9') === 2)

/*
   The damage row is the one whose floor is 0, and that is what made the cancel case
   worth a check of its own: a cancelled prompt is not a zero.
*/
check('zero is a value for damage', asked('damage', '0') === 0)
check('and a blank box is still zero for damage, as it was before the table',
   asked('damage', '') === 0)
check('but a cancelled prompt is not zero, it is nothing',
   asked('damage', null) === null)
check('and junk never reaches slot.damage as NaN', asked('damage', 'abc') === null)

console.log('\nwhat the ceiling does')
check('a count above the deck is brought down to the deck',
   asked('revealTop', '10', { theirs: 3 }) === 3)
check('a count within the deck is left alone',
   asked('revealTop', '2', { theirs: 3 }) === 2)
check('the deck decides, not a number written down',
   asked('revealTop', '99', { theirs: 41 }) === 41)
check('an own-deck row is bounded by the own deck',
   asked('reorderTop', '99', { own: 47, theirs: 3 }) === 47)
check('and a theirs-deck row by theirs',
   asked('lookTop', '99', { own: 47, theirs: 3 }) === 3)
check('a deck of no cards refuses the gesture rather than clamping to nothing',
   asked('draw', '5', { own: 0 }) === null)
check('the damage row has a ceiling of its own and is not clamped by a deck',
   asked('damage', '400', { own: 5, theirs: 5 }) === 400)
check('and a damage typo is brought down to that ceiling',
   asked('damage', '999999', { own: 5, theirs: 5 }) === 999)
check('and the damage ceiling does not move with a deck',
   asked('damage', '999', { own: 1, theirs: 1 }) === 999)
check('and a call site that passes no decks is unbounded rather than wrong',
   asked('revealTop', '10') === 10)

check('a misspelt id throws rather than asking an undefined question',
   (() => { try { numberPrompt('draww'); return false } catch { return true } })())

/* ---------------------------------------------------------- the table -- */

const ids = Object.keys(NUMBER_PROMPTS)

check('every row has a question in it',
   ids.every((id) => typeof NUMBER_PROMPTS[id].question === 'string' && NUMBER_PROMPTS[id].question.trim()),
   list(new Set(ids.filter((id) => !NUMBER_PROMPTS[id].question?.trim()))))
check('and a whole-number floor',
   ids.every((id) => Number.isInteger(NUMBER_PROMPTS[id].min)),
   list(new Set(ids.filter((id) => !Number.isInteger(NUMBER_PROMPTS[id].min)))))
check('and only the damage row allows zero',
   ids.filter((id) => NUMBER_PROMPTS[id].min === 0).join(',') === 'damage',
   list(new Set(ids.filter((id) => NUMBER_PROMPTS[id].min === 0))))
check('and no two rows ask the same thing in the same words',
   new Set(ids.map((id) => NUMBER_PROMPTS[id].question)).size === ids.length,
   list(new Set(ids
      .map((id) => NUMBER_PROMPTS[id].question)
      .filter((q, i, all) => all.indexOf(q) !== i))))

/*
   The two fields added after the table was written: what kind of number a row asks
   for, and the most the board will allow.
*/
const TYPES = [ 'cards', 'damage' ]

check('every row says what kind of number it asks for',
   ids.every((id) => TYPES.includes(NUMBER_PROMPTS[id].type)),
   list(new Set(ids.filter((id) => !TYPES.includes(NUMBER_PROMPTS[id].type)))))
check('and only the damage row is not a count of cards',
   ids.filter((id) => NUMBER_PROMPTS[id].type === 'damage').join(',') === 'damage',
   list(new Set(ids.filter((id) => NUMBER_PROMPTS[id].type === 'damage'))))

/* a ceiling is either a named deck or nothing at all - never a number written down */
const named = new Set([ DECK_MAX.OWN_DECK, DECK_MAX.THEIR_DECK, DECK_MAX.EITHER_DECK ])
const isDeck = (row) => named.has(row.max)
const isLiteral = (row) => typeof row.max === 'number'

check('every row names a deck as its ceiling, or a number, or has none',
   ids.every((id) => NUMBER_PROMPTS[id].max === null || isDeck(NUMBER_PROMPTS[id]) || isLiteral(NUMBER_PROMPTS[id])),
   list(new Set(ids.filter((id) => {
      const row = NUMBER_PROMPTS[id]
      return row.max !== null && !isDeck(row) && !isLiteral(row)
   }))))
check('and the one written-down ceiling is the damage row\'s',
   ids.filter((id) => isLiteral(NUMBER_PROMPTS[id])).join(',') === 'damage',
   list(new Set(ids.filter((id) => isLiteral(NUMBER_PROMPTS[id])))))
check('and the ceiling is a whole number of cards when read',
   ids.every((id) => Number.isInteger(maxFor(id, { own: 60, theirs: 60 }))
      || maxFor(id, { own: 60, theirs: 60 }) === Infinity))
check('and a missing deck leaves a row unbounded rather than zero',
   maxFor('revealTop', {}) === Infinity && maxFor('draw', {}) === Infinity)
check('and the ceiling is never above the floor',
   ids.every((id) => maxFor(id, { own: 60, theirs: 60 }) >= NUMBER_PROMPTS[id].min),
   list(new Set(ids.filter((id) => maxFor(id, { own: 60, theirs: 60 }) < NUMBER_PROMPTS[id].min))))

/*
   Every count of cards is bounded by *a* deck - the one the gesture is about - and
   the naming is what says which. A row bounded by neither would be a count that can
   ask for more cards than exist, which is the thing this ceiling is for.
*/
check('every count of cards is bounded by a deck',
   ids.filter((id) => NUMBER_PROMPTS[id].type === 'cards').every((id) => NUMBER_PROMPTS[id].max !== null),
   list(new Set(ids.filter((id) => NUMBER_PROMPTS[id].type === 'cards' && NUMBER_PROMPTS[id].max === null))))

/* --------------------------------------------------- the call sites -- */

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
   const path = join(dir, entry)
   return statSync(path).isDirectory() ? walk(path) : (path.endsWith('.svelte') ? [ path ] : [])
})

const components = walk('src')
const source = (file) => readFileSync(file, 'utf8')

/*
   A native prompt still works and is the copy this table replaced.

   The scan is comment-aware and per line, because the word "prompt" is all over these
   files in prose (*"which every X on this board asks with the browser's own prompt"*)
   and a plain regex reports every one of those as a call - measured: two false
   positives before this was written, one of them in a comment on the same
   `board/Deck.svelte` line the table replaced.
*/
const withoutComments = (text) => text
   .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
   .replace(/\/\/[^\n]*/g, '')

const raw = []
for (const file of components) {
   withoutComments(source(file)).split('\n').forEach((line, i) => {
      /* `numberPrompt(` is the helper's own call, and a declaration names a variable */
      const call = line.match(/(?<!number)(?<!\.)\bprompt\s*\(/)
      if (!call) return
      if (/\b(let|const|var)\s+prompt\s*(=|$)/.test(line)) return
      raw.push(`${file.replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
   })
}

check('no component asks the browser for a number itself', raw.length === 0, raw.join(' | '))

/*
   Every id a component names has to exist, and every id in the table has to be named
   by something: the first is the typo this check exists for, the second is a question
   nobody asks any more, which would sit in the table looking authoritative.
*/
const used = new Set()
for (const file of components) {
   for (const m of source(file).matchAll(/numberPrompt\(\s*'([^']+)'/g)) used.add(m[1])
}

const unregistered = [ ...used ].filter((id) => !ids.includes(id))
const unasked = ids.filter((id) => !used.has(id))

check('every id a component asks for is registered', unregistered.length === 0, list(new Set(unregistered)))
check('and every registered id is asked for by a component', unasked.length === 0, list(new Set(unasked)))

/*
   A row bounded by a deck is only bounded in practice if its call site hands the deck
   over. Forgetting that is the quiet way this ceiling disappears: the helper is
   correct, the deck is sitting right there in the component, and the prompt goes back
   to accepting any number at all. So the *call* is inspected, not just the id.

   And which deck it is handed matters too. An own-deck row given the far half's deck
   would bound "Draw X" by somebody else's deck; an either-deck row - one asked on both
   halves, like *Draw X* and *Reveal Top X* - is correct with whichever deck its
   component holds, which is the whole reason that third kind exists.
*/
const DECK_ROWS = new Set([ DECK_MAX.OWN_DECK, DECK_MAX.THEIR_DECK, DECK_MAX.EITHER_DECK ])

const deckless = []
const mismatched = []

for (const file of components) {
   const where = file.replace(/\\/g, '/')

   for (const m of source(file).matchAll(/numberPrompt\(\s*'([^']+)'\s*([^\n]*)/g)) {
      const row = NUMBER_PROMPTS[m[1]]
      if (!row || !DECK_ROWS.has(row.max)) continue

      const passedOwn = /own:\s*deck\.get\(\)\.length/.test(m[2])
      const passedTheirs = /theirs:\s*deck\.get\(\)\.length/.test(m[2])

      if (!passedOwn && !passedTheirs) {
         deckless.push(`${where}: ${m[1]} asks for a deck-bounded count without passing a deck`)
         continue
      }

      if (row.max === DECK_MAX.OWN_DECK && !passedOwn) mismatched.push(`${where}: ${m[1]} wants the own deck`)
      if (row.max === DECK_MAX.THEIR_DECK && !passedTheirs) mismatched.push(`${where}: ${m[1]} wants their deck`)
   }
}

check('every deck-bounded prompt is given the deck it is bounded by', deckless.length === 0,
   deckless.join(' | '))
check('and it is the deck that row names, not the other one', mismatched.length === 0,
   mismatched.join(' | '))

/* ------------------------------------------------ the one question, twice -- */

/*
   `board/Deck.svelte` and `opponent/Deck.svelte` are the two halves of one table, and
   a gesture on both is one row here. That is the drift this whole change is about:
   *Draw X* is one row asked by two components rather than two copies of a string.
*/
const askers = {}
for (const file of components) {
   for (const m of source(file).matchAll(/numberPrompt\(\s*'([^']+)'/g)) {
      askers[m[1]] = askers[m[1]] || new Set()
      askers[m[1]].add(file.replace(/\\/g, '/'))
   }
}

const shared = Object.entries(askers).filter(([, files]) => files.size > 1)
check('a gesture on both halves asks the one row, not two copies',
   shared.some(([id]) => id === 'draw') && shared.some(([id]) => id === 'revealTop'),
   shared.map(([id, files]) => `${id} (${files.size})`).join(', ') || 'none shared')

/*
   And a row that two halves both ask cannot be pinned to one of their decks: *Draw X*
   on the far half is bounded by the far deck, or the own-deck ceiling would refuse a
   draw the far half can make. That is what `EITHER_DECK` is for, and this is the check
   that would have caught the table getting it wrong - it did, on the first run.
*/
const pinned = shared.map(([id]) => id).filter((id) => NUMBER_PROMPTS[id]
   && DECK_ROWS.has(NUMBER_PROMPTS[id].max)
   && NUMBER_PROMPTS[id].max !== DECK_MAX.EITHER_DECK)

check('and a row both halves ask is bounded by whichever deck is in hand',
   pinned.length === 0,
   pinned.map((id) => `${id} is asked on both halves but pinned to ${NUMBER_PROMPTS[id].max}`).join(' | '))

/* the two discards are deliberately two rows: each is asked of the deck its player reads */
check('and the two discards are two questions, because each names its own deck',
   ids.includes('discardTop') && ids.includes('discardTheirTop') &&
   NUMBER_PROMPTS.discardTop.question !== NUMBER_PROMPTS.discardTheirTop.question)

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - the prompts have drifted from util/prompts.js`)
   process.exit(1)
}
console.log(`verdict: ok - ${ids.length} questions asked one way, and every id a component names exists`)
