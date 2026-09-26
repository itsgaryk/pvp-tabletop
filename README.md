2-player version of the Pokémon TCG tabletop app.
Built with Svelte 4 + SvelteKit.

The app and the game relay both live in this repository, so a single Vercel
deployment serves the board *and* passes moves between the two players.

## Getting Started

```sh
npm ci
npm run dev
```

The dev server runs the relay too, so two browser tabs can play each other with
no configuration — no `.env` file is needed. Copy `.env.example` to `.env` if
you want to override anything.

`npm run build` produces a Vercel Build Output; `npm run preview` is not useful
here because the relay needs the dev server or a real deployment.

## Deploying

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. **Attach a Redis/KV database.** This is the one required step, and the one
   that can be got wrong: Vercel runs each request in its own function instance,
   so rooms live in the store rather than in the process.
3. Deploy, then check `GET /api/relay/health`.

The rest of it — why a database is required, what that endpoint answers with and
without `?probe=1`, every environment variable, and running a relay of your own
— is in **[docs/deployment.md](docs/deployment.md)**.

## Documentation

The technical documentation is in [`docs/`](docs/), one file per topic:

| Document | What it covers |
| --- | --- |
| [deployment.md](docs/deployment.md) | Vercel setup, the KV/Redis requirement, the health endpoint and its probe, the environment-variable table, self-hosting a relay |
| [rooms.md](docs/rooms.md) | A room's life: reconnecting, leaving, the two waits, a deploy ending the games it replaces, the idle prompt and the stale-member sweep |
| [relay.md](docs/relay.md) | The three relay routes, the event log and its cursor, what a waiting poll costs, and what a burst costs |
| [multiplayer-transport.md](docs/multiplayer-transport.md) | What the relay costs per game, whether WebSockets would be better, what the Vercel Marketplace offers instead, and why the store stays |
| [timer.md](docs/timer.md) | The table clock, and how two different clocks are kept together |
| [board.md](docs/board.md) | The grid and its zones, the Stadium, zone borders and names, flipping the board, spectating, the keyboard shortcuts, what the browser remembers |
| [selection.md](docs/selection.md) | The selection: what it is, what a selected card glows with, and the rules a zone follows to draw it |
| [reveal.md](docs/reveal.md) | Reveal and Look: showing cards out of a deck to both players or to one, the window each opens, and the "allowed to take action on this opponent card" property |
| [terminology.md](docs/terminology.md) | The four vocabularies a zone is named in (store, grid area, wire, log), the `play` homonym, and the conventions that are not names |
| [card-sizing.md](docs/card-sizing.md) | A card on the board is the size of the zone it is in |
| [solo.md](docs/solo.md) | Play Solo, and why the two halves are separate boards |
| [diagnostics.md](docs/diagnostics.md) | The command-line checks, the diagnostics panel, and the failures that used to be silent |
| [gotchas.md](docs/gotchas.md) | Things that cost somebody an afternoon |
| [development.md](docs/development.md) | Project layout notes, and which module is allowed to import which |

`node tools/docs-check.mjs` checks that every link between these files resolves.

## Verifying a change

CI runs `tools/relay-check.mjs` against a dev server started with second-scale
idle windows, then `npm run build` — the same command Vercel runs — plus the two
checks that need nothing but the tree: `tools/docs-check.mjs` and
`tools/render-check.mjs`. Everything else is a browser check run by hand, and
**`npm run check` does not run in this repository** (`svelte-check` is not one of
its dependencies), so a component can be wrong in a way only a browser shows.

`render-check.mjs` is the exception worth knowing about: it is a renderer without a
browser, so it catches a component that throws on mount — which is how the board was
once dead while the build stayed green (see [docs/gotchas.md](docs/gotchas.md)).

The tools, what each one answers, and the traps they exist for are in
[docs/diagnostics.md](docs/diagnostics.md) and [docs/gotchas.md](docs/gotchas.md).
