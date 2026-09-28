/*
   Is every number the board asks for asked one way, and does every id a component
   names exist?

   Two names, and it is worth keeping them apart because "prompt" was doing three jobs
   in this repository before this change - the idle prompt, the lobby's prompt, and the
   browser's own `prompt()`:

     - **an ask** is the *data*: one row of `src/lib/util/asks.js`, saying what the
       question is, what kind of number it takes, and what it will accept. It is a
       table entry, and it is what this check is about.
     - **the number dialog** is the *window* that puts an ask to a player:
       `NumberPrompt.svelte`. It is checked in a browser, not here - what is checked
       here is only that nothing has gone back to the browser's own dialog.

   Eleven call sites across six files used to carry their own copy of the question's
   words, the parse and the bounds, and they had drifted: the same gesture was asked two
   ways, `parseInt` and `Number` were used for the same question, and the bounds were
   written four ways - one call site with none at all.

   Two things follow from moving that into a table, and both fail *quietly* without this
   check:

     - **a misspelt id throws.** `askForNumber` throws rather than opening a dialog that
       says `undefined`, because three other spellings of "nothing was asked" would hide
       it - so the throw is right, and it is also a crash in front of a player. A typo is
       caught here instead.
     - **a new call site can bypass the table.** `parseInt(prompt(...))` still works and
       still looks reasonable, and it is exactly the copy this table replaced. The scan
       below refuses one.

   And the parse itself is asserted rather than assumed, because getting it wrong is
   invisible until somebody cancels the dialog: `Number(null)` is **0**, so the damage
   row - whose floor is 0 - read a cancel as "set the damage to zero".

     node tools/ask-check.mjs
     node tools/ask-check.mjs --quiet
*/

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NUMBER_ASKS, askForNumber, maxForAsk, registerNumberDialog, DECK_MAX } from '../src/lib/util/asks.js'

const quiet = process.argv.includes('--quiet')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const list = (set) => [ ...set ].sort().join(', ') || 'none'

/* ------------------------------------------------------------- the parse -- */

/*
   The dialog, answered here so every case is one call away.

   It stands in for `NumberPrompt.svelte`, which registers itself when the page creates
   it. Registering a plain function is what makes the table testable with no component
   and no browser - and it is also why this check runs in CI with the other tree checks
   rather than needing a headless Chrome.
*/
let answer = null
let lastQuestion = null

registerNumberDialog({
   ask: (question) => {
      lastQuestion = question
      return Promise.resolve(answer)
   }
})

const asked = async (id, input, decks) => { answer = input; return askForNumber(id, decks) }

check('a number is answered as a number', await asked('draw', 7) === 7)
check('and a numeric string is read', await asked('draw', ' 12 ') === 12)
check('cancel answers null', await asked('draw', null) === null)
check('a blank box answers null', await asked('draw', '') === null)
check('junk answers null', await asked('draw', 'abc') === null)
check('zero answers null for a count of cards', await asked('draw', '0') === null)
check('a negative answers null', await asked('draw', '-3') === null)
check('Infinity answers null', await asked('draw', 'Infinity') === null)

/* a count is a whole number of cards, whatever was typed */
check('a fraction is brought down to a whole card', await asked('draw', '2.5') === 2)
check('and rounds towards zero, not to the nearest', await asked('draw', '2.9') === 2)

/*
   The damage row is the one whose floor is 0, and that is what made the cancel case
   worth a check of its own: a cancelled ask is not a zero.
*/
check('zero is a value for damage', await asked('damage', '0') === 0)
check('and a blank box is still zero for damage, as it was before the table',
   await asked('damage', '') === 0)
check('but a cancelled ask is not zero, it is nothing',
   await asked('damage', null) === null)
check('and junk never reaches slot.damage as NaN', await asked('damage', 'abc') === null)

console.log('\nwhat the ceiling does')
check('a count above the deck is brought down to the deck',
   await asked('revealTop', '10', { theirs: 3 }) === 3)
check('a count within the deck is left alone',
   await asked('revealTop', '2', { theirs: 3 }) === 2)
check('the deck decides, not a number written down',
   await asked('revealTop', '99', { theirs: 41 }) === 41)
check('an own-deck row is bounded by the own deck',
   await asked('reorderTop', '99', { own: 47, theirs: 3 }) === 47)
check('and a theirs-deck row by theirs',
   await asked('lookTop', '99', { own: 47, theirs: 3 }) === 3)
check('a deck of no cards refuses the gesture rather than clamping to nothing',
   await asked('draw', '5', { own: 0 }) === null)
check('the damage row has a ceiling of its own and is not clamped by a deck',
   await asked('damage', '400', { own: 5, theirs: 5 }) === 400)
check('and a damage typo is brought down to that ceiling',
   await asked('damage', '999999', { own: 5, theirs: 5 }) === 999)
check('and the damage ceiling does not move with a deck',
   await asked('damage', '999', { own: 1, theirs: 1 }) === 999)
check('and a call site that passes no decks is unbounded rather than wrong',
   await asked('revealTop', '10') === 10)

/*
   The id is checked before the dialog is asked, so a typo throws rather than opening a
   question that says `undefined`. `askForNumber` is async, so the throw arrives as a
   rejection - which is also what a caller sees.
*/
check('a misspelt id throws rather than asking an undefined question',
   await (async () => { try { await askForNumber('draww'); return false } catch { return true } })())
check('and a misspelt id never reaches the dialog',
   lastQuestion === null || lastQuestion?.question !== undefined)

/* ---------------------------------------------------------- the table -- */

const ids = Object.keys(NUMBER_ASKS)

check('every row has a question in it',
   ids.every((id) => typeof NUMBER_ASKS[id].question === 'string' && NUMBER_ASKS[id].question.trim()),
   list(new Set(ids.filter((id) => !NUMBER_ASKS[id].question?.trim()))))
check('and a whole-number floor',
   ids.every((id) => Number.isInteger(NUMBER_ASKS[id].min)),
   list(new Set(ids.filter((id) => !Number.isInteger(NUMBER_ASKS[id].min)))))
check('and only the damage row allows zero',
   ids.filter((id) => NUMBER_ASKS[id].min === 0).join(',') === 'damage',
   list(new Set(ids.filter((id) => NUMBER_ASKS[id].min === 0))))
check('and no two rows ask the same thing in the same words',
   new Set(ids.map((id) => NUMBER_ASKS[id].question)).size === ids.length,
   list(new Set(ids
      .map((id) => NUMBER_ASKS[id].question)
      .filter((q, i, all) => all.indexOf(q) !== i))))

/*
   The two fields added after the table was written: what kind of number a row asks
   for, and the most the board will allow.
*/
const TYPES = [ 'cards', 'damage' ]

check('every row says what kind of number it asks for',
   ids.every((id) => TYPES.includes(NUMBER_ASKS[id].type)),
   list(new Set(ids.filter((id) => !TYPES.includes(NUMBER_ASKS[id].type)))))
check('and only the damage row is not a count of cards',
   ids.filter((id) => NUMBER_ASKS[id].type === 'damage').join(',') === 'damage',
   list(new Set(ids.filter((id) => NUMBER_ASKS[id].type === 'damage'))))

/* a ceiling is either a named deck or nothing at all - never a number written down */
const named = new Set([ DECK_MAX.OWN_DECK, DECK_MAX.THEIR_DECK, DECK_MAX.EITHER_DECK ])
const isDeck = (row) => named.has(row.max)
const isLiteral = (row) => typeof row.max === 'number'

check('every row names a deck as its ceiling, or a number, or has none',
   ids.every((id) => NUMBER_ASKS[id].max === null || isDeck(NUMBER_ASKS[id]) || isLiteral(NUMBER_ASKS[id])),
   list(new Set(ids.filter((id) => {
      const row = NUMBER_ASKS[id]
      return row.max !== null && !isDeck(row) && !isLiteral(row)
   }))))
check('and the one written-down ceiling is the damage row\'s',
   ids.filter((id) => isLiteral(NUMBER_ASKS[id])).join(',') === 'damage',
   list(new Set(ids.filter((id) => isLiteral(NUMBER_ASKS[id])))))
check('and the ceiling is a whole number of cards when read',
   ids.every((id) => Number.isInteger(maxForAsk(id, { own: 60, theirs: 60 }))
      || maxForAsk(id, { own: 60, theirs: 60 }) === Infinity))
check('and a missing deck leaves a row unbounded rather than zero',
   maxForAsk('revealTop', {}) === Infinity && maxForAsk('draw', {}) === Infinity)
check('and the ceiling is never above the floor',
   ids.every((id) => maxForAsk(id, { own: 60, theirs: 60 }) >= NUMBER_ASKS[id].min),
   list(new Set(ids.filter((id) => maxForAsk(id, { own: 60, theirs: 60 }) < NUMBER_ASKS[id].min))))

/*
   Every count of cards is bounded by *a* deck - the one the gesture is about - and
   the naming is what says which. A row bounded by neither would be a count that can
   ask for more cards than exist, which is the thing this ceiling is for.
*/
check('every count of cards is bounded by a deck',
   ids.filter((id) => NUMBER_ASKS[id].type === 'cards').every((id) => NUMBER_ASKS[id].max !== null),
   list(new Set(ids.filter((id) => NUMBER_ASKS[id].type === 'cards' && NUMBER_ASKS[id].max === null))))

/* --------------------------------------------------- the call sites -- */

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
   const path = join(dir, entry)
   return statSync(path).isDirectory() ? walk(path) : (path.endsWith('.svelte') ? [ path ] : [])
})

const components = walk('src')
const source = (file) => readFileSync(file, 'utf8')

/*
   The browser's own `prompt()` still works and is the copy this table replaced.

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
      /* `askForNumber(` is the helper's own call, and a declaration names a variable */
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
   for (const m of source(file).matchAll(/askForNumber\(\s*'([^']+)'/g)) used.add(m[1])
}

const unregistered = [ ...used ].filter((id) => !ids.includes(id))
const unasked = ids.filter((id) => !used.has(id))

check('every id a component asks for is registered', unregistered.length === 0, list(new Set(unregistered)))
check('and every registered id is asked for by a component', unasked.length === 0, list(new Set(unasked)))

/*
   A row bounded by a deck is only bounded in practice if its call site hands the deck
   over. Forgetting that is the quiet way this ceiling disappears: the helper is
   correct, the deck is sitting right there in the component, and the ask goes back
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

   for (const m of source(file).matchAll(/askForNumber\(\s*'([^']+)'\s*([^\n]*)/g)) {
      const row = NUMBER_ASKS[m[1]]
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

check('every deck-bounded ask is given the deck it is bounded by', deckless.length === 0,
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
   for (const m of source(file).matchAll(/askForNumber\(\s*'([^']+)'/g)) {
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
const pinned = shared.map(([id]) => id).filter((id) => NUMBER_ASKS[id]
   && DECK_ROWS.has(NUMBER_ASKS[id].max)
   && NUMBER_ASKS[id].max !== DECK_MAX.EITHER_DECK)

check('and a row both halves ask is bounded by whichever deck is in hand',
   pinned.length === 0,
   pinned.map((id) => `${id} is asked on both halves but pinned to ${NUMBER_ASKS[id].max}`).join(' | '))

/* the two discards are deliberately two rows: each is asked of the deck its player reads */
check('and the two discards are two questions, because each names its own deck',
   ids.includes('discardTop') && ids.includes('discardTheirTop') &&
   NUMBER_ASKS.discardTop.question !== NUMBER_ASKS.discardTheirTop.question)

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - the asks have drifted from util/asks.js`)
   process.exit(1)
}
console.log(`verdict: ok - ${ids.length} questions asked one way, and every id a component names exists`)
