# Deploying to Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new). `vercel.json` sets the framework preset and the install/build commands; the output directory is handled by `@sveltejs/adapter-vercel`.
2. **Attach a Redis/KV database** (see [Why a database is required](#why-a-database-is-required)). This is the one required step.
3. Deploy.

Node is not configured in `vercel.json` — that file has no such property, and including one makes Vercel reject the project with *"should NOT have additional property"*. The Node runtime is pinned in `svelte.config.js` instead (`runtime: 'nodejs20.x'`), because `@sveltejs/adapter-vercel` only auto-detects Node 16/18/20.

## Why a database is required

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
  "checked": false, "epoch": "sha:1f2e3d4c…",
  "poll": { "waitMs": 20000, "intervalMs": 2000 },
  "idle": { "idleMs": 600000, "promptMs": 600000, "memberStaleMs": 140000 } }
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

## Environment variables

All are **optional**. The `VITE_*` ones are **client-side** and the rest are
server-side. Vite inlines the `VITE_*` values into the JavaScript during
`npm run build`, so they must never hold secrets and changing one requires a
redeploy; the others are read at request time and can be changed in the Vercel
dashboard (a new deployment is still needed, since the functions restart).

| Variable | What it controls | Default |
| --- | --- | --- |
| `VITE_PVP_SERVER` | Base URL for the relay. Leave unset to use the relay in this same project (`/api/relay`). Set it only to serve the relay from another origin, which must implement the same three routes. | unset (same origin) |
| `VITE_LIMITLESS_WEB` | Limitless TCG API used by "Import Deck" / "Import Random Deck". A browser check that needs a deck should point this at `node tools/fake-deck-api.mjs` instead: the real API is somebody else's, needs the network, and answers differently every time. | `https://limitlesstcg.com` |
| `VITE_ENV` | `dev` logs every relayed event to the browser console. | `dev` locally, `prod` in a build |
| `RELAY_POLL_WAIT_MS` | Server-side long-poll window in ms. Larger = fewer requests but more billed function time. | `20000` |
| `RELAY_POLL_INTERVAL_MS` | How often a waiting poll re-reads the room's event cursor, in ms. This is the relay's main cost dial: the store sees one cheap read per turn, per waiting client, whether or not anything happens. Larger = fewer store commands, at the price of up to that long before an opponent's or a spectator's view catches up. | `2000` |
| `RELAY_IDLE_MS` | How long a room may see no *action* before it is asked whether anybody is still playing. Presence is not action, so two people sitting on a board are idle. | `600000` (10 min) |
| `RELAY_PROMPT_MS` | How long that idle prompt waits for an answer before the room is closed. This is also the countdown the players see. | `600000` (10 min) |
| `RELAY_MEMBER_STALE_MS` | How long a member's presence may go unrefreshed before the relay stops counting them - which is what takes a killed tab out of the spectator count, and what starts the rejoin wait for a player. | 4 poll windows + 60s |
| `RELAY_HOST_WAIT_MS` | How long a newly created room waits for a second player before it closes itself. Only applies to a room nobody ever joined. | `600000` (10 min) |
| `RELAY_REJOIN_WAIT_MS` | How long a game whose player vanished without leaving waits for them to come back before it closes. | `900000` (15 min) |

The timing variables are environment variables rather than constants so the
behaviour can be verified in seconds instead of tens of minutes; set them to a
few seconds and the whole idle lifecycle happens while you watch.

Do not confuse the `VITE_*` names with Vercel's own system variables
(`VERCEL_URL`, `VERCEL_ENV`, …), which Vercel lists in the same screen.

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
