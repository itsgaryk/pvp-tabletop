/*
   The room's opening, asked of the real stores rather than read off the source.

   node tools/game-setup-rule-check.mjs
   node tools/game-setup-rule-check.mjs --quiet

   `tools/game-setup-check.mjs` is the *shape* of this feature - which function asks what, which
   line goes in the log, whether a step is guarded - and it answers by reading the source, so it
   needs no bundler and runs anywhere. What it cannot answer is whether any of it **runs**: a store
   whose module will not evaluate, or a rule that answers the wrong thing when it is actually
   asked.

   And that is not hypothetical here. `gameSetup.js` wires a watcher on the *seats* that calls
   `reset()`, and `reset()` writes to guards declared with `let` further down the same file. `let`
   is in its temporal dead zone from the top of a module until the line it is declared on, so a
   guard left below its first write is a `ReferenceError` **while the module is evaluating** -
   which is a 500 on every page load, in a file that reads perfectly and that every source-level
   check passes green. It is the same shape as the fault `tools/render-check.mjs` was written for.

   So this bundles the store with the real board, seat and room stores beside it and asks it the
   questions the UI asks it, in the states a room actually reaches:

      the load      the module evaluates, and the seat watcher that runs during it does not throw
      the gate      *Game Setup* is enabled on two players **and** two decks, and on nothing less
      the toss      the press picks one of the two seats and moves the room to the coin

   What it deliberately does not do is check the log lines or the phases after the toss: those are
   `game-setup-check.mjs`'s, and asking them in two tools would be two answers to keep in step.
*/

import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { compile } from 'svelte/compiler'

const quiet = process.argv.includes('--quiet')

const root = process.cwd()
const src = join(root, 'src')

/*
   Everything compiled goes under `node_modules/.cache` and every exit path removes it, for the
   reason `render-check.mjs` gives: the bundle keeps `svelte` external and imports it at run time,
   so it has to sit where node can resolve the project's own `svelte`.
*/
const work = join(root, 'node_modules', '.cache', `pvp-game-setup-rule-check-${process.pid}`)
mkdirSync(work, { recursive: true })
const cleanup = () => rmSync(work, { recursive: true, force: true })
process.on('exit', cleanup)

const p = (...parts) => join(src, ...parts).replace(/\\/g, '/')

/* the two things SvelteKit provides that a bare esbuild does not: `$lib`, and `$app/environment` */
const shimEnv = join(work, 'app-env.js')
writeFileSync(shimEnv, 'export const browser = false\nexport const dev = false\nexport const building = false\n')

const entry = join(work, 'entry.js')
const outfile = join(work, 'bundle.mjs')

writeFileSync(entry, `
   import * as setup from '${p('lib/stores/gameSetup.js')}'
   import { gameSetup, canStartSetup, resetSetup } from '${p('lib/stores/gameSetup.js')}'
   import { seatedPlayers, myId, room, spectating } from '${p('lib/stores/connection.js')}'
   import { cards } from '${p('lib/stores/player.js')}'
   import { defaultOpponent } from '${p('lib/stores/opponent.js')}'
   export { setup, gameSetup, canStartSetup, resetSetup, seatedPlayers, myId, room, spectating, cards, defaultOpponent }
`)

const svelte = {
   name: 'svelte',
   setup (b) {
      b.onResolve({ filter: /^\$lib\// }, (args) => ({ path: join(src, 'lib', args.path.slice('$lib/'.length)) }))
      b.onResolve({ filter: /^\$app\/environment$/ }, () => ({ path: shimEnv }))
      b.onLoad({ filter: /\.svelte$/ }, (args) => {
         const source = readFileSync(args.path, 'utf8')
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
   external: [ 'svelte', 'svelte/*' ],
   loader: { '.png': 'dataurl', '.webp': 'dataurl' },
   define: {
      'import.meta.env.VITE_PVP_SERVER': '""',
      'import.meta.env.VITE_LIMITLESS_WEB': '""',
      'import.meta.env.VITE_ENV': '""',
      'import.meta.env.DEV': 'false'
   },
   logLevel: 'error'
})

/*
   The browser globals the stores read, answered the way a browserless build must: no DOM, and
   local storage that is only a place to put things. A store that *needs* one of these at module
   scope is a bug this finds rather than hides.
*/
globalThis.window = undefined
globalThis.document = undefined
globalThis.localStorage = {
   store: new Map(),
   getItem (k) { return this.store.has(k) ? this.store.get(k) : null },
   setItem (k, v) { this.store.set(k, String(v)) },
   removeItem (k) { this.store.delete(k) }
}
/* no network: a relay request must not be part of loading a store */
globalThis.fetch = async () => { throw new Error('no network during a rule check') }

const mod = await import(pathToFileURL(outfile).href)

let failures = 0
const check = (label, ok, detail = '') => {
   if (!quiet) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' - ' + detail : ''}`)
   if (!ok) failures++
}

/*
   **The module loads at all**, which is the whole reason this tool exists. The seat watcher runs
   as the module is evaluated, reaches `reset()`, and `reset()` writes to guards that are `let`
   declarations further down the file: get that order wrong and the import throws, which is every
   page load answering 500 against a file that reads correctly.
*/
check('the setup store evaluates, seat watcher and all', typeof mod.canStartSetup === 'function')
check('and its module gives the flow a store to read',
   Boolean(mod.gameSetup) && typeof mod.gameSetup.get === 'function')

/* nothing to set up, in the room a board opens in */
check('and there is no setup to start in an empty room', mod.canStartSetup() === false)

/* the two seats, and this board's player in one of them */
mod.room.set('ABCDEF')
mod.spectating.set(false)
mod.seatedPlayers.set([ { id: 'me', name: 'Alice' }, { id: 'them', name: 'Bob' } ])
mod.myId.set('me')

/*
   **The gate, one term at a time.** Each of these is a state a real board sits in while a room
   fills up, and each is a different reason the button must stay grey: no deck at all, one deck,
   the opponent's deck only, and finally both.
*/
check('and none with no deck imported', mod.canStartSetup() === false)

mod.cards.set([ { name: 'Pikachu', stage: 'basic' } ])
check('and none with only this board\'s deck imported', mod.canStartSetup() === false)

mod.cards.set([])
mod.defaultOpponent.cards.set([ { name: 'Charmander', stage: 'basic' } ])
check('and none with only the opponent\'s deck imported', mod.canStartSetup() === false)

mod.cards.set([ { name: 'Pikachu', stage: 'basic' } ])
mod.defaultOpponent.cards.set([ { name: 'Charmander', stage: 'basic' } ])
check('and one with both decks imported', mod.canStartSetup() === true)

/* and a spectator's board is never offered it, however full the room is */
mod.spectating.set(true)
check('and none for a spectator, who has no deck to import', mod.canStartSetup() === false)
mod.spectating.set(false)

/*
   **One press is half of an agreement, and the toss waits for the other half.** This is the rule
   the two boards have to keep between them, and it is asked of the running store rather than read
   out of the source: the first press is recorded and stops, the second completes the pair and
   draws the caller.

   The two seats are driven by moving `myId` between them, which is what the two boards differ by -
   they share one store here because a check has one process, so "the other board" is played by
   changing whose id is looking. That is a limit of this harness rather than of the rule, and the
   browser check is where the two boards really are two.
*/
const { startSetup, callsCoin, hasPressed, bothPressed } = mod.setup

check('the first press is recorded', startSetup() === true && hasPressed() === true)
check('and does not start the toss on its own',
   mod.gameSetup.get().phase === 'idle' && bothPressed() === false,
   `phase = ${mod.gameSetup.get().phase}`)
check('and the same player cannot press again', startSetup() === false)

mod.myId.set('them')
check('the other player has not pressed', hasPressed() === false)
check('and the second press completes the pair and starts the toss',
   startSetup() === true && bothPressed() === true)

const state = mod.gameSetup.get()
check('and the room is now calling the coin', state.phase === 'coin', `phase = ${state.phase}`)
check('and the caller is one of the two seats',
   [ 'me', 'them' ].includes(state.chooser), `chooser = ${state.chooser}`)
/*
   And the pair is not re-pressed at. The list is a **union** - a client is never handed its own
   events back, so a board that reloads replays the other player's list and would otherwise lose
   its own entry and offer the button to somebody who has already pressed it - so it is still the
   two members here. What matters is that neither of them is offered the button again, which is
   what `hasPressed` answers.
*/
check('and neither player is offered the button again',
   (mod.myId.set('me'), hasPressed() === true) && (mod.myId.set('them'), hasPressed() === true))
mod.myId.set('me')
check('and the toss does not wait on the pair any longer',
   bothPressed() === true, 'both have pressed; the flow has moved on to the coin')

/* and only the player who was picked is asked to call it */
check('and the player who was picked may call it',
   (mod.myId.set(state.chooser), callsCoin() === true))
check('and the other player may not',
   (mod.myId.set(state.chooser === 'me' ? 'them' : 'me'), callsCoin() === false))
mod.myId.set('me')

/* a board that has left hangs none of this off it */
mod.resetSetup()
mod.room.set(null)
mod.seatedPlayers.set([])
mod.myId.set(null)
mod.cards.set([])
mod.defaultOpponent.cards.set([])

console.log(failures
   ? `\n${failures} check(s) failed`
   : '\nverdict: ok - the setup store loads, gates on two players and two decks, and needs both presses')
process.exit(failures ? 1 : 0)
