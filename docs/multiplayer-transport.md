# The multiplayer transport, and whether Redis should stay

The relay ("[relay.md](relay.md)") sends moves over HTTP long polling, and rooms
live in Upstash Redis over its REST protocol. This document is the investigation
that asked whether that is still the right choice: what the relay actually costs,
whether WebSockets would be better for a turn-based browser card game, and what
the Vercel Marketplace offers instead.

**The conclusion is that the store stays.** It is recorded here rather than only
in a chat log because the question will be asked again, and because the numbers
that answer it are not obvious from the code.

## The short answer

Redis is not the problem, and WebSockets would not have fixed it.

- **One 20-minute game costs about 3,300 Redis commands** — roughly **$0.0066** at
  Upstash's $0.20 per 100K. The free tier's 500K commands a month is about
  **150 games a month** (≈5 games a day).
- Roughly **half of that is boards sitting still, and half is the event log**.
  A WebSocket replaces the first half and cannot touch the second.
- **No marketplace realtime product removes the need for a database.** Their
  message history is measured in hours; a room has to be replayable for as long
  as the game is open, and afterwards if anyone wants to read it.

The lever, if one is ever needed, is the **store** rather than the transport:
`emit` costs ten Redis commands, and the delivery mechanism is not what makes it
ten. Upstash Realtime — the same account, the same database, SSE instead of
sockets — is the option that reduces both halves at once (see
[If it ever has to change](#if-it-ever-has-to-change)).

## What the relay costs

Measured, not estimated: `tools/fake-redis.mjs` counts every command the relay
asks for, and the numbers below were taken through it at the production defaults
(`RELAY_POLL_INTERVAL_MS=2000`, `RELAY_POLL_WAIT_MS=20000`).

| What | Commands |
| --- | --- |
| One idle long poll (20s window, checked every 2s) | **15** |
| — of which: the cursor check, ten turns | 10 |
| — presence, up front | 1 |
| — assembling the reply (room meta, events, members, presence) | 4 |
| **One idle client, steady state** | **0.75/second** (2,700/hour) |
| `POST /api/relay/events` — one event, end to end | **10** |
| `appendEvent` alone (the endpoint reads the room first) | 7 |
| `POST /api/relay/room` — a join | 13 |

Two of those deserve their reasoning repeated, because both were deliberate
choices that a change could undo:

**The cursor check is one command, not four.** A waiting poll reads only
`pvp:room:<id>:seq` per turn and fetches the rest of the room only when that
number moves. Members live in one hash so the exit path is a single `HGETALL`,
and nothing anywhere runs `KEYS`. On a metered Redis that is the whole
difference between an idle client costing one command per turn and four.

**An append is ten commands and cannot be fewer.** `GET` the meta, `INCR` the
sequence (atomic, so two simultaneous sends cannot collide), `EXPIRE` it,
`LPUSH`+`LTRIM`+`EXPIRE` as one pipeline, `SET` the meta back with the activity
stamp riding in the same write, `HSET` presence. The endpoint reads the room
first to check membership, which is where the other three go.

### A caution about measuring this locally

A dev server started with the test windows (`RELAY_POLL_WAIT_MS=1500`, as
`tools/relay-check.mjs` needs) looks about **twelve times more expensive per
client** than a production one, because a poll window shorter than the 2000ms
check interval makes the loop re-read the whole room on every turn instead of
once. The `poll-cost` figures in [relay.md](relay.md#measuring-what-the-relay-costs)
are the production-shaped ones. Do not benchmark a shortened test server and
believe it.

## Where the commands actually go, and why that decides the question

For one 20-minute game between two players with about 150 events:

```
1,800 commands   boards sitting still   (55%)   <- the long poll
1,500 commands   150 events x 10       (45%)   <- the event log
-----
3,300 commands
```

That split is the finding. **A WebSocket, an SSE stream and a Durable Object all
replace the first line. None of them touches the second**, because the second is
what it costs to write one event to a store that two function instances can both
reach. Delivery is not where the money goes.

So a transport-only rewrite buys at most the 55%, and in exchange it gives up two
things the current design gets structurally right:

- **Total ordering.** The sequence comes from an atomic `INCR`, so it is
  monotonic by construction. Every realtime provider offers a weaker guarantee;
  Vercel's own guide calls Vercel Queues ordering "best-effort", with retried
  messages deprioritised below new ones.
- **Replay for free.** *Every poll is already a replay request* — it asks for
  everything after a cursor — and a joining client rebuilds the whole board from
  `res.events`. Providers offer history windows measured in hours instead.

The rest of the argument is scale. 500K commands a month is ~150 games; at a
hobby's pace that is a monthly bill of a few dollars, and the relay is a
correctness asset rather than a liability. The point at which it becomes a real
cost is around a thousand games a day (~$200/month), and that is when the
architecture — not the transport — is what needs changing.

## What is actually possible on Vercel today

Worth recording accurately, because the answer changed during this investigation
and several confident claims about it are wrong.

**Vercel Functions can serve WebSockets** — "public beta", on all plans, and
requiring Fluid compute, which is the default for projects created on or after
2025-04-23 ([docs](https://vercel.com/docs/functions/websockets)). But a
connection brings four constraints that matter here:

- **It is pinned to one instance for its life**, and a *new* connection may land
  anywhere — Vercel explicitly says to keep "durable state, presence, counters,
  rooms, and pub/sub coordination" in an external store because instances do not
  share memory. Vercel's own documented way to do rooms on native WebSockets is
  *Redis Streams with a blocking `XREAD` per instance*, which is a more elaborate
  version of what this project already has.
- **It is closed at the function's maximum duration** — 300s on Hobby, 800s on
  Pro (1800s is beta, per-function, and unavailable with Secure Compute or Static
  IPs). **800 seconds is 13m20s, shorter than a 20-minute game**, so a game would
  be disconnected mid-play and reconnect onto an arbitrary instance. Vercel's
  wording: "periodic disconnects are expected, not a bug to chase."
- **After a deploy, new connections reach the new build while existing ones stay
  on the old one.** That is exactly the two-code-versions-on-one-room situation
  `roomEpoch()` prevents by construction today (see
  [rooms.md](rooms.md#a-deploy-closes-the-rooms-it-replaces)).
- Vercel documents a limit of **1,024 file descriptors shared across concurrent
  executions** (including the runtime's own use). The docs do not define the
  scope unit, so "per instance" is an inference rather than a statement — but
  each held socket spends at least one, which bounds how many an instance can
  carry.

### SvelteKit cannot upgrade a connection from a route

This is the sharpest constraint, and it is worth being precise because "blocked"
and "needs a different shape" are different answers.

`@sveltejs/adapter-vercel` has **no** WebSocket support: the adapter source
contains no reference to sockets or upgrades, it emits
`fetch(request) { return server.respond(request, …) }`, and a SvelteKit
`+server.js` **may not even export `UPGRADE`** — the permitted exports are
`GET/POST/PATCH/PUT/DELETE/OPTIONS/HEAD` and configuration, so it is a build
error rather than a runtime one. The open issue is
[sveltejs/kit#1491](https://github.com/sveltejs/kit/issues/1491) (open since 2021);
two attempts to add it (#12961, #12973) were closed unmerged, and a maintainer's
answer on #12358 is that WebSockets "are a two-way stream, and you can't make
them fit into a `Request`/`Response` framework". SvelteKit's own realtime answer
is SSE, not sockets.

So the honest statement is:

- **A SvelteKit route handler cannot serve a WebSocket.**
- **A *sibling* Vercel Function can.** SvelteKit's deployment documentation
  explicitly gives up `/api/*` when an `api` directory exists at the project
  root, so a plain Node function there (with `ws`) sits entirely outside
  SvelteKit's Request/Response pipeline.
- **Vercel Services** (beta) is a second route to the same place: a second
  backend in the same project and deployment
  ([docs](https://vercel.com/docs/services)). It runs as Vercel Functions on
  Fluid compute and inherits the same limits — including the duration ceiling
  above — so it removes the adapter obstacle and not the others.

## The options, and what each one is really for

Prices as published on 2026-09-26; re-verify before quoting them, and note that
several of these pages carry no last-updated date.

| Option | Marketplace integration | How messages are billed | History | Free tier | Why / why not |
| --- | --- | --- | --- | --- | --- |
| **Upstash Redis** (what the relay uses) | yes — Vercel KV was discontinued and auto-migrated here in December 2024 | per command, with reads and writes at the same price | the room's own 6h, 400-event log | 500K commands/month | correct, already built, and cheap at this scale |
| **Upstash Realtime** (SSE) | yes — the same account and the same database | **per operation, not per delivery** | Redis Streams | the same 500K commands | the only option that reduces *both* costs; see below |
| **Supabase Realtime** | yes — native, unified billing | per message **per recipient**; database-originated messages replay for 72h (25 per request) | 72h, private channels | 200 connections, 2M messages | good if the project ever wants Postgres; it is a rewrite |
| **Convex** | yes — native | function calls + GB-hours | it is the database | 1M function calls | replaces the store and the relay at once; a rewrite |
| **Ably** | Vercel's guide says "Marketplace integrations" for Pusher, Ably and Liveblocks; Ably's own page calls its Vercel offering a Starter Kit. Check the dashboard rather than trusting either | **per delivery** — one publish to two subscribers is three messages | 2 minutes by default; persisted history costs extra quota and is 24h on Free | 6M messages, **200 concurrent connections** | solid, but per-delivery billing scales with spectators, and it is a new vendor and bill |
| **Pusher Channels** | as above | per delivery | tier-limited | 200K messages/day, 100 connections | equivalent to Ably, tighter free tier |
| **PubNub** | as above | **per monthly active user**, not per message | paid | 200 MAU | the pricing unit fits a chat product better than a two-player game |
| **Cloudflare Durable Objects** | no — not on Vercel | incoming WebSocket messages bill at 20:1 as requests, and a non-hibernating socket bills duration for its whole life | SQLite per room | yes, SQLite-backed only | the best *architecture* (one authoritative in-memory room, native ordering, the log is a database) but a second platform; Cloudflare's own examples are ~$143/month without hibernation against ~$21 with it |
| **Railway / Render / Fly.io** | no | flat host cost | you own it | none viable 24/7 | the only way to keep *all* current semantics, at the price of owning a server, TLS and restarts |

Two rules that are easy to get wrong across this table: **Ably and Pusher bill
per delivery while Upstash bills per operation**, so the two are not comparable
by "messages"; and **Ably's history is not included** — persistence and retrieval
each consume quota, and a persisted publish counts double.

## If it ever has to change

**Upstash Realtime is the recommendation**, and it is the one option that does
not require choosing between "keep the store" and "get a push transport".

It is a newer Upstash product built on Redis Streams and pub/sub, reachable over
SSE, and it bills per Redis operation against the database this project already
has — so there is no new vendor, no new account and no new credential. Its
published command costs are what make it the only interesting candidate:

| | Long poll (today) | Upstash Realtime |
| --- | --- | --- |
| An idle client | 45 commands/minute | ~1/minute — a keepalive, plus three commands per reconnect every 300s |
| One event | 10 commands | 2 — a `PUBLISH` and an `XADD` |
| History | the relay's own 400-event list | Redis Streams, built in |

Which takes a game from about 3,300 commands to about 690 — roughly **4.8×** —
and, unlike every provider above, **its cost does not change when somebody
starts spectating**, because nothing is billed per delivery.

Two things to settle before committing to it: `@upstash/realtime`'s client is a
React hook, so a Svelte app needs the SSE route handler (their `handle` is
framework-agnostic) plus a subscriber of its own — budget a few dozen lines; and
it is a young product whose pricing and limits have already moved once.

**A socket remains a defensible choice for latency alone** — it is a real
improvement in how a game *feels*, since the long poll's worst case is one check
interval while a socket is immediate. It should be chosen for that reason and not
for cost, and it should keep the Redis room store exactly as it is.

## What was deliberately not done

Nothing here was implemented. The relay is unchanged, and the investigation
changed no code. Three things would each have to be re-solved before any
transport move, and they are recorded so nobody has to rediscover them:

- **the shared server clock.** `measureOffset()` takes the quickest round trip as
  the true offset, and every poll carries the relay's `now`. The game timer, the
  idle prompt, the host wait and the rejoin deadline all count down against it.
  A socket has no natural place to carry that, so a clock-carrying heartbeat
  would have to be built — and the event's own `at` must never be overwritten
  with the event's timestamp, which is the feedback loop that once had two
  clients answering each other forever (see [timer.md](timer.md)).
- **echo semantics.** A sent event is deliberately not delivered to local
  listeners, and on the poll the sender's own events are skipped by
  `event.from === this.id`. Pub/sub does not echo to the publisher, so this has
  to be re-established explicitly or the "message appears twice" bug returns.
- **the ending reasons.** `closedReason()` distinguishes a player leaving, an
  opponent who never arrived, a player who did not come back, an idle table and a
  deploy from the 6h TTL, and each one says something different on screen. Any
  replacement has to keep that vocabulary, not just the delivery.

## The one change worth making now

The largest cost line is two clients asking "anything new?" every two seconds
while a player thinks. The relay already has a lazier beat for this —
`IDLE_INTERVAL_MS`, a 30-second check — but it does not engage until **ten
minutes** without an action, and in a card game a minute of silence is ordinary
thinking rather than idleness. Bringing that threshold down to about a minute
would take roughly 5× off the 1,800-command idle line, with the instant catch-up
on any activity that already exists (a click, a key, an event, or a glance back
at a hidden tab).

It is deliberately not done in this change: it is behaviour in the transport, and
it belongs in a change with the browser check that shows a move still lands at
once.
