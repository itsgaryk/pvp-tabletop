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

## Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` sets the framework preset and the install/build commands; the output directory is handled by `@sveltejs/adapter-vercel`.
2. **Attach a Redis/KV database** (see below). This is the one required step.
3. Deploy.

Node is not configured in `vercel.json` — that file has no such property, and including one makes Vercel reject the project with *"should NOT have additional property"*. The Node runtime is pinned in `svelte.config.js` instead (`runtime: 'nodejs20.x'`), because `@sveltejs/adapter-vercel` only auto-detects Node 16/18/20.

### Why a database is required

Vercel runs each request in its own function instance, and two players will not reliably be sent to the same one. Any in-process state therefore disappears between requests, so rooms live in Redis. Without it the relay returns a clear error and the UI shows *"Game relay unavailable"* rather than failing silently.

Add a KV/Redis store from **Vercel → Storage** (Upstash Redis is the common
choice and has a free tier). The integration injects the credentials as
environment variables, which is all the relay needs — it reads, in order:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN`
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
- `REDIS_REST_API_URL` + `REDIS_REST_API_TOKEN`

Redeploy after attaching it so the variables are present at build/run time.

### Environment variables

All are **optional** and all are **client-side** except the Redis ones. Vite
inlines the `VITE_*` values into the JavaScript during `npm run build`, so they
must never hold secrets and changing one requires a redeploy.

| Variable | What it controls | Default |
| --- | --- | --- |
| `VITE_PVP_SERVER` | Base URL for the relay. Leave unset to use the relay in this same project (`/api/relay`). Set it only to serve the relay from another origin, which must implement the same three routes. | unset (same origin) |
| `VITE_LIMITLESS_WEB` | Limitless TCG API used by "Import Deck" / "Import Random Deck". | `https://limitlesstcg.com` |
| `VITE_ENV` | `dev` logs every relayed event to the browser console. | `dev` locally, `prod` in a build |
| `RELAY_POLL_WAIT_MS` | Server-side long-poll window in ms. Larger = fewer requests but more billed function time. | `20000` |
| `RELAY_POLL_INTERVAL_MS` | How often a waiting poll re-reads the room's event cursor, in ms. This is the relay's main cost dial: the store sees one cheap read per turn. Larger = fewer store commands, at the price of up to that long before an opponent's move appears. | `400` |

Do not confuse the `VITE_*` names with Vercel's own system variables
(`VERCEL_URL`, `VERCEL_ENV`, …), which Vercel lists in the same screen.

## How the relay works

`src/routes/api/relay/` holds three routes, and `src/lib/relay/client.js` is the
transport the browser uses:

| Route | Purpose |
| --- | --- |
| `POST /api/relay/room` | create / join / leave a room |
| `POST /api/relay/events` | append one event to a room's log |
| `GET /api/relay/poll` | long poll for events after a cursor |
| `GET /api/relay/health` | is a room store configured? |

A room is a single document: an ordered event log plus its two members. Events
are stamped with a room-wide sequence number and timestamp, so both players
agree on ordering. A client keeps a cursor, and `poll` holds the request open
(up to `RELAY_POLL_WAIT_MS`) until something new appears.

The client aborts its outstanding poll whenever it sends, so a move normally
lands in milliseconds and the long-poll window only expires while the board is
idle. `connection.js` exposes the same `socket.on/off/emit` surface the rest of
the app was already written against, so gameplay code is unaware of the
transport.

While a poll waits it reads **one key** - the room's event cursor - per turn, and
only reads the rest of the room when that cursor moves. Members live in a single
hash, so a poll fetches them with one `HGETALL` and nothing ever runs `KEYS` over
the keyspace. On a metered Redis (Upstash bills per command) that is what keeps an
idle client near one command per poll turn instead of four.

Rooms expire 6 hours after their last event, and each room keeps its most recent
400 events.

## Server (optional, self-hosted)

`VITE_PVP_SERVER` predates the in-project relay: it can point at a relay you run
elsewhere. Note this is **not** a socket.io client any more — the client speaks
HTTP long polling against `/api/relay/*`, so an alternative host has to serve
those same routes. The relay code in `src/routes/api/relay` and the store
adapters in `src/lib/relay/store.js` are plain functions and can be mounted in
any Node HTTP framework.

If you specifically want to go back to socket.io, the original server is
[here](https://gist.github.com/link--11/b568ca86faca5dd9cf0017927d90451d), but
that needs a host that keeps a process alive (Vercel Functions pin each
websocket to one instance and cannot broadcast between them, so socket.io rooms
do not work there without a pub/sub adapter).

## Project layout notes

- `src/routes/+page.svelte` opts into `prerender = true`; the root layout sets
  `prerender = false` so the `api/relay` routes stay dynamic.
- `vercel.json` holds the framework preset only — the output directory comes
  from the adapter's Build Output.
- Gameplay code talks to `share()` / `react()` in `src/lib/stores/connection.js`
  and never touches the transport directly.
