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
import { join } from 'node:path'
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

writeFileSync(entry, `
   import { solo, startSolo, exitSolo } from '${p('lib/stores/solo.js')}'
   import { room } from '${p('lib/stores/connection.js')}'
   import Board from '${p('lib/play/Board.svelte')}'
   import Connection from '${p('routes/Connection.svelte')}'
   import Page from '${p('routes/+page.svelte')}'
   export { solo, startSolo, exitSolo, room, Board, Connection, Page }
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
function renders (label, Component) {
   try {
      const out = Component.render({})
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

try { mod.exitSolo() } catch {}

console.log('')
if (failures) {
   console.log(`verdict: ${failures} failed - the board does not render, so the app is dead on arrival`)
   console.log('(this is the class of failure a build and a CSS check cannot see - see docs/gotchas.md)')
   process.exit(1)
}
console.log('verdict: ok - the menu, the board in solo and the sidebar all render')
