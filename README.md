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

A marketplace integration installed with a **custom prefix** renames both
variables to `<prefix>_URL` and `<prefix>_TOKEN`. Rather than make you match the
app's expectations, the relay falls back to finding a pair by shape: any
`..._URL` variable holding an `http(s)` URL that has a matching `..._TOKEN`
beside it, preferring names mentioning redis, rest or kv and ignoring anything
`PUBLIC` (a public URL is never a credential). So the prefix can be whatever you
like.

Redeploy after attaching it so the variables are present at build/run time, then
check `GET /api/relay/health`:

```json
{ "ok": true, "relay": true, "store": "redis-rest", "from": "pvptabletop_URL",
  "checked": false, "poll": { "waitMs": 20000, "intervalMs": 2000 } }
```

`from` names the variable the store came from (the name is not a secret; the
token never leaves the server), which makes a mis-named or missing integration
obvious — `ok: false` means no store was found at all. By itself this request
makes **no store command**: nobody should spend one by looking at the lobby.

Add `?probe=1` to make it ask the store a question — a write of a key that
expires by itself, because a database over its quota still answers reads and
refuses writes, so a read-only probe would call it healthy while every room
action failed:

```
GET /api/relay/health?probe=1
{ "ok": false, "checked": true, "store": "redis-rest", "from": "KV_REST_API_URL",
  "error": "redis SET failed: 400 … max requests limit exceeded …",
  "hint": "The database is configured but not answering - check its quota and status in Vercel → Storage." }
```

### Reconnecting, and idle boards

The browser remembers the room and its seat in `localStorage` (`pvp_session`), so
a reload — or a crash, or a laptop lid — lands back in the same game as the same
member: the relay knows that member id and hands back the same seat and role,
rather than seating somebody new or refusing a player their own seat because the
room still counts them as sitting in it. The board itself is rebuilt from the
room's event log, which the poll replays. Leaving a room, or finding it gone,
forgets the session.

A member id is the only thing identifying a player, so treat the room code plus
that id as the credential they are: anyone holding both can act as that player.
That is the same trust model as the room code itself.

After ten minutes with nothing happening — no action of your own, no news from
the other side, no click or key — the board drops to a lazy check (every 30s
instead of every 2s) and says so on screen, with a **Reconnect** button. Any
input, or a message from the other side, puts it straight back on the normal
beat, so a board the opponent is playing on is never slow.

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
| `RELAY_POLL_INTERVAL_MS` | How often a waiting poll re-reads the room's event cursor, in ms. This is the relay's main cost dial: the store sees one cheap read per turn, per waiting client, whether or not anything happens. Larger = fewer store commands, at the price of up to that long before an opponent's or a spectator's view catches up. | `2000` |

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

### The game timer

Under the turn row, and only in a room: a table clock both players can start,
pause and add to (+1, +10, +50 minutes), shown as `MM:SS`, or `HH:MM:SS` once
there is an hour or more. A spectator sees the clock and none of the buttons.

It is shared as a **value**, not a tick: "this many milliseconds left as of this
timestamp". Every client counts down from that itself, so a running clock costs
**no store commands at all** — only starting, pausing and adding time are events.
The timestamp is the relay's clock, learned from each poll, so a spectator who
joins halfway through works out the right amount left from the event history
rather than starting the count again.

Crossing fifteen minutes makes the clock glow briefly (a clock *set* below
fifteen does not — the glow is for passing the mark). At zero it stops, the words
*Time on the Round!* cross the screen once, and the host writes a single line to
the game log.

### Solo mode

**Play Solo** on the front panel starts a game against yourself: no room, no code
and no chat, and because there is no relay involved it costs **no store commands
at all** — the browser's socket is never connected. Leaving goes back to the front
panel.

Both halves of the board are yours, so the second one is playable the same way
the first is:

- **Edit Deck 2**, beside **Edit Deck**, gives the opponent's half its own deck
  (the same decklist panel, the same import).
- **Setup** sets up both sides — shuffle, seven cards, six prizes each.
- The opponent's hand is face up, and its piles have menus: draw from their deck
  (Draw, Draw X, Draw 7, Shuffle), put the top card of their hand into their
  Active or onto their Bench, attach it to their Active, discard it or shuffle it
  back in.
- Their Pokémon keep the usual menu (damage, status, target) plus, in solo, move
  it to the Bench or the Active spot, or send it and everything under it to their
  discard.

Rooms expire 6 hours after their last event, and each room keeps its most recent
400 events.

### Measuring what the relay costs

Redis commands are spent by boards **sitting still**, not by moves: a waiting poll
asks the store whether anything happened once per turn, so an open tab costs
commands per second whether or not anyone is playing. Two tools make that
visible without spending anything on a real database:

```sh
node tools/fake-redis.mjs                        # a stand-in for Upstash's REST API, counting commands
KV_REST_API_URL=http://127.0.0.1:6390 \
KV_REST_API_TOKEN=local npm run dev              # point the app at it
node tools/poll-cost.mjs                         # one idle poll, and what it cost
```

`curl localhost:6390/__stats` shows the running total and a per-command
breakdown; `__keys` shows what is stored and `__reset` zeroes the counters. A
healthy relay never calls `KEYS`.

For reference, one idle client at the default settings costs about **0.85
commands/second** (roughly 3,000 an hour): one cursor read every two seconds,
plus a presence write and one room read per poll. `GET /api/relay/health` reports
the settings a deployment is running with, so a change in the dashboard is
visible from outside:

```json
{ "ok": true, "relay": true, "store": "redis-rest", "from": "KV_REST_API_URL",
  "poll": { "waitMs": 20000, "intervalMs": 2000 } }
```

A tab nobody is looking at costs far less. While the document is hidden the
client asks the server to check its cursor every 20s instead of on the default
beat, and re-polls the moment the tab is looked at again, so the board is up to
date by the time it is read. Measured: **~0.27 commands/second** hidden against
~1.7 visible at the old one-second default, with presence still kept fresh and a
missed event on screen within milliseconds of
regaining focus.

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
