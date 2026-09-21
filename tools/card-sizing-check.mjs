/*
   Is every card on the board still the size of the zone it is in - and is that
   said in one place instead of nine?

   This exists because of a specific, repeated bug: every zone sized its own cards.
   Nine components carried a verbatim copy of the same `img.card` width, two benches
   a verbatim copy of the same `--slot-card-width`, and each copy was written with a
   comment pointing at another copy. The card-sizing PRs are the ledger - #109 and
   #110 for the prizes and the bench, #117 to #122 for the prizes again, the bench's
   centring, an attached card cut off at the row's top, a slot's cards, and the
   bench's scroll - and every one of those five sizes was got wrong in a copy
   rather than in the rule. A rule in nine places is nine rules.

   The size is now written down once, as `:where(.zone-card).card` in global.css,
   and the cards in zones wear the class. Two neighbours of that rule look like it
   and are not, which is what most of this file is about:

     * the table's stack is NOT a zone-sized card - its cards are read by looking at
       them rather than by fitting - so it must not wear the class, and
     * `--card-width` on `.game` is what a card keeps where no zone sized it (the
       stack, and a slot's fallback), so it must stay a fixed length there. A `min()`
       with `cqw` in it would be inherited unresolved and resolved against every
       card's own zone, which is the stack quietly resizing - the reason this is a
       rule at the card rather than a value on the board.

   What this checks, in the order it matters:

     1. global.css still holds the one rule, and still at `.card` specificity so a
        zone that means to redirect its own cards can
     2. every pile's own front wears the class
     3. the table's stack does not, and the board's `--card-width` is still fixed
     4. no zone component has gone back to writing the formula itself
     5. the bench's size is one formula in global.css and both benches point at it
     6. the active spot keeps its own, because it is not the bench's rule

   Read-only, and no browser: this is the half of verification a confined session
   keeps (see docs/gotchas.md on what cannot be rendered). It cannot tell you a card
   *looks* right - only a renderer can - but it can tell you that the rule deciding
   it is stated once, which is the half that kept being got wrong.

     node tools/card-sizing-check.mjs
     node tools/card-sizing-check.mjs --quiet
*/

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const quiet = process.argv.includes('--quiet')

const ZONE_DIRS = ['src/lib/play/board', 'src/lib/play/opponent']

const squash = (s) => s.replace(/\s+/g, '')
const CARD_WIDTH_FORMULA = squash('calc(100cqw - 2 * var(--card-gap))')
const SLOT_WIDTH_FORMULA = squash('100cqh - 2 * var(--card-gap) - var(--scrollbar)')

const read = (path) => readFileSync(path, 'utf8')

const board = read('src/lib/play/Board.svelte')
const globalCss = read('src/global.css')

/*
   Comments out, because these files quote their own rules in prose - global.css says
   "the `:where(.zone-card).card` rule" twice in the notes over it, and a check that
   counted those would be counting the documentation of the rule rather than the
   rule. Everything below reads the code with the commentary removed.
*/
const uncomment = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const globalCode = uncomment(globalCss)
const boardCode = uncomment(board)

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* --- 1. the one rule ------------------------------------------------------- */

/*
   `:where(.zone-card).card` and not `.zone-card` or `.game img.card`: the class has
   to be at no specificity for the hand's row to be able to redirect it (see the
   note over the rule), and `.zone-card` alone would not out-rank the `img.card`
   rule it has to beat.
*/
const zoneRule = /:where\(\.zone-card\)\.card\s*\{([^}]*)\}/.exec(globalCode)
check('global.css holds the board card\'s size, once',
   (globalCode.match(/:where\(\.zone-card\)\.card/g) || []).length === 1)
check('and it is still the zone-sized card',
   Boolean(zoneRule) && squash(zoneRule[1]).includes(CARD_WIDTH_FORMULA) && /--card-ratio/.test(zoneRule[1]))

check('global.css still holds --card-ratio', /--card-ratio:\s*[\d.]+/.test(globalCode))
check('global.css still holds --card-gap', /--card-gap:\s*[\d.]+/.test(globalCode))

/* --- 2 and 3. who wears the class ------------------------------------------ */

const zoneFiles = []
for (const dir of ZONE_DIRS) {
   for (const name of readdirSync(dir)) {
      if (name.endsWith('.svelte')) zoneFiles.push({ path: join(dir, name), source: read(join(dir, name)) })
   }
}

/*
   A pile's own front: exactly one image per pile component, the thing the zone
   draws. Each of these files is a pile - the check would rather name them than
   guess, because "which images should wear this" is the whole question.
*/
const PILE_FRONTS = ['Deck.svelte', 'Discard.svelte', 'LostZone.svelte']
const wrongFronts = []
const missingClass = []

for (const file of zoneFiles) {
   const name = file.path.split(/[\\/]/).pop()
   if (!PILE_FRONTS.includes(name)) continue

   /* the zone's front is the image inside the pile body, which is the first one */
   const images = [ ...file.source.matchAll(/<img\b[^>]*>/g) ].map((m) => m[0])
   const front = images[0] || ''
   const wears = /class="card zone-card"/.test(front)

   if (!wears) missingClass.push(file.path)
   if (images.length > 1) wrongFronts.push(`${file.path} (${images.length} images)`)
}

check(`every pile front wears .zone-card (${PILE_FRONTS.length} per half)`, missingClass.length === 0,
   missingClass.join(', '))
check('and a pile front is the only image in its component', wrongFronts.length === 0,
   wrongFronts.join(', '))

/*
   The two things that must NOT be zone-sized cards, and each is a real regression
   this check is for: the table's stack, and the board's fixed fallback.
*/
for (const table of zoneFiles.filter((f) => /[\\/]Temp\.svelte$/.test(f.path))) {
   const images = [ ...table.source.matchAll(/<img\b[^>]*>/g) ].map((m) => m[0])
   const wearing = images.filter((i) => /zone-card/.test(i))
   check(`the table's stack keeps its own size (${table.path})`, wearing.length === 0,
      `${wearing.length} of ${images.length} images wear .zone-card`)
}

const gameBlock = /\.game\s*\{([\s\S]*?)\n\s*\}/.exec(boardCode)
check('the board\'s --card-width is still a fixed size',
   Boolean(gameBlock) && /--card-width:\s*[\d.]+px/.test(gameBlock[1]),
   gameBlock && /--card-width:\s*([^;]+)/.test(gameBlock[1]) ? RegExp.$1.trim() : 'no --card-width on .game')
check('and the board does not size a zone\'s cards from .game',
   !/--card-width:\s*min\(/.test(gameBlock ? gameBlock[1] : ''))

/* --- 4. no zone has gone back to writing the formula ----------------------- */

/*
   The two active spots are the one place that still writes the card's formula out,
   and deliberately: the active spot is not the bench's rule (see below), so it asks
   for the zone's width and a fan's share of its height itself, and the same
   expression in both halves is the two halves being one rule. Everything else
   asking for a card's width is the duplication this tool exists for.
*/
const SANCTIONED = [/[\\/]Active\.svelte$/]

const sanctioned = zoneFiles.filter((f) => SANCTIONED.some((re) => re.test(f.path)))
const claimants = []
for (const file of zoneFiles) {
   if (SANCTIONED.some((re) => re.test(file.path))) continue

   const flat = squash(file.source)
   if (flat.includes(CARD_WIDTH_FORMULA)) claimants.push(`${file.path} (a copy of the card's width)`)
   if (/--card-width:\s*min\(/.test(file.source)) claimants.push(`${file.path} (--card-width of its own)`)
}

check(`no zone component re-declares the card's width (${zoneFiles.length - sanctioned.length} files)`,
   claimants.length === 0, claimants.join(', '))

/* --- 5. the bench's size is one formula, and both benches point at it ------ */

const benchVars = [ ...globalCode.matchAll(/--bench-card-width:\s*([^;]+);/g) ]
check('global.css declares --bench-card-width once', benchVars.length === 1, `${benchVars.length} declarations`)
check('and it still spends the fan\'s share and the scrollbar',
   benchVars.length === 1 && squash(benchVars[0][1]).includes(SLOT_WIDTH_FORMULA) &&
   /--slot-card-share/.test(benchVars[0][1]) && /--card-ratio/.test(benchVars[0][1]))

const benches = zoneFiles.filter((f) => /[\\/]Bench\.svelte$/.test(f.path))
const benchPoints = benches.filter((f) => /--slot-card-width:\s*var\(--bench-card-width\)/.test(f.source))
check('both benches take their size from it', benches.length === 2 && benchPoints.length === 2,
   `${benchPoints.length} of ${benches.length} benches`)

const benchCopies = zoneFiles.filter((f) => squash(f.source).includes(SLOT_WIDTH_FORMULA))
check('and no component writes the bench formula out', benchCopies.length === 0,
   benchCopies.map((f) => f.path).join(', '))

/* --- 6. the active spot keeps its own, because it is not the same rule ----- */

const activeFiles = zoneFiles.filter((f) => /[\\/]Active\.svelte$/.test(f.path))
const activeOwn = activeFiles.filter((f) => /--slot-card-width:\s*min\(/.test(f.source))
check('both active spots ask for their own slot width',
   activeFiles.length === 2 && activeOwn.length === 2, `${activeOwn.length} of ${activeFiles.length}`)

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - a card's size is being decided in more than one place`)
   process.exit(1)
}
console.log('verdict: ok - the board sizes every card once, and no zone has taken a copy of it')
