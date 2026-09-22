/*
   Do all the places that name a zone agree?

   docs/terminology.md is the table of the four vocabularies a zone is named in.
   Its last section says what is wrong with relying on it: a zone name is a
   hand-written literal in five different files, nothing compares them, and the
   document is currently the only place the five are held side by side. This is the
   check that section asks for.

   Why it matters, in one line: a zone's **store name and wire name are the same
   string**, so a rename that looks like tidying a store field is a protocol
   change - and it fails silently, because `getPile()` answers `undefined` for
   anything it does not know and `cardsMoved` opens with `if (!pile2) return`. The
   card simply does not move on the other board: nothing throws, nothing logs, and
   there is no line on screen to read. That is the failure this exists to make
   loud, and it is worth a check rather than a comment because it is invisible.

   What it derives, and from where - all read out of the real files, so none of it
   can drift from what the app runs:

     the board's piles    custom/board.js, from pile('...')
     what it publishes    exportBoard()'s own keys
     the receiver's       opponent.js's getPile() - the names it answers to
     the log's            logger.js's `piles` (what a line calls a zone) and its
                          `zones` (what is public)
     the panel's          diagnostics.js's PILES, boardZones() and ZONE_LABELS
     the slot innards     the shape slot() mints (cards.js) against the regex both
                          matchers use (logger.js and opponent.js)

   Two things it deliberately does NOT assert, because they are not true of this
   board and asserting them would be asserting a tidiness the code does not have:

     - that `logger.js`'s two maps have the same keys. `piles` also names the slot
       zones (Bench, Active), which are single slots rather than piles; `zones`
       carries a `play` rule but no `bench`/`active` rule. What has to hold is that
       everything in `piles` can be *judged* as well as named, which is asserted.
     - that the diagnostics panel counts the same set it labels. It deliberately
       counts fewer: `PILES` is the pile kinds, and `stadium` is counted beside
       them rather than in the list (it is a list of up to two, not a pile).

     node tools/zone-vocabulary-check.mjs
     node tools/zone-vocabulary-check.mjs --quiet
*/

import { readFileSync } from 'node:fs'

const quiet = process.argv.includes('--quiet')

const read = (path) => readFileSync(path, 'utf8')

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

const list = (set) => [ ...set ].sort().join(', ') || 'none'
const isSubset = (sub, superSet) => [ ...sub ].every((x) => superSet.has(x))
const same = (a, b) => a.size === b.size && isSubset(a, b)

/* `key:` lines inside a block - a map, or a returned object */
const keysIn = (block) => new Set(
   [ ...block.matchAll(/^\s*(\w+)\s*:/gm) ].map((m) => m[1])
)

/*
   The zones that are a slot rather than a pile, and the one name the log carries
   that is neither. Each is a deliberate exception, named here so that a new key
   appearing in these maps has to be looked at rather than waved through - which is
   the whole point of the check.
*/
const SLOT_ZONES = new Set(['bench', 'active'])
const LOG_ONLY = new Set(['play']) // Pokemon in play: bench + active together, no store

/* ------------------------------------------------------------ the board -- */

const boardSrc = read('src/lib/stores/custom/board.js')

/* pile('x') mints the name, and that same string is what goes on the wire */
const boardPiles = new Set([ ...boardSrc.matchAll(/= pile\('([^']+)'\)/g) ].map((m) => m[1]))

/*
   What `exportBoard()` publishes, which is the shape a receiver is handed. This is
   the return object, so its keys are one indent in from the function body - and it
   is scraped rather than listed here for the same reason as everything else: a
   zone missing from it is a zone the other board never hears about.
*/
const exportBlock = /function exportBoard \(\) \{[\s\S]*?\n   \}/.exec(boardSrc)
const returnBlock = exportBlock ? /return \{([\s\S]*?)\n      \}/.exec(exportBlock[0]) : null
const exported = returnBlock ? keysIn(returnBlock[1]) : new Set()

check('the board creates some piles', boardPiles.size > 0, list(boardPiles))
check('and publishes every one of them', isSubset(boardPiles, exported),
   `not published: ${list(new Set([ ...boardPiles ].filter((n) => !exported.has(n))))}`)

/* `pickup` is the one published name with no cell - it is state, not furniture */
check('and the panel\'s own extras are the slot state it counts',
   isSubset(new Set(['active', 'bench']), exported),
   'boardZones() counts these beside the piles')

/* the slot's three lists, named `${id}.pokemon` and friends from slot() */
const cardsSrc = read('src/lib/stores/custom/cards.js')
const mintedSlotNames = [ ...cardsSrc.matchAll(/pile\(`\$\{sid\}\.(\w+)`\)/g) ].map((m) => m[1])
check('slot() mints its sub-pile names', mintedSlotNames.length > 0, mintedSlotNames.join(', '))

/* --------------------------------------------------------- the receiver -- */

const opponentSrc = read('src/lib/stores/opponent.js')

const getPileBlock = /function getPile \(name\) \{[\s\S]*?\n   \}/.exec(opponentSrc)
const getPileNames = new Set(getPileBlock
   ? [ ...getPileBlock[0].matchAll(/name === '(\w+)'/g) ].map((m) => m[1])
   : [])

check('the receiver resolves every board zone', same(boardPiles, getPileNames),
   `board: ${list(boardPiles)} | getPile: ${list(getPileNames)}`)

/*
   And so does the request in the other direction. `oppAction.js` reads the same
   table the other way round - it is what turns an action's zone name back into a
   pile on the board that owns the card - so a name it does not know is a card that
   does not move, silently, exactly as `getPile` failing does.

   One name is deliberately missing from it, and the check is written as a subset
   rather than an equality so that the exception is stated here rather than
   implied: `pickup` is the phase cards wait in while a multi-card selection is
   resolved (see terminology.md), so a card is never *moved to* it by an action and
   there is nothing for the request to name. Everything else has to be there.
*/
const oppActionSrc = read('src/lib/stores/oppAction.js')
const oppPileBlock = /function oppPile \(name\) \{[\s\S]*?\n\}/.exec(oppActionSrc)
const oppPileNames = oppPileBlock ? keysIn(oppPileBlock[0]) : new Set()
const ACTION_SKIPS = new Set(['pickup'])

check('and the action request knows every zone a card can be moved to',
   isSubset(new Set([ ...getPileNames ].filter((n) => !ACTION_SKIPS.has(n))), oppPileNames),
   `missing: ${list(new Set([ ...getPileNames ].filter((n) => !ACTION_SKIPS.has(n) && !oppPileNames.has(n))))}`)
check('and names nothing the receiver does not resolve',
   isSubset(oppPileNames, getPileNames),
   `not a zone: ${list(new Set([ ...oppPileNames ].filter((n) => !getPileNames.has(n))))}`)

/* both ends must agree on the shape of a slot's sub-pile name */
const opponentSlotRegex = /const slotRegex = (\/.*?\/[a-z]*)/.exec(opponentSrc)
const loggerSrc = read('src/lib/stores/logger.js')
const loggerSlotRegex = /const slotRegex = (\/.*?\/[a-z]*)/.exec(loggerSrc)

check('both matchers use the same slot-name shape',
   Boolean(opponentSlotRegex) && Boolean(loggerSlotRegex) &&
   opponentSlotRegex[1] === loggerSlotRegex[1],
   opponentSlotRegex && loggerSlotRegex && opponentSlotRegex[1] !== loggerSlotRegex[1]
      ? `opponent ${opponentSlotRegex[1]} vs logger ${loggerSlotRegex[1]}`
      : '')

/*
   And that shape has to match what slot() mints. A regex that stopped matching
   would make every move of a Pokemon's own cards read as private in the log.
*/
if (loggerSlotRegex) {
   const re = new RegExp(loggerSlotRegex[1].slice(1, loggerSlotRegex[1].lastIndexOf('/')),
      loggerSlotRegex[1].slice(loggerSlotRegex[1].lastIndexOf('/') + 1))
   const id = '01234567-89ab-cdef-0123-456789abcdef'

   check('and it matches every name slot() mints',
      mintedSlotNames.every((part) => re.test(`${id}.${part}`)),
      mintedSlotNames.map((p) => `${id}.${p}`).join(', '))
   check('and it refuses a name that is not a slot',
      !re.test('deck') && !re.test(`${id}.damage`), 'deck, <id>.damage')
}

/* ------------------------------------------------------------- the log -- */

const pilesBlock = /const piles = \{([\s\S]*?)\n\}/.exec(loggerSrc)
const zonesBlock = /const zones = \{([\s\S]*?)\n   \}/.exec(loggerSrc)

const loggerPiles = pilesBlock ? keysIn(pilesBlock[1]) : new Set()
const loggerZones = zonesBlock ? keysIn(zonesBlock[1]) : new Set()

check('the log knows every board zone',
   isSubset(boardPiles, loggerPiles),
   `missing: ${list(new Set([ ...boardPiles ].filter((n) => !loggerPiles.has(n))))}`)

/*
   The requirement that matters: `pileName` decides what a line *calls* a zone and
   `isPublicMove` decides whether it may *name* the cards in it. A key the log can
   name but not judge falls through to the slot regex and is treated as private,
   so a line starts counting cards it should have named - or the reverse.
*/
check('and can judge every zone it names',
   isSubset(loggerPiles, loggerZones),
   `named but not judged: ${list(new Set([ ...loggerPiles ].filter((n) => !loggerZones.has(n))))}`)

/* everything left over is a slot zone or the one deliberate log-only name */
const unexplained = new Set([ ...loggerPiles ]
   .filter((name) => !boardPiles.has(name) && !SLOT_ZONES.has(name) && !LOG_ONLY.has(name)))
check('and answers to nothing else', unexplained.size === 0, list(unexplained))

/*
   `play` is the homonym: a log key meaning Pokemon-in-play, and a grid area
   meaning the table's cell. Both uses are deliberate and neither may quietly go.
*/
check('the log\'s Pokemon-in-play key is still `play`',
   LOG_ONLY.has('play') && loggerPiles.has('play') && loggerZones.has('play'),
   'renaming it changes whether a log line counts cards or names them')

const boardSvelte = read('src/lib/play/Board.svelte')
check('and `play` is still the table\'s grid area, shared by both halves',
   /(^|\s)\.play\s*\{[^}]*grid-area:\s*play/.test(boardSvelte) &&
   /(^|\s)\.play2\s*\{[^}]*grid-area:\s*play/.test(boardSvelte),
   'the two tables are placed in the one cell')

/* ------------------------------------------------------- the diagnostics -- */

const diagSrc = read('src/lib/stores/diagnostics.js')

const pilesList = /const PILES = \[([^\]]+)\]/.exec(diagSrc)
const diagPiles = new Set(pilesList ? [ ...pilesList[1].matchAll(/'(\w+)'/g) ].map((m) => m[1]) : [])

check('the panel counts the board\'s pile kinds', same(boardPiles, new Set([ ...diagPiles, 'stadium' ])),
   `board: ${list(boardPiles)} | panel PILES + stadium: ${list(new Set([ ...diagPiles, 'stadium' ]))}`)

/* the labels are the full set of what boardZones() returns, minus the total */
/* the labels are pairs - ['key', 'words'] - so the key is the first literal */
const labelsBlock = /export const ZONE_LABELS = \[([\s\S]*?)\n\]/.exec(diagSrc)
const diagLabels = labelsBlock
   ? new Set([ ...labelsBlock[1].matchAll(/\[\s*'(\w+)'\s*,/g) ].map((m) => m[1]))
   : new Set()

check('and labels every zone it counts',
   isSubset(new Set([ 'active', 'bench', 'stadium' ]), diagLabels) && isSubset(diagPiles, diagLabels),
   `labels: ${list(diagLabels)}`)

const emptyLabels = labelsBlock
   ? [ ...labelsBlock[1].matchAll(/\[\s*'(\w+)'\s*,\s*''\s*\]/g) ].map((m) => m[1])
   : []
check('and every label has words in it', emptyLabels.length === 0, emptyLabels.join(', '))

/* ------------------------------------------------------------- the docs -- */

const doc = read('docs/terminology.md')
const unlisted = [ ...boardPiles ].filter((name) => !doc.includes(`\`${name}\``))
check('and the terminology table still lists every board zone', unlisted.length === 0,
   unlisted.join(', '))

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - a zone is named differently in two of the five places,`)
   console.log('and the receiver fails silently: getPile() answers undefined and the card does not move')
   process.exit(1)
}
console.log('verdict: ok - every vocabulary agrees, and each extra name is one that is allowed')
