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
   import { room } from '${p('lib/stores/connection.js')}'
   import Board from '${p('lib/play/Board.svelte')}'
   import Connection from '${p('routes/Connection.svelte')}'
   import Page from '${p('routes/+page.svelte')}'
   import { cards, cardSelection, deck, discard, bench, draw, hand, moveSelection, resetBoard, selectCard, selectPile, toBench } from '${p('lib/stores/player.js')}'
   import InspectionView from '${join(root, 'tools', 'pile-dialog.svelte').split(sep).join('/')}'
   /* what a decklist import does: the list of cards, then the board built from it */
   const setDeck = (cards_) => { cards.set(cards_); resetBoard() }
   export { solo, startSolo, exitSolo, room, Board, Connection, Page, bench, cardSelection, deck, discard, draw, hand, moveSelection, selectCard, selectPile, setDeck, toBench, InspectionView }
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
   over the hand, so what renders here is the grid, the cards, and the row of
   actions at its foot, where a card picked out of the pile is moved to a zone.

   `Card.svelte` asks the board for its actions through a context, so the dialog
   cannot render without one. Everything a card *does* with it - the details
   dialog, the card menu - is a click, which a render to a string cannot make: the
   stub is here so the click handlers have somewhere to point, not to test them.
*/
const inspection = renders('the pile inspection dialog renders, with cards in it',
   mod.InspectionView,
   { context: new Map([ [ 'boardActions', { openDetails () {}, openCardMenu () {}, startAE () {} } ] ]) })
check('and it shows the pile as cards',
   Boolean(inspection) && (inspection.match(/class="card"/g) || []).length === get(mod.hand).length,
   `${(inspection?.match(/class="card"/g) || []).length} cards, ${get(mod.hand).length} in the pile`)
/* a pile with nothing picked out of it is not a pile to move anything out of */
check('and its moving buttons start disabled',
   Boolean(inspection) && (inspection.match(/disabled/g) || []).length === 4,
   `${(inspection?.match(/disabled/g) || []).length} disabled of 4`)
/* the same reading as the order strip: what is picked out is said, not only drawn */
check('and it says what to do with no card picked out',
   Boolean(inspection) && inspection.includes('Click a card to pick it out of the pile'))

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
   `${get(mod.cardSelection).length} picked out of ${get(mod.hand).length}`)

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
*/
const inspectionCss = readFileSync(join(src, 'lib', 'play', 'dialogs', 'Inspection.svelte'), 'utf8')
check('and the card grid is centred in it', /@apply[^;]*justify-center/.test(inspectionCss))
check('and its right-hand padding carries the panel scrollbar back',
   /padding:\s*var\(--popup-edge[^)]*\)\s+calc\(\s*var\(--popup-edge[^)]*\)\s*\+\s*var\(--popup-scrollbar\)\s*\)/.test(inspectionCss))

/*
   And the panel it is in, which is the other half of what a render cannot see: the
   inspection is laid against the window's left edge rather than centred with a
   frame around it (see `flush` in Popup.svelte). The prop is what asks for it and
   the placement is a positional rule, so neither half is in the rendered string -
   and a panel that quietly went back to being centred would read as "the padding
   came back".
*/
const popupCss = readFileSync(join(src, 'lib', 'play', 'dialogs', 'Popup.svelte'), 'utf8')
check('and the panel asks for the flush placement',
   inspectionCss.includes('<Popup bind:this={popup} {openOnMount} flush>'))
check('and flush leaves the centring translate behind',
   /\.flush\s*\{[^}]*left:\s*0[^}]*transform:\s*none/s.test(popupCss))
/*
   And the one thing neither a string nor a store can see: *which* piles the four
   buttons shuffle. A card out of a deck leaves it unknown, so the deck is shuffled;
   a discard and a lost zone are public and ordered, and shuffling one would be a
   pile quietly rearranging itself. The gate is one line, and it is the line a later
   "tidy-up" would drop.
*/
check('and only the deck is shuffled behind the cards that leave it',
   /if\s*\(\s*pile\s*===\s*deck\s*\)\s*shuffle\(\)/.test(inspectionCss))

/*
   The deck's own view, which is the panel the buttons were asked for: it is the
   one pile with something to shuffle back into, so it is the one that carries the
   second button that closes it.
*/
const deckView = renders('the deck inspection dialog renders',
   mod.InspectionView,
   {
      props: { pile: mod.deck },
      context: new Map([ [ 'boardActions', { openDetails () {}, openCardMenu () {}, startAE () {} } ] ])
   })
check('and the deck can be shuffled back on the way out',
   Boolean(deckView) && deckView.includes('Close &amp; Shuffle'))

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

try { mod.exitSolo() } catch {}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - something in the tree does not render, or a move it makes does not land`)
   console.log('(this is the class of failure a build and a CSS check cannot see - see docs/gotchas.md)')
   process.exit(1)
}
console.log('verdict: ok - the menu, the board in solo, the sidebar and a pile dialog all render, and a card comes out of one')
