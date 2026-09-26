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

### The store's protocol is a constraint on the fan-out, not just the transport

Vercel's documented pattern for rooms on native WebSockets assumes a **blocking**
`XREAD` — one reader per instance, waking when an entry lands. That is not
available to this project's store client, and the reason is the protocol rather
than Redis: the relay talks to Upstash over its **REST** API (POST a JSON command
array, and a `/pipeline` for batches), and Upstash documents that the REST API
supports Streams *"except blocking versions of XREAD and XREADGROUP"*, and that
the List and Sorted Set blocking commands are likewise unsupported. So a
blocking-read fan-out would need the **TCP** Redis protocol — a long-lived
process, which means a server-side Node service rather than the existing
serverless routes.

The same page is worth reading for what it *does* allow, because the obvious
guess is wrong twice over: `SUBSCRIBE` and `PUBLISH` **are** available over REST,
as server-sent events (`POST /subscribe/<channel>` with
`Accept: text/event-stream`), and `MONITOR` is available the same way. So
"pub/sub needs a raw socket" is false here, while "a blocking read needs one" is
true. A fan-out that polls a stream with a non-blocking `XREAD` is the shape the
REST protocol actually permits.

None of this is a reason to change anything today. It is recorded because it is
the piece of the WebSocket-plus-Redis-Streams design that does not port to the
current store client, and it is not visible from the code.

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
| **Cloudflare Durable Objects** | a listing exists at `vercel.com/marketplace/cloudflare`, but it is a Connect Account entry with no provisionable products — no Workers, no Durable Objects, no unified billing | incoming WebSocket messages bill at 20:1 as requests, and a non-hibernating socket bills duration for its whole life | SQLite per room | yes, SQLite-backed only | the best *architecture* (one authoritative in-memory room, native ordering, the log is a database, and up to 32,768 hibernatable sockets per object) but a second vendor; Cloudflare's own examples are ~$143/month without hibernation against ~$21 with it |
| **Liveblocks** | listed in DevTools, but it links to a Vercel *template* rather than a product page | metered collaboration minutes, not messages | **24 hours** on Free, 7 days on Pro | 3,000 collaboration minutes, 500 rooms, 10 connections per room | the best SvelteKit-native presence story and 10 connections covers players plus spectators, but no unified billing and the event log is far too short to be the game's history |
| **Railway / Render / Fly.io** | no | flat host cost | you own it | none viable 24/7 | the only way to keep *all* current semantics, at the price of owning a server, TLS and restarts |

Two rules that are easy to get wrong across this table: **Ably and Pusher bill
per delivery while Upstash bills per operation**, so the two are not comparable
by "messages"; and **Ably's history is not included** — persistence and retrieval
each consume quota, and a persisted publish counts double.

## If it ever has to change

**Upstash Realtime is the cheapest change, and it is not free of work.** It is
the only option that does not require choosing between "keep the store" and "get
a push transport" — a newer Upstash product built on Redis Streams and pub/sub,
reachable over SSE, billing per Redis operation against the database this project
already has, so there is no new vendor, no new account and no new credential. Its
published command costs are what make it the candidate:

| | Long poll (today) | Upstash Realtime |
| --- | --- | --- |
| An idle client | 45 commands/minute | ~1/minute — a keepalive, plus three commands per reconnect every 300s |
| One event | 10 commands | 2 — a `PUBLISH` and an `XADD` |
| History | the relay's own 400-event list | Redis Streams, with `maxLength` and `expireAfterSecs` |

Which takes a game from about 3,300 commands to about 690 — roughly **4.8×** —
and, unlike every provider above, **its cost does not change when somebody starts
spectating**, because nothing is billed per delivery.

What it does *not* come with, all of which has to be paid for in this project's
own code:

- **No Svelte client.** The client surface is a React hook (`useRealtime`,
  `RealtimeProvider`); the server side (`handle()`, `emit()`, `history()`) is
  framework-agnostic, so a Svelte app writes its own SSE consumer. Budget a few
  dozen lines, and treat it as unsupported surface rather than an SDK.
- **No presence primitive.** Rooms and presence would still be modelled the way
  they are now — a channel per room plus a heartbeat — not taken from the
  library.
- **Subscribe-only on the client, emit-only on the server.** Player actions still
  POST to a SvelteKit endpoint; only the delivery leg becomes push. So it
  replaces the poll and not the append.
- **It is not an installable Marketplace product.** The Upstash integration
  provisions Redis, Vector, QStash and Search. Realtime is an npm library on the
  Redis resource, and a database provisioned through Vercel is *not* a native
  Upstash account, so the Upstash Developer API is unavailable on it.

**The two alternatives, and why one of them may be the better answer.** If the
Svelte client and the presence model are the parts worth not writing,
**Supabase Realtime** is the only Marketplace-native option with a real answer to
both: a WebSocket transport, first-class Presence, a framework-agnostic JS
client, and database-triggered broadcast. Its replay is genuinely limited —
72 hours, private channels only, database-originated messages only, 25 messages
per request — so the game's own history would still live in a table of its own.
If control matters more than either, a **Vercel Service running real WebSockets
with Redis Streams** is the shape Vercel documents itself: no new vendor, but the
relay, the presence model and the reconnect-and-replay path are all built here,
against the connection ceiling above.

**A socket remains a defensible choice for latency alone** — it is a real
improvement in how a game *feels*, since the long poll's worst case is one check
interval while a socket is immediate. It should be chosen for that reason, not
for cost.

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

## What to do about the cost, in order

**First: the command count can simply stop being a quantity.** Upstash's Fixed
plans have no per-command billing at all — *"You pay for data size, bandwidth,
and throughput limits, not per command"* — and the smallest, Fixed 250MB, is
**$10/month** with 250MB of data and 50GB of bandwidth. A relay that costs
figures measured in commands is the exact workload Upstash's own billing page
describes when it recommends a Fixed plan ("a high baseline of background
commands … even when there is no real workload"), and this project's room store
fits in a tiny fraction of 250MB. That converts an open-ended meter into a flat
line, and it is a dashboard change rather than a code change.

Whether it is worth $10/month rather than a few dollars of pay-as-you-go depends
on how much the uncertainty is worth to you: at a few games a day the metered
cost is under a dollar, and at a hundred games a day it is around $19 — so the
Fixed plan is a saving at volume and a premium at low volume. What it buys at any
volume is not having to think about it, which is the argument the free tier's
500K commands/month makes for you: at six connected clients that allowance is a
day or two, not a month.

**Second: if the meter is to be reduced in code rather than bought out**, the
largest line is two clients asking "anything new?" every two seconds while a
player thinks. The relay already has a lazier beat for this — `IDLE_INTERVAL_MS`,
a 30-second check — but it does not engage until **ten minutes** without an
action, and in a card game a minute of silence is ordinary thinking rather than
idleness. Bringing that threshold down to about a minute would take roughly 5×
off the 1,800-command idle line, with the instant catch-up on any activity that
already exists (a click, a key, an event, or a glance back at a hidden tab).

Neither is done in this change. The first is a billing setting, and the second is
behaviour in the transport that belongs in a change with the browser check
showing a move still lands at once.

