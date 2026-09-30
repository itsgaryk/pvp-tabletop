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
   import { reveal, revealView, revealOpen, look, lookView, lookOpen, handReveal, handRevealView, handRevealOpen, isActionable, canReveal, topCount, revealTop, lookTop, spendCards, resetRevealState } from '${p('lib/stores/reveal.js')}'
   import { OPP_ACTIONS, opponentCardAction, respondToOpponentCardAction } from '${p('lib/stores/oppAction.js')}'
   import { pingCard, pingLine, pinged, pingedCard } from '${p('lib/stores/ping.js')}'
   import { gameSetup } from '${p('lib/stores/gameSetup.js')}'
   import { spectating, seatedPlayers, myId } from '${p('lib/stores/connection.js')}'
   import InspectionView from '${join(root, 'tools', 'pile-dialog.svelte').split(sep).join('/')}'
   import RevealDialog from '${p('lib/play/dialogs/Reveal.svelte')}'
   import LookDialog from '${p('lib/play/dialogs/Look.svelte')}'
   import HandRevealDialog from '${p('lib/play/dialogs/HandReveal.svelte')}'
   import GameSetupDialog from '${p('lib/play/dialogs/GameSetupDialog.svelte')}'
   /* what a decklist import does: the list of cards, then the board built from it */
   const setDeck = (cards_) => { cards.set(cards_); resetBoard() }
   export { solo, startSolo, exitSolo, room, chat, Board, Connection, Page, bench, cardSelection, cardPile, canReveal, deck, defaultOpponent, discard, draw, gameSetup, GameSetupDialog, hand, handReveal, handRevealOpen, handRevealView, HandRevealDialog, isActionable, look, lookOpen, LookDialog, lookTop, lookView, lz, moveSelection, myId, OPP_ACTIONS, opponentCardAction, pingCard, pingLine, pinged, pingedCard, resetRevealState, resetSelection, respondToOpponentCardAction, reveal, revealOpen, RevealDialog, revealTop, revealView, seatedPlayers, selectCard, setDeck, shuffleAfterLeavingDeck, slot, spendCards, spectating, stadium, table, toBench, topCount, attachSelection, selectPile, InspectionView }
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
      /*
         `body` first: Svelte 4's server output splits the head from the body, and a component
         that draws nothing has `body: ''` and an `html` that is not there at all. Reading only
         `html` made "this draws nothing" read as a component that draws something.
      */
      const html = out?.body ?? out?.html ?? ''
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
   Reveal, Look and Reveal Hand: the three ways cards out of somebody else's pile are
   shown, and the one property all of them exist to apply.

   This is the half of the pair a render *can* answer, and it is the half that
   matters most, because the property - "this opponent card may be acted on" - is
   the part with no visible symptom when it is wrong. A card that is actionable and
   should not be offers a menu that moves somebody else's card; a card that should
   be and is not simply never answers, which reads exactly like the feature not
   existing.

   What is asserted here is the *rule* rather than a rendering:

   - the permission is the batch **as the window hands it over**: a card is actionable
     while it is one of the cards a batch is showing *and* it is carried by that batch's
     pile - and the same card handed one of the far half's own zones is refused, which is
     the reported fault in one line (*cards in the Hand Zone should not be selectable*)
   - not before a batch exists, not after the card has been acted on, and not after the
     board is cleared
   - a batch is a view of a deck, so the same card object is in the far half's deck
     *and* in the batch - and `cardPile` therefore answers null for it, which is how
     a card in those windows is told apart from a card on the board
   - the three windows render, with their cards and their buttons
   - both entries refuse solo, which is the rule the menus also state

   None of the windows can be opened by a click here - one is opened by a relay event
   and the others by a menu entry - so they are rendered from a batch put into the
   store directly, which is the same state the event would leave behind.
*/
mod.resetRevealState()
/*
   The pile is asked of every one of these questions, and the first one asks it with the far
   half's **own deck** - which is the pile the board draws that card in, and the whole of the
   reported fault: the permission used to be "one of the cards of a batch", a batch is a live
   view of a pile the board holds, and so the same card object answered for the card in the
   opponent's hand zone, behind the window, and again after the window was closed. A card is
   actionable as the *window's* card or not at all (see `isActionable`).
*/
check('a card is not actionable before anything has been shown',
   !mod.isActionable(get(mod.defaultOpponent.deck)[0] || {}, mod.defaultOpponent.deck),
   'asked with the far half\'s own deck, which is the pile the board carries it with')

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
   The batch, in the shape `applyReveal` builds (see reveal.js), and all three parts
   of it matter:

      `cards`      the record of the gesture: the ids that were shown, which is what
                   the batch is recognized by
      `ownerHere`  the half in this board's words, so the window can name it
      `revealView` the ids resolved against the deck, in the deck's own objects,
                   which is what the window draws and what the permission is asked
                   against

   Ids rather than objects, and a *pushed* view rather than a computed list, are both
   load bearing. A mirror holds copies of the cards rather than the cards themselves,
   so a batch of objects could not be matched against the board that receives it; and
   a view that is not pushed does not update when a card leaves the deck on the
   owner's own board, where the move writes no event for anything to react to. Both
   are in docs/gotchas.md.
*/
const shownIds = farDeck.slice(-3).reverse().map((card) => card._id)
const batch = { owner: 'mine', senderIsMe: true, ownerHere: 'mine', pileName: 'deck', cards: shownIds }
const viewOf = () => shownIds.map((id) => farDeck.find((card) => card._id === id)).filter(Boolean)

batch.pile = { name: 'deck', get: viewOf, subscribe: (fn) => { fn(viewOf()); return () => {} } }
mod.reveal.set(batch)
mod.revealView.set(viewOf())
mod.revealOpen.set(true)

check('a revealed card is actionable', mod.isActionable(viewOf()[0], batch.pile))
check('and one that was not revealed is not', !mod.isActionable(farDeck[0], batch.pile))
/*
   And the window being *up* is part of the answer: a batch outlives its window on purpose,
   so a rule that only asked the pile would go on granting a permission nothing on screen is
   handing over. The report's second sentence is exactly this (*after the window closes the
   cards are still actionable*), which is why it is asked here rather than left to the
   component to hide.
*/
mod.revealOpen.set(false)
check('and it stops answering the moment the window is closed',
   !mod.isActionable(viewOf()[0], batch.pile),
   'the batch outlives its window; the permission does not')
mod.revealOpen.set(true)
/*
   And the same card, in the same deck, is **not** actionable when it is carried by the deck
   rather than by the window: this is the rule, in one line, and it is the one the browser
   check can only see as a click that does nothing.
*/
check('and the same card handed the far half\'s own deck is refused',
   !mod.isActionable(viewOf()[0], mod.defaultOpponent.deck),
   'a card of the opponent\'s on the board is never actionable, in a room')


/*
   The reveal's log line, read off the source rather than run: `shareReveal` needs a room
   to publish into, and what matters here is the *shape* of the line - it names the cards,
   and a Look's does not. That pair is a rule rather than a wording: a reveal is a public
   act, so the log is the record of what the table was shown, while naming a Look's cards
   would tell the opponent what the look was for (see `revealLine` and `lookLine`).
*/
const revealSource = readFileSync(join(src, 'lib', 'stores', 'reveal.js'), 'utf8')
check('and a reveal names the cards it showed in the log',
   /Revealed \[\$\{names\.join/.test(revealSource) && /namesOf\(pile, ids\)/.test(revealSource),
   'the log line interpolates the card names')
check('while a Look still names nothing',
   /Looked at the top \$\{cards\} of the opponent's deck/.test(revealSource))/*
   The card is in the far half's deck *and* in the batch, which is what makes the
   batch an id-only event possible. So the card's own pile is the far half's deck,
   and the batch is a different object from it: that difference is the whole of how a
   card in one of these windows is told apart from a card of this board's, and
   `board/Card.svelte` asks it of `piles()`.
*/
check('and the card is in the far half\'s deck, where the batch got it',
   get(mod.defaultOpponent.deck).includes(viewOf()[0]))
/*
   And the batch is *not* one of this board's own piles, which is the whole of how
   a card in one of these windows is told apart from a card on the board:
   `board/Card.svelte` asks whether the pile a card carries is in `piles()`, and a
   batch is a different object from the mirror's deck it is a view of. The card's
   own pile is `null` for this board - the far half's zones are the mirror's, and
   this board's `piles()` is its own.
*/
check('and the batch is not one of this board\'s own piles',
   mod.cardPile(viewOf()[0]) === null,
   'the far half\'s deck is not this board\'s pile, which is what the window is read by')
check('and neither is the far half\'s deck', mod.cardPile(farDeck[0]) === null)

const revealHtml = renders('the reveal window renders, with the cards on show', mod.RevealDialog, {
   props: { renderOpen: true },
   context: new Map([ [ 'boardActions', { openDetails () {}, openCardMenu () {}, openOppCardActionMenu () {} } ] ])
})
check('and it names the deck it is showing',
   Boolean(revealHtml) && revealHtml.includes('Your deck'), 'the batch is this board\'s own deck')
check('and it says both players can see them',
   Boolean(revealHtml) && revealHtml.includes('both players can see these'))
check('and it offers Close and Close &amp; Shuffle',
   Boolean(revealHtml) && revealHtml.includes('Close') && revealHtml.includes('Close &amp; Shuffle'))

/*
   **The reveal window is the two players'; a spectator is told by the log.**

   The cards travel to every board as a batch - that is what makes them actionable and what
   the acting board's permission is checked against - but the *window* is withheld from a
   spectator, because a reveal now names its cards in the game log and the table has been
   told. A spectator keeps the refusal on the cards themselves, which is what would make a
   window it did have read-only.
*/
check('and a reveal is written into the log with the cards named',
   /Revealed \[\$\{names\.join/.test(readFileSync(join(src, 'lib', 'stores', 'reveal.js'), 'utf8')),
   'the log is where the table is told what was shown')

mod.spectating.set(true)
check('and nothing of the batch is actionable for a spectator',
   !mod.isActionable(viewOf()[0], batch.pile),
   'isActionable is the single refusal every gesture asks')
mod.spectating.set(false)
check('and a player is not refused by it', mod.isActionable(viewOf()[0], batch.pile))
check('and it shows the cards of the batch',
   Boolean(revealHtml) && (revealHtml.match(/class="card"/g) || []).length === mod.revealView.get().length,
   `${(revealHtml?.match(/class="card"/g) || []).length} cards, ${mod.revealView.get().length} on show`)

/* the Look batch is the same shape, and the same permission */
const lookedIds = farDeck.slice(-2).reverse().map((card) => card._id)
const lookedView = () => lookedIds.map((id) => farDeck.find((card) => card._id === id)).filter(Boolean)
/*
   The Look batch replaces the reveal as far as the permission is concerned: there is
   one batch per question, and a Look taken after a Reveal is the newer answer about
   what is on show (see `isActionable`).
*/
mod.reveal.set(null)
mod.revealView.set([])
const lookPile = { name: 'deck', get: lookedView, subscribe: (fn) => { fn(lookedView()); return () => {} } }
mod.look.set({ ownerHere: 'theirs', pileName: 'deck', pile: lookPile, cards: lookedIds })
mod.lookView.set(lookedView())
mod.lookOpen.set(true)
check('a looked-at card is actionable too', mod.isActionable(lookedView()[0], lookPile))

const lookHtml = renders('the look window renders, with the cards on show', mod.LookDialog, {
   props: { renderOpen: true },
   context: new Map([ [ 'boardActions', { openDetails () {}, openOppCardActionMenu () {} } ] ])
})
check('and it says only this player can see them',
   Boolean(lookHtml) && lookHtml.includes('only you can see these'))
check('and its only ending is Close &amp; Shuffle, with no Close beside it',
   Boolean(lookHtml) && lookHtml.includes('Close &amp; Shuffle') && !/>Close</.test(lookHtml),
   'a Look is one ending, and a Close beside it would be a second')

/*
   And the Reveal Hand window, which is the same permission over a different pile: the
   whole of one player's hand, shown to the player who asked for it, with **Close and
   nothing else** - a hand is not read in an order, so there is no order to lose and
   nothing to shuffle.

   The pile is the part that had to change rather than be copied: a Look resolves its batch
   against a *deck* and a Reveal Hand against a *hand*, so `theirPileFor` answers both and
   the batch's own `pileName` is what picks between them. That is asserted here by reading
   the window rather than the store: a window that resolved a hand batch against the far
   deck would draw nothing at all and still render perfectly.

   The far hand is filled the way the far deck above is, and with the fields a card needs to
   be *drawn* - `cardImage` reads its set and number, and a card without them is not a card
   this renderer can draw. The one card already in there (`farCard`, from the two-half
   selection check) is left alone: it is a card of that half's hand, which is exactly what
   this window is about.
*/
for (let i = 0; i < 4; i++) {
   mod.defaultOpponent.hand.push({ _id: 9500 + i, name: `Their Hand Card ${i + 1}`, set: 'sv1', number: String(i + 1), ptcgApiCode: 'sv1' })
}
const theirHand = get(mod.defaultOpponent.hand)
check('and the far half has a hand to reveal', theirHand.length > 1, `${theirHand.length} cards`)

const handIds = theirHand.slice(-3).map((card) => card._id)
const handView = () => handIds.map((id) => theirHand.find((card) => card._id === id)).filter(Boolean)
const handPile = { name: 'hand', get: handView, subscribe: (fn) => { fn(handView()); return () => {} } }
mod.handReveal.set({ looker: null, remote: false, pileName: 'hand', pile: handPile, cards: handIds })
mod.handRevealView.set(handView())
mod.handRevealOpen.set(true)

check('a card of the revealed hand is actionable', mod.isActionable(handView()[0], handPile))
/*
   **And the same card is refused where the board draws it.** This is the report, at the
   level of the rule: the hand zone renders these very objects - `opponent/Hand.svelte`
   hands each of them the hand - so an answer that asked only "is this one of the batch's
   cards" said yes to the cards in the Hand Zone, which is *the Reveal Hand window allows
   the owner's cards in the Hand Zone to be selected*. It is the same hand, the same card
   and the same batch: only the pile it is carried with differs.
*/
check('and is refused when the board carries it instead of the window',
   !mod.isActionable(handView()[0], mod.defaultOpponent.hand),
   'the Hand Zone hands the hand, so the cards in it are never actionable')
mod.handRevealOpen.set(false)
check('and refused again once the window is closed',
   !mod.isActionable(handView()[0], handPile),
   'nothing on screen is handing that batch over any more')
mod.handRevealOpen.set(true)

const handHtml = renders('the reveal hand window renders, with the cards on show', mod.HandRevealDialog, {
   props: { renderOpen: true },
   context: new Map([ [ 'boardActions', { openDetails () {}, openOppCardActionMenu () {} } ] ])
})
check('and it says only this player can see the hand',
   Boolean(handHtml) && handHtml.includes('only you can see this hand'))
check('and it draws every card of the batch',
   Boolean(handHtml) && (handHtml.match(/class="card"/g) || []).length === mod.handRevealView.get().length,
   `${(handHtml?.match(/class="card"/g) || []).length} cards, ${mod.handRevealView.get().length} in the batch`)
check('and its one ending is Close, with no shuffle beside it',
   Boolean(handHtml) && /<button[^>]*>Close<\/button>/.test(handHtml) && !handHtml.includes('Shuffle'),
   'a hand has no order to lose, so there is no ending to offer beside Close')

/*
   The card selection is the other windows', because it is not written here at all: the
   window hands each card the batch in a pile's shape, which is what makes a click select
   it (`selectCard`), Ctrl+A take it (`selectPile`) and the card menu recognize it. So the
   assertion is that the same gesture works on this batch - the selection is the board's
   own, and the batch is a pile it accepts.
*/
mod.resetSelection()
mod.selectCard(handView()[0], mod.handReveal.get().pile, false)
mod.selectCard(handView()[1], mod.handReveal.get().pile, true)
check('and its cards are picked out the way the other windows\' are',
   get(mod.cardSelection).length === 2, `${get(mod.cardSelection).length} picked out`)
mod.selectPile(mod.handReveal.get().pile)
check('and Ctrl+A takes the whole hand batch',
   get(mod.cardSelection).length === handIds.length, `${get(mod.cardSelection).length} of ${handIds.length}`)
mod.resetSelection()
mod.handReveal.set(null)
mod.handRevealView.set([])

/*
   **And a card the player has moved stops being actionable.** This is the "glowing issue":
   a card sent out of a window to the owner's **hand** stayed on show *and* stayed
   actionable, because the hand is a pile the batch is still a live view of - the view is
   "the batch's cards that are still in the pile", and the card really is in that pile. So
   the window went on offering a card that had already been sent somewhere, and its outline
   went on saying "you may move this".

   The answer is a record of what this player has acted on (`spendCards`), asked by the one
   function every gesture goes through. It is asserted here rather than in a browser because
   the rule is a store's and the browser check can only see the drawing.
*/
const spentCard = { _id: 9701, name: 'Spent Card', set: 'sv1', number: '1' }
const otherCard = { _id: 9702, name: 'Other Card', set: 'sv1', number: '2' }
mod.defaultOpponent.hand.push(spentCard, otherCard)
const spentPile = { name: 'hand', get: () => [ spentCard, otherCard ], subscribe: (fn) => { fn([ spentCard, otherCard ]); return () => {} } }
mod.handReveal.set({ looker: null, remote: false, pileName: 'hand', pile: spentPile, cards: [ spentCard._id, otherCard._id ] })
mod.handRevealView.set([ spentCard, otherCard ])
mod.handRevealOpen.set(true)

check('a card of a window is actionable to begin with', mod.isActionable(spentCard, spentPile))
mod.spendCards([ spentCard ])
check('and stops the moment this player has acted on it', !mod.isActionable(spentCard, spentPile))
check('and the rest of the window still answers', mod.isActionable(otherCard, spentPile))
check('and the card is still in the pile, which is why the view alone could not answer it',
   get(mod.defaultOpponent.hand).includes(spentCard))

/*
   And the record does not outlive the board it was about. Asserted by putting the *same*
   batch back after the reset: without that the claim would be answered by the batch being
   gone rather than by the record being cleared, which is the shape of assertion that passes
   for the wrong reason.
*/
mod.resetRevealState()
mod.handReveal.set({ looker: null, remote: false, pileName: 'hand', pile: spentPile, cards: [ spentCard._id, otherCard._id ] })
mod.handRevealView.set([ spentCard, otherCard ])
mod.handRevealOpen.set(true)
check('and the board being cleared forgets what was spent', mod.isActionable(spentCard, spentPile),
   'the record does not outlive the batch it was about')
mod.handReveal.set(null)
mod.handRevealView.set([])

/*
   **And the far half's card has no action outline at all.** The animation that used to mark
   a card this player may act on is gone - the "glowing issue" - and this is the half of that
   which no store can see: it was a `class:actionable={glowing}` binding on the wrapper plus a
   rule with a `@keyframes` behind it, and a check that only asked the permission would pass
   with both back in place.

   Both halves are read out of the component's own source, because a render to a string is
   where a class binding is at its least visible - the markup carries the class only when the
   permission answers for that card - so a rule with nothing to bind it and a binding with
   nothing to draw it are two bugs, and one assertion cannot see both.
*/
const farCardSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Card.svelte'), 'utf8')
check('and no card of the far half is bound to an action class',
   !/class:actionable/.test(farCardSource),
   'the binding is gone, so there is nothing for a rule to draw on')
check('and there is no action outline to wear',
   !/\.actionable\s*\{/.test(farCardSource) && !/@keyframes actionable/.test(farCardSource),
   'the rule and its keyframes are both gone')
/*
   **And the answer is re-asked rather than snapshotted.** `isActionable` reads the batches,
   their views and the record of what has been spent itself, so a `$:` that only *called* it
   would compile to a statement about `card` alone - run once, when the card was created, and
   kept for the card's whole life. That is how the reported fault appeared and disappeared:
   the cards of the opponent's hand zone were built before the window opened and answered
   none of it, while a board state that rebuilt them during a window left them answering
   after it closed. The component has to read the store, and that is a line of its source
   rather than anything a render to a string can show.
*/
check('and the far half\'s card re-asks the permission when a window changes',
   /\$windows/.test(farCardSource) && /isActionable\(card, pile, \$windows\)/.test(farCardSource),
   'the card subscribes to what the windows are showing instead of keeping one answer')
/*
   And the Look's window is the looker's alone, which is the store's rule rather than the
   component's: the component cannot tell a watcher from a player, and the board that must
   not draw one is a board whose `lookOpen` was never set.
*/
const revealStoreSource = readFileSync(join(src, 'lib', 'stores', 'reveal.js'), 'utf8')
check('and a Look\'s window is opened for the looker and for nobody else',
   /if \(mine\) lookOpen\.set\(true\)/.test(revealStoreSource),
   'the addressed event still reaches the watchers for the log line, and opens no window')

/*
   **A card of the far half's is *readable* wherever it is on show, which is not the
   question the permission answers.** The double click was gated on `actionable`, and
   once the permission became "the card as the window carries it" (see `isActionable`)
   a card lying in a zone of the far half is not actionable in a room at all - so the
   gesture was refused for every card that half draws. Reported as *"a player should be
   able to double click on an opponent's card in both the Stadium Zone and Table Zone
   for the Show Details function"*; the `hidden` test below it was dead code even
   before that, because a card that answers `actionable` is one a window is carrying
   and a window's pile is never the hand.

   What says whether a card may be read is `revealed`: the same value the card's own
   `img` is drawn from (`$prizesFlipped`, `$handRevealed`, or `true` for a window), so
   a card drawn face down - the hand, an unflipped prize - is the one a double click
   refuses. It is a source assertion because the gesture itself needs a browser; the
   browser half of it is `tools/zone-sync-check.mjs`, which double clicks a card on the
   far table, a card in the far Stadium and a card in the far hand.

   Both assertions are asked of the **function's own body**, cut at the next `function`
   in the file: asking the file as a whole answers the wrong question, because the very
   next function down (`onDragStart`) opens with `if (!actionable) return` and a
   whole-file test finds it, which is a check that fails on the fixed tree.
*/
function functionBody (source, name) {
   const start = source.indexOf(`function ${name}`)
   if (start === -1) return null
   const next = source.indexOf('\n   function ', start)
   return source.slice(start, next === -1 ? undefined : next)
}

const detailsBody = functionBody(farCardSource, 'onDetails')

check('and a double click on a card of the far half\'s refuses only a card drawn face down',
   Boolean(detailsBody) && /if \(!revealed\) return/.test(detailsBody),
   'the details rule reads `revealed`, which is what the card\'s own image is drawn from')
check('and no longer asks a permission no card in a zone of that half has',
   Boolean(detailsBody) && !/actionable/.test(detailsBody),
   'a zone hands over the zone and a zone is never a batch, so the permission is false there for ever')

/*
   The far half's table draws its cards as `img`s rather than through that component,
   so the same gesture has to be on the card itself there - and it has to stop, because
   the stack's own double click is *View All*. Their table has no card menu in a room
   (a card of theirs on the board is not the player's to act on), which is why this
   half has the gesture and the near half does not.
*/
const farTableSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Temp.svelte'), 'utf8')
check('and a card on the far half\'s table shows itself on a double click',
   /on:dblclick=\{\(e\) => onDetails\(e, card\)\}/.test(farTableSource) && /openDetails\(card\)/.test(farTableSource),
   'the card stops the stack\'s own double click and opens its details')

/*
   And the view is the deck's, not a copy of it, which is the difference between a
   window that keeps offering a card that has been sent somewhere and one that does
   not. A copy is the obvious implementation and it has no visible symptom until a
   card is acted on: it stays in the window, and the second click does nothing at
   all, silently (see docs/gotchas.md).

   What `setBatch` does with the deck is what is done here by hand - the view is
   rebuilt from the ids whenever the deck changes - because the store's own version of
   it needs a registered deck and this check has no room to register one in.

   The look batch is put away first, so that "does this card still answer" is asked of
   the reveal and not of a newer batch that happens to hold the same card.
*/
mod.look.set(null)
mod.lookView.set([])
const shownPile = { name: 'deck', get: viewOf, subscribe: (fn) => { fn(viewOf()); return () => {} } }
mod.reveal.set({ owner: 'mine', senderIsMe: true, ownerHere: 'mine', pileName: 'deck', pile: shownPile, cards: shownIds })
mod.revealView.set(viewOf())
mod.revealOpen.set(true)

const shown = viewOf()[1]
check('a card is on show while it is still in the deck',
   mod.revealView.get().includes(shown) && mod.isActionable(shown, shownPile))

farDeck.splice(farDeck.indexOf(shown), 1)
mod.revealView.set(viewOf())
check('and leaves the window the moment it is moved out of the deck',
   !mod.revealView.get().includes(shown),
   `${mod.revealView.get().length} of ${shownIds.length} still on show`)
check('and stops answering clicks with it', !mod.isActionable(shown, shownPile))

mod.resetRevealState()
check('and nothing is actionable once the board is cleared',
   !mod.isActionable(shown, shownPile) && !mod.isActionable(farDeck[0], shownPile))

/*
   **A card of theirs that goes into a shared zone stays theirs.**

   The Stadium and the Table are the two zones the halves meet in, and each *half* keeps
   its own list for them - so "whose card is it" is answered by which list it lands in.
   Two rules hold that together, and both are read here rather than clicked because each is
   one line in a store:

      - the optimistic move puts it in the **far half's** list (`oppSTADIUM`, the mirror's
        own pile), never in the player's
      - the mirror's `stadiumPlayed` does not add the card a second time when the acting
        board already put it there, which is the seam `dedupeSlot` closes for the Bench

   Without the first, a player would be playing somebody else's card as their own; without
   the second, the shared cell draws the same card twice.
*/
const oppActionForShared = readFileSync(join(src, 'lib', 'stores', 'oppAction.js'), 'utf8')
const opponentForShared = readFileSync(join(src, 'lib', 'stores', 'opponent.js'), 'utf8')
check('and a card of theirs sent to a shared zone goes into THEIR half\'s list',
   /case OPP_ACTIONS\.STADIUM:[\s\S]{0,200}?oppPile\(/.test(oppActionForShared) ||
      /case OPP_ACTIONS\.TABLE:[\s\S]{0,400}?oppPile\(/.test(oppActionForShared),
   'the optimistic move targets the mirror\'s own pile, not this board\'s')
check('and the owner\'s own event does not add it to the shared cell a second time',
   /if \(!stadium\.get\(\)\.some\(\(c\) => c\._id === card\._id\)\) stadium\.push\(card\)/.test(opponentForShared),
   'the mirror dedupes the card the acting board already placed')

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
/*
   *View Top X* is the name the **Look** entry wears on the opponent's deck (renamed from
   *Look at Top X* so the two decks' menus read the same way). The player's own deck has a
   *`View Top X` too, and it is a different entry: that one is the search - look at the top
   of my own deck and pick from it - and it is the one the keyboard shortcut opens. So what
   must not appear on the player's own deck is a *second* one, which is what the Look entry
   would be if it were written here: the assertion is about the count, not the word.
*/
const ownViewTop = (ownDeckSource.match(/text="View Top X"/g) || []).length
check('and no second View Top X beside the search: the player can read their own deck',
   ownViewTop === 1, `${ownViewTop} entries reading "View Top X"`)
/*
   The opponent's deck offers all four of the entries that act on a deck this player
   cannot read, and each is a *request* to its owner rather than a local move: Reveal and
   View show the cards, and the two discards take them off the top. `View Top X` is the
   name the Look entry wears here, because *View Top X* already means "look at the top of
   my own deck" one menu over and two entries that read the same are two entries a player
   cannot tell apart.
*/
check('and the opponent\'s deck offers Reveal, View and both discards',
   /text="Reveal Top X"/.test(oppDeckSource)
      && /text="View Top X"/.test(oppDeckSource)
      && /text="Discard Top Card"/.test(oppDeckSource)
      && /text="Discard Top X"/.test(oppDeckSource))
check('and every one of them is a request to the deck\'s owner',
   /discardTopOfTheirDeck/.test(oppDeckSource) && /discardTopOfTheirDeck/.test(oppActionSource))
check('and the player\'s own deck offers Discard Top X under Discard Top Card',
   /text="Discard Top Card"[\s\S]*?text="Discard Top X"/.test(ownDeckSource))
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
   /if \(!list\.length \|\| !list\.every\(\(card\) => canActOn\(card, options\.pile\)\)\) return false/.test(oppActionSource),
   'a selection with one card that does not answer is refused whole, and the pile it came with is part of the question')
check('and the owner is the one who performs the move',
   /react\('oppCardAction'/.test(oppActionSource) && /respondToOpponentCardAction/.test(oppActionSource))

/*
   **A ping, which is the entry that used to be *Declare Target*.** It moves nothing and
   nobody answers it, so the two things worth asking are both rules rather than renderings:

      - **what the line says.** A card this player was *shown* is named, and one they were
        not is not: a mirror is handed the names of the other player's hidden cards as part
        of the board state, so every card on the far half has a name here and printing the
        wrong one is a leak rather than a typo. It is what makes the entry exist on the
        opponent's hand and prizes at all.
      - **who may ping.** A spectator is refused, and so is solo, where both halves are one
        person's and there is nobody to point at. The refusal is at the store, so every menu
        entry that offers a ping inherits it rather than repeating it.
      - **which card the glow is on.** The one that was pinged, and *not* the card of the
        player's own that shares its id: both boards number their cards from 1, so an id on
        its own names two cards on one screen, one on each half. That is the rule
        `pingedCard` states, and it is asked here with one id and two halves because it is
        the half of this that no rendering would have shown anyone as wrong.

   The naming rule is asked of `pingLine` rather than read off the source because it can be:
   it is a function of the card and the flag and nothing else. The rest is asserted where it
   has to be - the source of the entries and of the relay's allow-list, and the six
   components that draw a card, since a class binding on a card is not something a render to
   a string can see.
*/
check('and a ping names the card the player was shown',
   mod.pingLine({ name: 'Pikachu' }, true) === 'Ping: Pikachu')
check('and a card they were not shown is pinged as a hidden card, never named',
   mod.pingLine({ name: 'Pikachu' }, false) === 'Ping: Hidden card',
   'the mirror holds the name of every hidden card and must not print one')

mod.spectating.set(true)
check('and a spectator cannot ping',
   mod.pingCard({ _id: 4242, name: 'Their Card' }, true) === false)
mod.spectating.set(false)

mod.solo.set(true)
check('and neither can solo, where both halves are one person\'s',
   mod.pingCard({ _id: 4242, name: 'Their Card' }, true) === false)
mod.solo.set(false)

const theirCard = { _id: 4242, name: 'Their Card' }
check('and a player\'s ping goes out', mod.pingCard(theirCard, true) === true)
/*
   The glow is a store holding the card and the half it is on, and it is set on the next
   task rather than at once - that is what makes a second ping of the same card restart the
   animation instead of leaving the one already running to finish. So it is empty in the
   same turn and the card one task later, which is what is measured here.

   `'far'` is the half a *sent* ping is on: the entry is offered on the other player's cards
   and never on the player's own, so the card a player pings is one this board draws as its
   far half.
*/
check('and it is not on the card until the next task, so a repeat restarts it',
   get(mod.pinged) === null, `pinged = ${JSON.stringify(get(mod.pinged))}`)
await new Promise((resolve) => setTimeout(resolve, 0))
check('and the card the glow is drawn on is the one that was pinged, on the far half',
   get(mod.pinged)?.id === theirCard._id && get(mod.pinged)?.half === 'far',
   `pinged = ${JSON.stringify(get(mod.pinged))}`)

const shared = 7
check('and a ping lights one card, not the same id on the other half',
   mod.pingedCard({ id: shared, half: 'far' }, { _id: shared }, 'far') === true &&
   mod.pingedCard({ id: shared, half: 'far' }, { _id: shared }, 'near') === false &&
   mod.pingedCard({ id: shared, half: 'near' }, { _id: shared }, 'near') === true &&
   mod.pingedCard({ id: shared, half: 'near' }, { _id: shared }, 'far') === false,
   'both boards number their cards from 1, so the same id names a card of each half')

const pingSource = readFileSync(join(src, 'lib', 'stores', 'ping.js'), 'utf8')
const oppSlotMenuSource = readFileSync(join(src, 'lib', 'play', 'dialogs', 'OppSlotMenu.svelte'), 'utf8')
const oppTempSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Temp.svelte'), 'utf8')
const relayEventSource = readFileSync(join(src, 'routes', 'api', 'relay', 'events', '+server.js'), 'utf8')

check('and the slot menu offers Ping Card rather than a declared target',
   /text="Ping Card"/.test(oppSlotMenuSource) && !/text="Declare Target"/.test(oppSlotMenuSource),
   'the entry was repurposed, so the words it used to wear are gone from the menu')
check('and the relay carries a ping, which is what the other board\'s glow arrives on',
   /'cardPinged'/.test(relayEventSource) && /react\('cardPinged'/.test(pingSource),
   'a glow is about which card, so it cannot ride the log line')
/*
   **Which zones a ping is offered on, and the half of that rule which is easy to lose.**
   The component that draws a card of theirs draws two things: a card lying in one of their
   zones, and every card of one of their *piles* opened as a view (`OppInspection.svelte`) -
   the deck, the discard and the lost zone, which are exactly the three a ping is not for.
   So the pile is asked, and the marker is on the four zones that take one.
*/
check('and only a zone a ping belongs on may be pinged',
   /Object\.defineProperty\(zone, 'pingable'/.test(opponentForShared) &&
   /for \(const zone of \[ b\.hand, b\.prizes, b\.stadium, b\.table \]\)/.test(opponentForShared) &&
   /if \(!pile\.pingable\) return/.test(oppCardSource),
   'the deck, the discard and the lost zone are piles, and a view of one draws every card of it')
check('and a card of theirs on the board opens the ping menu in a room',
   /if \(!\$solo && !actionable\) \{/.test(oppCardSource) &&
   /openOppCardPingMenu\(e\.clientX, e\.clientY, card, revealed, pile\)/.test(oppCardSource))
check('and so does a card of theirs on the table',
   /openOppCardPingMenu\(e\.clientX, e\.clientY, card, true, table\)/.test(oppTempSource))

/*
   **And the one entry a card of theirs carries besides the ping: *Reveal Hand*, on the
   cards of their hand.**

   A Reveal Hand shows the whole of the hand, so *which* card of it was right-clicked makes
   no difference to what happens - which is why the entry is offered on each card of the hand
   as well as on the zone, and why both routes take the same `revealHand` rather than two
   implementations that have to agree. What keeps it off the cards of their other zones is a
   marker on the pile (`theirHand`), asked the way `pingable` is asked one screen up: this
   component draws a card of the hand, a card of the prizes and a card of a *view* alike, and
   only one of those has a hand behind it.

   The marker is asked of the mirror the app really builds rather than read off the source,
   because that is the half a source check cannot see: the marker is *per instance*, so a
   spectator's mirror answers for itself, and a non-enumerable property is not one that a
   spread or a `JSON.stringify` of a pile could carry off the board. The menu's own entries
   are behind an `isOpen` a server render never sets, so those two are read from the source -
   and the behaviour, a right click on a card of the hand opening the window, is
   `tools/reveal-check.mjs`'s.
*/
const oppCardPingMenuSource = readFileSync(join(src, 'lib', 'play', 'dialogs', 'OppCardPingMenu.svelte'), 'utf8')

check('and the far half\'s hand is marked as the pile a Reveal Hand is about',
   mod.defaultOpponent.hand.theirHand === true &&
   [ mod.defaultOpponent.prizes, mod.defaultOpponent.stadium, mod.defaultOpponent.table ]
      .every((zone) => zone.theirHand === undefined) &&
   mod.hand.theirHand === undefined,
   'the hand alone, so the entry cannot turn up on the prizes, the table or the player\'s own hand')
check('and the marker is not enumerable, so a copy of the pile cannot carry it anywhere',
   !Object.keys(mod.defaultOpponent.hand).includes('theirHand'),
   'the marker is defined the way `theirPile` and `pingable` are defined, in opponent.js')
check('and the menu offers Reveal Hand only for a card drawn with that pile',
   /\{#if pile\?\.theirHand\}/.test(oppCardPingMenuSource) &&
   /<ContextMenuOption click=\{revealTheirHand\} text="Reveal Hand" disabled=\{!canReveal\(\)\} \/>/.test(oppCardPingMenuSource) &&
   /function revealTheirHand \(\) \{\s*revealHand\(\)/.test(oppCardPingMenuSource),
   'and it calls the store\'s own gesture rather than a second copy of it')
check('and the pile travels with the card, or the menu cannot ask which zone it is in',
   /function openOppCardPingMenu \(x, y, card, revealed = true, pile = null\)/.test(boardSource) &&
   /oppCardPingMenu\.open\(x, y, card, revealed, pile\)/.test(boardSource) &&
   /export function open \(x, y, _card, _revealed = true, _pile = null\)/.test(oppCardPingMenuSource),
   'the third menu a card of theirs opens now answers for the pile it was opened over')

/*
   The six components that draw a card, and each one's half of `pingedCard`: a player's own
   card is what a ping *receives* (the far half's components send it). A component that
   asked for the wrong half is the fault this list exists for, and it has no symptom a
   render could show - the class binding is markup.
*/
/* the binding a card of that half has to wear, `pingedCard`'s own two arguments and all */
const glowIn = (half) => new RegExp(`class:pinged=\\{pingedCard\\(\\$pinged, [^,]+, '${half}'\\)\\}`)

const glowless = [
   [ 'the player\'s cards', join(src, 'lib', 'play', 'board', 'Card.svelte'), 'near' ],
   [ 'the player\'s Pokemon', join(src, 'lib', 'play', 'board', 'Slot.svelte'), 'near' ],
   [ 'the player\'s table', join(src, 'lib', 'play', 'board', 'Temp.svelte'), 'near' ],
   [ 'the far half\'s cards', join(src, 'lib', 'play', 'opponent', 'Card.svelte'), 'far' ],
   [ 'the far half\'s Pokemon', join(src, 'lib', 'play', 'opponent', 'Slot.svelte'), 'far' ],
   [ 'the far half\'s table', join(src, 'lib', 'play', 'opponent', 'Temp.svelte'), 'far' ]
].filter(([ , file, half ]) => !glowIn(half).test(readFileSync(file, 'utf8')))

check('and every component that draws a card of a pingable zone wears the glow, on its own half',
   glowless.length === 0,
   glowless.length ? `missing: ${glowless.map(([ what ]) => what).join(', ')}` : 'all six')

/*
   **And the cards under a Pokemon in play, which are cards of theirs too.** An energy or a
   tool attached to a Pokemon is drawn by the same component as the Pokemon, so each one
   needs a binding of its own - three per half, the Pokemon and the two fans - and a right
   click on one of them has to stop at that card rather than letting the slot's menu open
   over it (which would make the ping about the Pokemon again).
*/
const oppSlotSource = readFileSync(join(src, 'lib', 'play', 'opponent', 'Slot.svelte'), 'utf8')
const glowCount = (file, half) => (readFileSync(file, 'utf8')
   .match(new RegExp(`class:pinged=\\{pingedCard\\(\\$pinged, (?:top|nrg|tool), '${half}'\\)\\}`, 'g')) || []).length

check('and the cards attached under a Pokemon wear it on both halves',
   glowCount(join(src, 'lib', 'play', 'board', 'Slot.svelte'), 'near') === 3 &&
   glowCount(join(src, 'lib', 'play', 'opponent', 'Slot.svelte'), 'far') === 3,
   'the Pokemon, its energy and its tools are four cards that can be pinged, and each has its own binding')
check('and a card attached under their Pokemon is pinged as its own card',
   bodyOf(oppSlotSource, 'onCardCtx').includes('openOppCardPingMenu(e.clientX, e.clientY, card, true, pile)') &&
   /function onCardCtx[\s\S]{0,400}?e\.stopPropagation\(\)/.test(oppSlotSource),
   'the click stops at that card, or the slot menu opens over it and the ping is about the Pokemon')

/*
   **The room's opening dialog, in the states it has.** It is a *lock* before it is a dialog: it is
   up from the moment a room has two players in it, before either has pressed *Game Setup*, and it
   carries the toss and the choice after that. The one state it is *not* drawn in is outside a room
   at all, and that case has its own check below - it is the one it was wrong in.

   The phases are put into the store directly, which is the state the relay's own events leave
   behind. `seatedPlayers` and `myId` are set the same way, because *who* the dialog is talking to
   is the whole of what it branches on - and without a seat nobody is the caller, so every state
   draws the waiting half of the dialog and the buttons are never reached.
*/
const rendersNothing = (label, Component, { props = {}, context = undefined } = {}) => {
   try {
      const out = Component.render(props, { context })
      const html = out?.body ?? out?.html ?? ''
      check(label, html.trim() === '', `${html.length} chars`)
      return html
   } catch (err) {
      check(label, false, `${err.name}: ${err.message}`)
      return null
   }
}
const setupState = (over) => ({
   phase: 'coin',
   chooser: null,
   winner: null,
   you: { chooser: null, winner: null },
   call: null,
   result: null,
   order: null,
   first: null,
   ready: [],
   ...over
})

/* the two seats a room has, and this board's player in the first of them */
mod.seatedPlayers.set([ { id: 'me', name: 'Alice' }, { id: 'them', name: 'Bob' } ])
mod.myId.set('me')

/*
   **And it draws nothing outside a room**, which is the state it was wrong in: the phase is `idle`
   on a board that has never been anywhere, so a lock drawn on the phase alone covered the **main
   menu** - reported as *"Seeing Setting up the game when I load into the main menu"*, over the logo
   and the Play Solo button. The seats are still set here on purpose: leaving a room clears them
   *and* the room, so a case that cleared both would pass with the bug still in place.
*/
mod.room.set(null)
rendersNothing('the setup dialog draws nothing on the main menu', mod.GameSetupDialog)

mod.room.set('ABCDEF')

/*
   The lock, for a player who **has** imported and is waiting on the other one.

   That precondition is the whole of the state, and it is set explicitly rather than left to
   whatever an earlier section put on the board: the lock waits on this player's own deck (see
   `imported` in the dialog), because a lock drawn over the Import Deck window is a window that
   cannot be clicked - and a case that happened to pass with no deck on the board would be passing
   by drawing *nothing*, which is not what it means to check.

   **It is not a prompt**: the opening starts by itself the moment the second deck lands, so there
   is nothing here to press and the wording is the whole of what it is for - which is what was wrong
   with it before, when it asked for a press that the room no longer needed.
*/
mod.setDeck([ { name: 'Pikachu', stage: 'basic' } ])
mod.gameSetup.set(setupState({ phase: 'idle' }))
const lockedDialog = renders('the setup dialog renders the lock', mod.GameSetupDialog)
check('and it says the game is being set up',
   Boolean(lockedDialog) && lockedDialog.includes('Setting up the game'))
check('and asks for a deck from each of them',
   Boolean(lockedDialog) && lockedDialog.includes('Both players need to import a deck before the game can begin'),
   'the wording is the request, because there is no button to press')
check('and it offers nothing to press about the opening itself',
   Boolean(lockedDialog) && !/>Game Setup</.test(lockedDialog) &&
   (lockedDialog.match(/<button/g) || []).length === 1 &&
   lockedDialog.includes('aria-label="Copy room code"'),
   'the opening is not gated on a press; the one button here is the room code\'s, which is not about the opening')
/*
   **And the room's code is on it, which is the point of the one button.**

   This dialog is `position: fixed; inset: 0` at `z-index: 46`, so the code and its copy button in
   the panel beside the board are behind it - and setting a game up is exactly when a player wants
   to pass the code on. Reported from play as *"during game setup the game room code cannot be
   copied"*. It is drawn by `components/RoomCode.svelte`, which is why the same assertion holds for
   the Import Deck window (see the note in that component).
*/
check('and the room\'s code is on it, with something to copy it',
   Boolean(lockedDialog) && lockedDialog.includes('Room code') && lockedDialog.includes('ABCDEF'),
   'the code in the panel is behind this dialog, and this is the stretch of a game where it is wanted')

/*
   **And it stays down while this player still has to import.** That is the reported fault: the lock
   is over the Import Deck window (`z-index: 46` against `45`), so drawing it before a deck has
   landed takes that window's buttons and its textarea with it - *"player is still unable to import
   the deck"*, with the window visible underneath.
*/
mod.setDeck([])
rendersNothing('the setup dialog draws nothing while this player still has to import', mod.GameSetupDialog)
mod.setDeck([ { name: 'Pikachu', stage: 'basic' } ])

/*
   **And it goes the moment the order is settled.** `deal` is the two boards dealing and `live` is
   the game under way; neither is a question, so neither carries a dialog - and a lock left over
   either of them is a board that never becomes playable, which is the other half of the import
   lock being right.
*/
mod.gameSetup.set(setupState({ phase: 'deal', chooser: 'me', winner: 'me', order: 'first' }))
rendersNothing('the setup dialog draws nothing once the boards deal', mod.GameSetupDialog)

mod.gameSetup.set(setupState({ phase: 'live', chooser: 'me', winner: 'me', order: 'first' }))
rendersNothing('the setup dialog draws nothing once the game is live', mod.GameSetupDialog)

mod.gameSetup.set(setupState({ chooser: 'me', you: { chooser: 'you', winner: null } }))

const coinDialog = renders('the setup dialog renders the toss', mod.GameSetupDialog)
check('and it names what is being decided',
   Boolean(coinDialog) && coinDialog.includes('Determining player order'))
check('and it offers the two faces to the player who was picked',
   Boolean(coinDialog) && coinDialog.includes('>Heads</button>') && coinDialog.includes('>Tails</button>'),
   'the call is this player\'s whole part in the toss - a scoped class would sit between the label and the tag')
check('and it asks for a call rather than showing one', !coinDialog.includes('Coin flip result'))

mod.gameSetup.set(setupState({
   phase: 'order', chooser: 'me', winner: 'me', call: 'heads', result: 'heads',
   you: { chooser: 'you', winner: 'you' }
}))

const orderDialog = renders('the setup dialog renders the choice of order', mod.GameSetupDialog)
check('and it says the toss was won', Boolean(orderDialog) && orderDialog.includes('You won the toss'))
check('and it offers the two sides',
   Boolean(orderDialog) && orderDialog.includes('First') && orderDialog.includes('Second'))
check('and both sides are the same button, because both are real choices',
   /\.setup-buttons button \{[\s\S]{0,200}background: var\(--primary-color\)/.test(readFileSync(join(src, 'lib', 'play', 'dialogs', 'GameSetupDialog.svelte'), 'utf8')),
   'Second is not the leftovers of First')

/*
   And the other half of it: the player who is *not* being asked. They are told what is
   happening and given nothing to press - a dialog with buttons for both players would be two
   people answering one question.
*/
mod.gameSetup.set(setupState({ chooser: 'them', you: { chooser: 'them', winner: null } }))
const waitingDialog = renders('and it renders for the player who is waiting', mod.GameSetupDialog)
check('and that player is given nothing to press',
   Boolean(waitingDialog) && waitingDialog.includes('is calling the coin toss') && !waitingDialog.includes('Heads'))
check('and is told who is being waited on', Boolean(waitingDialog) && waitingDialog.includes('Bob'))

/* the board is left as it was found: a store left mid-setup is a game nothing can finish */
mod.gameSetup.set(setupState({ phase: 'idle' }))
mod.seatedPlayers.set([])
mod.myId.set(null)
try { mod.exitSolo() } catch {}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - something in the tree does not render, or a move it makes does not land`)
   console.log('(this is the class of failure a build and a CSS check cannot see - see docs/gotchas.md)')
   process.exit(1)
}
console.log('verdict: ok - the menu, the board in solo, the sidebar and a pile dialog all render, and a card comes out of one')
