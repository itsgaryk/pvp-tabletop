/*
   Does the board still render at all?

   This exists because of a real regression that nothing in this repository could
   have caught. A one-line change to Board.svelte - naming the far half's flip state
   and writing `class:upright={$topUpright}` for a plain value rather than a store -
   made the board throw `TypeError: store.subscribe is not a function` on mount.
   `npm run build` was green, every tool was green, and the app was dead: clicking
   Play Solo left the main menu on screen, because the board it mounts never
   rendered. The one thing that would have caught it is a renderer, and
   docs/gotchas.md is a long account of why a confined session has none.

   It does not need a *browser* to catch that, though. Svelte compiles each
   component to a `render()` function for the server, and calling it executes the
   whole tree - every `$:` statement, every template expression - so the same throw
   happens here, in node, in a second. That is what this does: it compiles the real
   components and renders the app in the states a person actually reaches.

   What it is not: a browser check. It renders to a string, so it says nothing about
   CSS, layout, or anything a click does. It answers one question - does the tree
   render, in each of the states below - and answers it where no browser is needed.

   The states are the ones that exist: the main menu (no room, no solo), the board
   in solo (the path that broke), and the sidebar in solo. A room is reached through
   the relay and needs a store, so it is not one of them; the board that renders in
   solo is the same component a room renders.

     node tools/render-check.mjs
     node tools/render-check.mjs --quiet
*/

import { build } from 'esbuild'
import { compile } from 'svelte/compiler'
import { get } from 'svelte/store'
import { pathToFileURL } from 'node:url'
import { join, sep } from 'node:path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const quiet = process.argv.includes('--quiet')

const root = process.cwd()
const src = join(root, 'src')

/*
   Everything compiled goes under `node_modules/.cache` rather than into the tree,
   and every exit path removes it: this runs in CI on a checkout, and a stray
   directory of compiled components is not something a render check should leave
   behind. It cannot go to the OS temp directory, which is where it started: the
   bundle keeps `svelte` external and imports it at run time, and node resolves that
   from the *bundle's* directory - so a bundle outside the project cannot find the
   project's `svelte`.
*/
const work = join(root, 'node_modules', '.cache', `pvp-render-check-${process.pid}`)
mkdirSync(work, { recursive: true })
const cleanup = () => rmSync(work, { recursive: true, force: true })
process.on('exit', cleanup)

const p = (...parts) => join(src, ...parts).replace(/\\/g, '/')

/*
   The two things SvelteKit provides that a bare esbuild does not: the `$lib` alias,
   and `$app/environment`. The latter is answered as a browserless build, which is
   what this is - `storable.js` reads it to decide whether to touch localStorage.
*/
const shimEnv = join(work, 'app-env.js')
writeFileSync(shimEnv, 'export const browser = false\nexport const dev = false\nexport const building = false\n')

const buildId = Date.now()
const entry = join(work, `entry-${buildId}.js`)
const outfile = join(work, `bundle-${buildId}.mjs`)

/*
   `InspectionView` is `tools/pile-dialog.svelte`: the pile inspection dialog in
   the one state a render can reach, since a panel that has not been opened draws
   nothing at all. It is a file in the tree rather than a string written here so
   that it can be read as a component like any other.
*/
writeFileSync(entry, `
   import { solo, startSolo, exitSolo } from '${p('lib/stores/solo.js')}'
   import { room, chat } from '${p('lib/stores/connection.js')}'
   import { defaultOpponent } from '${p('lib/stores/opponent.js')}'
   import Board from '${p('lib/play/Board.svelte')}'
   import Connection from '${p('routes/Connection.svelte')}'
   import Page from '${p('routes/+page.svelte')}'
   import { cards, cardSelection, deck, discard, bench, draw, hand, lz, moveSelection, resetBoard, resetSelection, attachSelection, selectCard, selectPile, shuffleAfterLeavingDeck, stadium, table, toBench, cardPile } from '${p('lib/stores/player.js')}'
   import { slot } from '${p('lib/stores/custom/cards.js')}'
   import { reveal, look, isActionable, canReveal, topCount, revealTop, lookTop, resetRevealState } from '${p('lib/stores/reveal.js')}'
   import { OPP_ACTIONS, opponentCardAction, respondToOpponentCardAction } from '${p('lib/stores/oppAction.js')}'
   import InspectionView from '${join(root, 'tools', 'pile-dialog.svelte').split(sep).join('/')}'
   import RevealDialog from '${p('lib/play/dialogs/Reveal.svelte')}'
   import LookDialog from '${p('lib/play/dialogs/Look.svelte')}'
   /* what a decklist import does: the list of cards, then the board built from it */
   const setDeck = (cards_) => { cards.set(cards_); resetBoard() }
   export { solo, startSolo, exitSolo, room, chat, Board, Connection, Page, bench, cardSelection, cardPile, canReveal, deck, defaultOpponent, discard, draw, hand, isActionable, look, LookDialog, lookTop, lz, moveSelection, OPP_ACTIONS, opponentCardAction, resetRevealState, resetSelection, respondToOpponentCardAction, reveal, RevealDialog, revealTop, selectCard, setDeck, shuffleAfterLeavingDeck, slot, stadium, table, toBench, topCount, attachSelection, selectPile, InspectionView }
`)

const svelte = {
   name: 'svelte',
   setup (b) {
      b.onResolve({ filter: /^\$lib\// }, (args) => ({ path: join(src, 'lib', args.path.slice('$lib/'.length)) }))
      b.onResolve({ filter: /^\$app\/environment$/ }, () => ({ path: shimEnv }))
      b.onLoad({ filter: /\.svelte$/ }, (args) => {
         const source = readFileSync(args.path, 'utf8')
         /* server output: `render()` is the whole component, and no DOM is needed */
         const { js } = compile(source, { filename: args.path, generate: 'ssr', css: 'external' })
         return { contents: js.code, loader: 'js', resolveDir: join(args.path, '..') }
      })
   }
}

await build({
   entryPoints: [entry],
   outfile,
   bundle: true,
   format: 'esm',
   platform: 'node',
   plugins: [svelte],
   external: ['svelte', 'svelte/*'],
   /* the cardback and the logo are imported as URLs; nothing here draws them */
   loader: { '.png': 'dataurl', '.webp': 'dataurl' },
   /* what Vite inlines, with nothing configured - the defaults env.js falls back to */
   define: {
      'import.meta.env.VITE_PVP_SERVER': '""',
      'import.meta.env.VITE_LIMITLESS_WEB': '""',
      'import.meta.env.VITE_ENV': '""',
      'import.meta.env.DEV': 'false'
   },
   logLevel: 'error'
})

/*
   The browser globals the stores read at import time. A server build is allowed to
   see none of them, which is the point of rendering this way: anything that *needs*
   one at module scope is a bug this finds rather than hides.
*/
globalThis.window = undefined
globalThis.document = undefined
globalThis.localStorage = {
   store: new Map(),
   getItem (k) { return this.store.has(k) ? this.store.get(k) : null },
   setItem (k, v) { this.store.set(k, String(v)) },
   removeItem (k) { this.store.delete(k) }
}
/* no network: a relay request must not be part of a render */
globalThis.fetch = async () => { throw new Error('no network during a render check') }

const mod = await import(pathToFileURL(outfile).href)

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/* every `$:` and every template expression runs here; a throw is the whole check */
function renders (label, Component, { props = {}, context = undefined } = {}) {
   try {
      const out = Component.render(props, { context })
      const html = out?.html ?? ''
      check(label, html.length > 0, `${html.length} chars`)
      return html
   } catch (err) {
      check(label, false, `${err.name}: ${err.message}`)
      if (!quiet) {
         console.log(err.stack.split('\n').slice(1, 6).map((l) => `          ${l.trim()}`).join('\n'))
      }
      return null
   }
}

/*
   The states a person reaches, in the order they reach them.
*/
const menu = renders('the main menu renders', mod.Page)
check('and it is the menu (no board, no room)', Boolean(menu) && !/class="game/.test(menu))

/* starting solo is the path that broke: it is what mounts the board */
function beginSolo () {
   try {
      mod.startSolo()
      return true
   } catch (err) {
      check('startSolo() does not throw', false, `${err.name}: ${err.message}`)
      return false
   }
}

check('startSolo() does not throw', beginSolo())
check('and it puts the app in solo', get(mod.solo) === true, `solo = ${get(mod.solo)}`)

const solo = renders('the board renders in solo', mod.Page)
renders('the board component renders on its own', mod.Board)
renders('the sidebar renders in solo', mod.Connection)

check('and the board is actually on the page', Boolean(solo) && /class="game/.test(solo))

mod.setDeck([
   { name: 'Pikachu', set: 'sv1', number: '1', count: 4, ptcgApiCode: 'sv1' },
   { name: 'Boss\u2019s Orders', set: 'sv1', number: '2', count: 4, ptcgApiCode: 'sv1' },
   { name: 'Ultra Ball', set: 'sv1', number: '3', count: 4, ptcgApiCode: 'sv1' }
])
mod.draw(6)
check('and dealing gives the inspection a pile to read', get(mod.hand).length === 6, `${get(mod.hand).length} in hand`)
/*
   The pile inspection, which is the board's one dialog with a component of its
   own inside it - and which renders nothing at all until it is open, so a fault
   in it is invisible to everything above. `tools/pile-dialog.svelte` opens it
   over the pile it is handed, so what renders here is the heading, the grid and
   the cards, and the row of actions at its foot.

   `Card.svelte` asks the board for its actions through a context, so the dialog
   cannot render without one. Everything a card *does* with it - the details
   dialog, the card menu - is a click, which a render to a string cannot make: the
   stub is here so the click handlers have somewhere to point, not to test them.
*/
const asPile = (pile) => ({
   props: { pile },
   context: new Map([ [ 'boardActions', { openDetails () {}, openCardMenu () {}, startAE () {} } ] ])
})

const inspection = renders('the pile inspection dialog renders, with cards in it',
   mod.InspectionView, asPile(mod.hand))
check('and it shows the pile as cards',
   Boolean(inspection) && (inspection.match(/class="card"/g) || []).length === get(mod.hand).length,
   `${(inspection?.match(/class="card"/g) || []).length} cards, ${get(mod.hand).length} in the pile`)
/* the same reading as the order strip: what is picked out is said, not only drawn */
check('and it says what to do with no card picked out',
   Boolean(inspection) && inspection.includes('Click a card to pick it out of the pile'))

/*
   Which pile this is, which is the whole of what tells two pile views apart: each
   one says its zone's name and how many cards are in it. A pile view is one dialog
   for every pile, so this heading is the only part of it that is about the pile
   rather than the cards - and it is what a player reads when two of them are open
   side by side, which is how a deck is read against a discard.

   The name is in a span of its own and the colour is a custom property on the
   heading (`--zone-accent`), so this is the name, the count, and that a zone colour
   is set at all.
*/
check('and the heading names the zone it is showing',
   Boolean(inspection) && inspection.includes('>Hand</span>') && inspection.includes('--zone-accent:'))
check('and it says how many cards are in the pile',
   Boolean(inspection) && inspection.includes(`${get(mod.hand).length} cards`))

/*
   Picking several out of a pile, which is the same selection *Search & Order Deck*
   has: a click selects, Ctrl-click adds, Ctrl+A takes the whole pile, and a card
   clicked again is put back. What `Inspection` adds is a line saying so, because a
   ring on a card is not something a pile can be read by (see docs/selection.md).
*/
mod.selectCard(get(mod.hand)[0], mod.hand, false)
mod.selectCard(get(mod.hand)[1], mod.hand, true)
mod.selectCard(get(mod.hand)[2], mod.hand, true)
check('three cards can be picked out of the pile', get(mod.cardSelection).length === 3, `${get(mod.cardSelection).length} picked out`)

mod.selectCard(get(mod.hand)[2], mod.hand, true)
check('and a card clicked again is put back', get(mod.cardSelection).length === 2, `${get(mod.cardSelection).length} picked out`)

mod.selectPile(mod.hand)
check('and Ctrl+A takes the whole pile', get(mod.cardSelection).length === get(mod.hand).length,
   `${(get(mod.cardSelection).length)} picked out of ${get(mod.hand).length}`)
mod.resetSelection()


/*
   And the one thing about the dialog a render to a string cannot see at all: where
   the panel sits and the padding its grid keeps from its edges.

   The grid is as wide as the panel and wraps, so a row that does not fill it leaves
   its room on one side; `justify-content: center` is what splits that between the
   sides, and the right-hand padding carries the panel's own scrollbar back
   (`--popup-scrollbar`), because a bar drawn in the body takes its width out of the
   box the cards are laid out in. Both are the kind of change that reads perfectly
   in the CSS and leaves a margin down one side of every pile on screen, and nothing
   else in this repository would notice either one going.

   The panel's *placement* is the other half, and it is deliberately not a placement
   of its own: it is the base rule's - centred in the window, the same gap on both
   sides. The one before this was flush to the window's left edge, which is what put
   the two gaps out of step, so what is checked here is that no placement class has
   been added back.
*/
const inspectionCss = readFileSync(join(src, 'lib', 'play', 'dialogs', 'Inspection.svelte'), 'utf8')
check('and the card grid is centred in it', /@apply[^;]*justify-center/.test(inspectionCss))
check('and its two paddings are the same length bar the scrollbar',
   /padding:\s*var\(--popup-padding[^)]*\)\s+calc\(\s*var\(--popup-padding[^)]*\)\s*\+\s*var\(--popup-scrollbar\)\s*\)\s+var\(--popup-padding[^)]*\)\s+var\(--popup-padding[^)]*\)/.test(inspectionCss))
/*
   And that the window is a fixed one. The grid is the panel's widest part and the
   panel is only as wide as its content, so a grid sized by its cards makes the whole
   panel resize with the pile - a narrow panel for a pile of three, a wide one for a
   pile of sixty. `width: max-content` is what pins it, and it is the kind of
   declaration that reads like a tidy-up and is not: without it nothing throws, the
   cards are all still there, and the only symptom is a window that changes size.
*/
check('and the window is a fixed width rather than the pile\'s',
   /\.cards\s*\{[^}]*width:\s*max-content/s.test(inspectionCss))
check('and a window too narrow for it still fits',
   /\.cards\s*\{[^}]*max-width:\s*100%/s.test(inspectionCss))
check('and the panel keeps the base placement, centred in the window',
   /<Popup bind:this=\{popup\} \{openOnMount\}>/.test(inspectionCss))

/*
   And the one rule about the ending of a view that can be asked without a browser:
   *which* pile an action out of a view shuffles. A card out of a deck leaves it
   unknown, so the deck is shuffled; a discard and a lost zone are public and
   ordered, and shuffling one would be a pile quietly rearranging itself.

   It is asked of the store rather than read off the panel, and the answer is counted
   in the game log, which is a real consequence and not a shape: `shuffle` writes
   *Shuffled Deck* (in solo it is written locally - see publishToChat), so the
   assertion is that a move out of the deck writes one more line and one out of a
   discard writes none. The four buttons, a card menu's own entries and an attach all
   end through this (see the wiring checks below), so this is the rule they share.
*/
const shuffled = () => get(mod.chat).filter((line) => line.message === 'Shuffled Deck').length

const beforeAction = shuffled()
mod.shuffleAfterLeavingDeck([ mod.discard ])
check('and a move out of a discard shuffles nothing', shuffled() === beforeAction)

mod.shuffleAfterLeavingDeck([ mod.deck ])
check('and a move out of the deck shuffles the deck', shuffled() === beforeAction + 1)

mod.shuffleAfterLeavingDeck([ mod.hand, mod.deck ])
check('and the deck is shuffled when it is one of several piles left', shuffled() === beforeAction + 2)

mod.shuffleAfterLeavingDeck([ mod.hand, mod.discard ])
check('and not when it is none of them', shuffled() === beforeAction + 2)

/*
   And the timing of the same rule for the two entries that do not act at once.

   *Attach* and *Evolve* arm the board - the card goes under, or on top of, the
   Pokemon the player clicks next - so choosing the entry is not the moment a card
   leaves a pile, and shuffling there would shuffle a deck that a change of mind
   leaves untouched. The shuffle belongs to the moment the card lands, which is
   `attachSelection`, and that can be called here: pick a card out of the deck, give
   the board something to attach it to, and count the lines.

   Two assertions, because they are two different questions: a card out of the deck
   shuffles *when it lands* and not before, and a card out of the hand (the ordinary
   attach, with no search behind it) never shuffles the deck at all. The slot the
   cards go under is a real one - `slot()` is what the board builds for a Pokemon.
*/
const beforeAttach = shuffled()
const deckCard = get(mod.deck)[0]
mod.selectCard(deckCard, mod.deck, false)
check('and picking a card out of the deck has not shuffled anything yet', shuffled() === beforeAttach)

const target = mod.slot()
mod.bench.add(target)
mod.attachSelection(target)
check('and the deck is shuffled when the card lands under a Pokemon', shuffled() === beforeAttach + 1)
check('and the card really is attached',
   target.energy.get().includes(deckCard) && !get(mod.deck).includes(deckCard))

const onBoard = get(mod.hand)[0]
mod.selectCard(onBoard, mod.hand, false)
mod.attachSelection(target)
check('and an attach with no deck behind it shuffles nothing', shuffled() === beforeAttach + 1)
check('and that card is attached too', target.energy.get().includes(onBoard))

/*
   And the wiring that gets a card menu's entry to that ending, which is three
   hand-offs and cannot be clicked here: the card in a view carries its pile
   (`board/Card.svelte`), the board asks that pile's view whether it is open and
   hands the menu a way to finish it (`Board.svelte`), and the menu calls it for an
   entry that acted and not for *Show Details* or the two that arm an attach
   (`dialogs/CardMenu.svelte`).

   Each half is a line that reads perfectly on its own and does nothing at all on its
   own, which is why all of them are here: a card menu that is never handed the ending
   is a menu that leaves the view open, and nothing in the tree would say so.
*/
const cardSource = readFileSync(join(src, 'lib', 'play', 'board', 'Card.svelte'), 'utf8')
const boardSource = readFileSync(join(src, 'lib', 'play', 'Board.svelte'), 'utf8')
const menuSource = readFileSync(join(src, 'lib', 'play', 'dialogs', 'CardMenu.svelte'), 'utf8')

/* the body of one function, up to the next function or the end of the script */
const bodyOf = (source, name) => {
   const start = source.indexOf(`function ${name} `)
   if (start === -1) return ''
   const rest = source.slice(start + 1)
   const end = rest.search(/\n   (?:export )?function |\n<\/script>/)
   return end === -1 ? rest : rest.slice(0, end)
}

check('and a card in a view carries its pile to the menu',
   /openCardMenu\(e\.clientX, e\.clientY, revealed, pile\)/.test(cardSource))
check('and the board asks the view before lending the menu its ending',
   /inspectionModal\.showing\(fromPile\)/.test(boardSource) && /view\.finishAction\(\)/.test(boardSource))
check('and every menu entry that acted ends through it',
   [ 'moveTo', 'callThenClose' ].every((fn) => bodyOf(menuSource, fn).includes('done()')))
check('and Show Details is not one of them - it acts on nothing',
   bodyOf(menuSource, 'showDetails') !== '' && !bodyOf(menuSource, 'showDetails').includes('done()'))
check('and neither are Attach and Evolve - they act when the card lands',
   bodyOf(menuSource, 'attachEvolve') !== '' && !bodyOf(menuSource, 'attachEvolve').includes('done()')
   && bodyOf(menuSource, 'attachEvolve').includes('startAE(evo)'))
check('and the four buttons end the view the same way',
   bodyOf(inspectionCss, 'moveCards').includes('finishAction()'))
check('and the panel is the only thing that knows it is open',
   /export function showing \(_pile\)/.test(inspectionCss) && /popup\?\.opened\(\)/.test(inspectionCss))

/*
   And which piles get the four buttons at all. They are the four places a *search*
   takes a card out of a deck to, so the deck's view is the one that offers them:
   every other pile's view is a read, and the only action on it is the button that
   closes it. Rendering each zone's own view is what makes that a fact rather than a
   claim - a condition on the wrong pile would leave the buttons off the deck's view
   and on a discard's, and a check that rendered one pile could not tell which.

   The heading is checked in the same pass, because it is the other half of "each
   pile's view says which pile it is": the name it prints is the zone it was handed.
*/
const deckView = renders('the deck inspection dialog renders', mod.InspectionView, asPile(mod.deck))
check('and the deck can be shuffled back on the way out',
   Boolean(deckView) && deckView.includes('Close &amp; Shuffle'))
check('and the deck view offers the four moves',
   Boolean(deckView) && deckView.includes('Add to discard pile'))
check('and the deck heading names the deck',
   Boolean(deckView) && deckView.includes('>Deck</span>'))
/* a pile with nothing picked out of it is not a pile to move anything out of */
check('and its four moves start disabled',
   Boolean(deckView) && (deckView.match(/disabled/g) || []).length === 4,
   `${(deckView?.match(/disabled/g) || []).length} disabled of 4`)

for (const [ zone, pile ] of [ [ 'discard', mod.discard ], [ 'lost zone', mod.lz ], [ 'hand', mod.hand ] ]) {
   const view = renders(`the ${zone} inspection dialog renders`, mod.InspectionView, asPile(pile))
   check(`and the ${zone} view is a read: Close, its own name and no moves`,
      Boolean(view) && view.includes('Close') && view.includes(`>${zone === 'lost zone' ? 'Lost Zone' : zone[0].toUpperCase() + zone.slice(1)}</span>`) && !view.includes('Add to'))
}

/*
   What those buttons do, which a render cannot click: a card selected out of the
   panel is moved to the pile the button names, and out of the pile it was
   selected in. The dialog's own handlers are `moveSelection` and `toBench` - the
   board's own moves, so this is the same motion a card dragged out of the deck
   makes, and it is asserted here rather than in a browser because none of it
   needs one.

   A bench is a slot rather than a card in a list, so it is checked as one: the
   card is off the pile, and a slot holds it.
*/
const card = get(mod.hand)[0]
mod.selectCard(card, mod.hand, false)
check('a card can be selected out of the pile', get(mod.cardSelection).length === 1, `${get(mod.cardSelection).length} selected`)

mod.moveSelection(mod.discard)
check('and moved to the discard by the same move the button calls',
   get(mod.discard).includes(card) && !get(mod.hand).includes(card))
check('and the selection is spent', get(mod.cardSelection).length === 0, `${get(mod.cardSelection).length} still selected`)

const benched = get(mod.hand)[0]
mod.selectCard(benched, mod.hand, false)
mod.toBench()
check('and moved to the bench as a slot',
   get(mod.bench).some(s => s.pokemon.get().includes(benched)) && !get(mod.hand).includes(benched))

/*
   One selection, the player's own cards wherever they are on their side of the
   board. A card in the hand, one on the table and one in the Stadium are three
   different piles, and Ctrl-click adds across them: it is the same "add to what is
   picked up" the pile views answer to, and the table's cards are picked up one at
   a time because of it (see docs/selection.md).

   The move at the end is the half of this a store cannot check on its own: each
   card has to come out of *its own* pile, and the card already in the destination
   is not a card to move. It is asserted one pile at a time, which is also how the
   events travel - a `cardsMoved` names one pile to take the cards from.
*/
const spread = get(mod.hand).slice(0, 3)
mod.selectCard(spread[0], mod.hand, false)
mod.moveSelection(mod.table)
mod.selectCard(spread[1], mod.hand, false)
mod.moveSelection(mod.stadium)

mod.selectCard(spread[0], mod.table, false)
mod.selectCard(spread[1], mod.stadium, true)
mod.selectCard(spread[2], mod.hand, true)
check('Ctrl-click adds a card from another zone of the same half',
   get(mod.cardSelection).length === 3,
   `${get(mod.cardSelection).length} picked up from the table, the stadium and the hand`)
check('and a click without it replaces the selection',
   (mod.selectCard(spread[2], mod.hand, false), get(mod.cardSelection).length === 1),
   `${get(mod.cardSelection).length} picked up after a plain click`)

mod.selectCard(spread[0], mod.table, false)
mod.selectCard(spread[1], mod.stadium, true)
mod.selectCard(spread[2], mod.hand, true)
mod.moveSelection(mod.discard)
check('and a move takes each card out of the pile it is in',
   spread.every(card => get(mod.discard).includes(card)) &&
   !get(mod.hand).includes(spread[2]) && !get(mod.table).includes(spread[0]) && !get(mod.stadium).includes(spread[1]),
   `discard ${get(mod.discard).length}, hand ${get(mod.hand).length}, table ${get(mod.table).length}, stadium ${get(mod.stadium).length}`)
check('and the selection is spent', get(mod.cardSelection).length === 0, `${get(mod.cardSelection).length} still picked up`)

/*
   And the two halves are still separate boards. Both are played from this same
   selection in solo, so a card of the far half's must start a new selection rather
   than join one made on this half - every key that moves a selection asks which
   half it was made on, and a selection that held both would have no one answer.
   The far half has no deck here, so a card of its own is put in its hand.
*/
const farCard = { _id: 9901, name: 'Far Card' }
mod.defaultOpponent.hand.push(farCard)
mod.selectCard(get(mod.hand)[0], mod.hand, false)
mod.selectCard(farCard, mod.defaultOpponent.hand, true)
check('a card of the other half starts a new selection',
   get(mod.cardSelection).length === 1 && get(mod.cardSelection)[0] === farCard,
   `${get(mod.cardSelection).length} picked up`)
mod.resetSelection()

/*
   And the one thing about the table that no store can show: the zone used to pick
   the whole stack up on a click, and take the whole stack on Ctrl+A. Its cards are
   each picked up on their own now - the same code path a card attached under a
   Pokemon uses - and the select-all it no longer offers is still the zone's
   `selectAll` prop, kept for a pile that wants it (read off the two components,
   because what a zone does with a click is in its markup).
*/
for (const [ half, zone ] of [ [ 'the player', p('lib', 'play', 'board', 'Temp.svelte') ], [ 'the far half', p('lib', 'play', 'opponent', 'Temp.svelte') ] ]) {
   const source = readFileSync(zone, 'utf8')
   check(`and ${half}'s table no longer takes the whole stack at once`,
      !/selectPile/.test(source) && /selectAll=\{false\}/.test(source))
   check(`and every card of it is picked up on its own`,
      /selectCard\(card, table, holdingCtrlOrCmd\(e\)\)/.test(source))
}

/*
   Reveal and Look: the two ways cards out of a deck are shown, and the one
   property both of them exist to apply.

   This is the half of the pair a render *can* answer, and it is the half that
   matters most, because the property - "this opponent card may be acted on" - is
   the part with no visible symptom when it is wrong. A card that is actionable and
   should not be offers a menu that moves somebody else's card; a card that should
   be and is not simply never answers, which reads exactly like the feature not
   existing.

   What is asserted here is the *rule* rather than a rendering:

   - the permission is the batch and nothing else: a card is actionable while it is
     in the Reveal batch or the Look batch, and not before, not after the batch is
     replaced, and not after the board is cleared
   - a batch is a view of a deck, so the same card object is in the far half's deck
     *and* in the batch - and `cardPile` therefore answers null for it, which is how
     a card in those windows is told apart from a card on the board
   - the two windows render, with their cards and their two buttons
   - both entries refuse solo, which is the rule the menus also state

   Neither window can be opened by a click here - one is opened by a relay event
   and the other by a menu entry - so they are rendered from a batch put into the
   store directly, which is the same state the event would leave behind.
*/
mod.resetRevealState()
check('a card is not actionable before anything has been shown', !mod.isActionable(get(mod.defaultOpponent.deck)[0] || {}))
check('and nothing may be revealed in solo', mod.canReveal() === false, `canReveal = ${mod.canReveal()}`)

check('and "the top X" is what the deck has when X is larger', mod.topCount(mod.deck, 999) === get(mod.deck).length)

/*
   The far half's deck, which a board state would have filled. This check has no
   room and so no state to receive, so it is filled here - the same three cards a
   `boardState` would move into it (`moveCards` in opponent.js).
*/
for (let i = 0; i < 6; i++) {
   mod.defaultOpponent.deck.push({ _id: 9000 + i, name: `Their Card ${i + 1}`, set: 'sv1', number: String(i + 1) })
}
const farDeck = get(mod.defaultOpponent.deck)
check('and the far half has a deck to reveal', farDeck.length > 2, `${farDeck.length} cards`)

/*
   The batch, in the shape a pile has - which is what `applyReveal` builds (see
   `asPile` in reveal.js), and both halves of it matter:

      `cards`  the record of the gesture: the ids that were shown, and what the
               permission is asked about
      `get()`  the *live* view of them: the cards that are still in the deck, which
               is what the window draws

   A copy of the list is the obvious implementation and it is wrong: the card would
   stay in the window after it had been acted on, and the second click would do
   nothing at all, silently (see docs/gotchas.md). So the batch is built here the
   way the real one is built, by hand, because the real one arrives in an event that
   needs a room.
*/
const shownCards = farDeck.slice(-3).reverse()
const batch = {
   name: 'deck',
   source: farDeck,
   get: () => shownCards.filter((card) => farDeck.includes(card)),
   subscribe: (fn) => { fn(batch.get()); return () => {} }
}
mod.reveal.set({ owner: 'theirs', pileName: 'deck', cards: shownCards, pile: batch })

check('a revealed card is actionable', mod.isActionable(shownCards[0]))
check('and one that was not revealed is not', !mod.isActionable(farDeck[0]))
/*
   The card is in the far half's deck *and* in the batch - they are the same card
   objects, which is what makes the batch an id-only event possible. So the card's
   own pile is the far half's deck, and the batch is a different object from it:
   that difference is the whole of how a card in one of these windows is told apart
   from a card of this board's, and `board/Card.svelte` asks it of `piles()`.
*/
check('and the card is in the far half\'s deck, where the batch got it',
   get(mod.defaultOpponent.deck).includes(shownCards[0]))
/*
   And the batch is *not* one of this board's own piles, which is the whole of how
   a card in one of these windows is told apart from a card on the board:
   `board/Card.svelte` asks whether the pile a card carries is in `piles()`, and a
   batch is a different object from the mirror's deck it is a view of. The card's
   own pile is `null` for this board - the far half's zones are the mirror's, and
   this board's `piles()` is its own.
*/
check('and the batch is not one of this board\'s own piles',
   mod.cardPile(shownCards[0]) === null,
   'the far half\'s deck is not this board\'s pile, which is what the window is read by')
check('and neither is the far half\'s deck', mod.cardPile(farDeck[0]) === null)

const revealHtml = renders('the reveal window renders, with the cards on show', mod.RevealDialog, {
   props: { renderOpen: true },
   context: new Map([ [ 'boardActions', { openDetails () {}, openCardMenu () {}, openOppCardActionMenu () {} } ] ])
})
check('and it says both players can see them',
   Boolean(revealHtml) && revealHtml.includes('both players can see these'))
check('and it offers Close and Close &amp; Shuffle',
   Boolean(revealHtml) && revealHtml.includes('Close') && revealHtml.includes('Close &amp; Shuffle'))
check('and it shows the cards of the batch',
   Boolean(revealHtml) && (revealHtml.match(/class="card"/g) || []).length === batch.get().length,
   `${(revealHtml?.match(/class="card"/g) || []).length} cards, ${batch.get().length} on show`)

/* the Look batch is the same shape, and the same permission */
const lookedCards = farDeck.slice(-2).reverse()
const lookPile = {
   name: 'deck',
   source: farDeck,
   get: () => lookedCards.filter((card) => farDeck.includes(card))
}
mod.look.set({ pileName: 'deck', cards: lookedCards, pile: lookPile })
check('a looked-at card is actionable too', mod.isActionable(lookedCards[0]))

const lookHtml = renders('the look window renders, with the cards on show', mod.LookDialog, {
   props: { renderOpen: true },
   context: new Map([ [ 'boardActions', { openDetails () {}, openOppCardActionMenu () {} } ] ])
})
check('and it says only this player can see them',
   Boolean(lookHtml) && lookHtml.includes('only you can see these'))
check('and it offers Close and Close &amp; Shuffle',
   Boolean(lookHtml) && lookHtml.includes('Close') && lookHtml.includes('Close &amp; Shuffle'))

/*
   And the batch is a *live* view of the deck rather than a copy of it, which is the
   difference between a window that keeps offering a card that has been sent
   somewhere and one that does not. A copy is the obvious implementation and it has
   no visible symptom until a card is acted on: it stays in the window, and the
   second click does nothing at all, silently (see docs/gotchas.md).

   The two questions a move changes are asked here: what the window shows, and
   whether the card still answers a click.
*/
const shown = shownCards[1]
check('a card is on show while it is still in the deck', batch.get().includes(shown) && mod.isActionable(shown))

farDeck.splice(farDeck.indexOf(shown), 1)
check('and leaves the window the moment it is moved out of the deck',
   !batch.get().includes(shown),
   `${batch.get().length} of ${shownCards.length} still on show`)
check('and stops answering clicks with it', !mod.isActionable(shown))

mod.resetRevealState()
check('and nothing is actionable once the board is cleared',
   !mod.isActionable(shownCards[0]) && !mod.isActionable(farDeck[0]))

/*
   And the wiring, which a render cannot click: each deck's own menu offers the
   entries, and a card of the far half's picks the right menu for the situation -
   the local one in solo, the request one in a room.
*/
const ownDeckSource = readFileSync(join(src, 'lib', 'play', 'board', 'Deck.svelte'), 'utf8')
const oppDeckSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Deck.svelte'), 'utf8')
const oppCardSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Card.svelte'), 'utf8')
const ownCardSource = readFileSync(join(src, 'lib', 'play', 'board', 'Card.svelte'), 'utf8')
const oppActionSource = readFileSync(join(src, 'lib', 'stores', 'oppAction.js'), 'utf8')

check('and the player\'s own deck offers Reveal Top X', /text="Reveal Top X"/.test(ownDeckSource) && /revealTop\(deck/.test(ownDeckSource))
check('and no Look: a player cannot look at their own deck, they can read it',
   !/Look at Top X/.test(ownDeckSource))
check('and the opponent\'s deck offers both', /text="Reveal Top X"/.test(oppDeckSource) && /text="Look at Top X"/.test(oppDeckSource))
check('and both are refused outside a room', /disabled=\{!canReveal\(\)\}/.test(ownDeckSource) && /disabled=\{!canReveal\(\)\}/.test(oppDeckSource))

/*
   The one hand-off that decides which menu a card of the far half's gets. It is a
   line in a component that a render cannot click, so it is read - and read the
   same way for both halves, because the *near* half must not be able to reach the
   request menu at all: a card of the player's own is never somebody else's.
*/
check('and a card of the far half\'s takes the request menu in a room',
   /openOppCardActionMenu\(e\.clientX, e\.clientY, card, revealed, pile\)/.test(oppCardSource) &&
   /\$solo\) openOppCardMenu/.test(oppCardSource))
check('and a card of the player\'s own only takes it inside a reveal or a look',
   /isForeignPile\(pile\)/.test(ownCardSource) && /piles\(\)\.includes\(p\)/.test(ownCardSource) &&
   /if \(isForeignPile\(pile\)\) \{\s*openOppCardActionMenu/.test(ownCardSource))
check('and no action is taken on a card that does not answer',
   /if \(!card \|\| !canActOn\(card\)\) return false/.test(oppActionSource))
check('and the owner is the one who performs the move',
   /react\('oppCardAction'/.test(oppActionSource) && /respondToOpponentCardAction/.test(oppActionSource))

try { mod.exitSolo() } catch {}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - something in the tree does not render, or a move it makes does not land`)
   console.log('(this is the class of failure a build and a CSS check cannot see - see docs/gotchas.md)')
   process.exit(1)
}
console.log('verdict: ok - the menu, the board in solo, the sidebar and a pile dialog all render, and a card comes out of one')
