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

### Leaving, and what closes a room

A room is a game, and a game is the people playing it. So the rule the relay
enforces is **a room closes when no playing seat is occupied** — not when it has
no members. The difference matters: a spectator who never closes their tab
would otherwise hold a dead room, and its keys, open until the 6-hour TTL
noticed.

What that means in each case, and what the other people in the room are told:

- **A player leaving closes the game for everybody else.** The remaining player
  and any watchers get a centred **"Room closed: player left the room"** dialog
  with an OK button, and their board is emptied behind it. The leaver is not
  shown it: they already know, and they are already back in the lobby.
- **The last player leaving** closes the room too, but the ending is named
  differently — **"Room closed: all players left the room"** — because to a
  watcher that is a different game.
- **A spectator leaving** is only a count change, and never closes anything.
- **A player who vanishes without leaving** — a killed tab, a crash, a browser
  that lost the network — is *waited for*, not walked out on. See below.
- Leaving **empties** the board rather than resetting it. A reset puts a fresh
  copy of the imported deck back on it, which is right for Setup and wrong for
  walking away from a game.

Closing the tab is a leave too, and no button sees it: `pagehide` sends a
`sendBeacon`, which carries one field (`agentOffline`) saying that nobody chose
this. That is what lets the relay tell a beacon from the Leave Room button, and
the two mean opposite things — one ends the game, the other holds the seat. A
tab that was *killed* rather than closed cannot send anything at all, which is
what the stale-member sweep is for; that path starts the same wait.

A closed room leaves a short-lived note (two minutes) saying why, so a member
whose next poll finds the room missing can tell a game that ended from a room
the TTL collected — only one of those is worth saying on screen. The note names
*which* ending it was, and the poll hands that name to the client, so each
ending gets its own words rather than one generic dialog.

### Waiting: for an opponent, and for one who vanished

Two waits are part of a room's life, and both are counted by the players' own
polls — no cron, exactly as the idle prompt below.

**A room nobody joins closes itself** after `RELAY_HOST_WAIT_MS` (ten minutes).
A room is not a game until somebody sits opposite, and a code nobody ever used
should not hold a room — and its keys — for the six hours the TTL would
otherwise allow. The creator sees the countdown while they wait, and then
**"Room closed: opponent did not join"**.

That window is *only* about a room nobody joined: it is stamped into the room's
metadata when the room is made, and a flag set when a second player first sits
down retires it. A room that had two players and lost one is a game waiting for
somebody to come back, not an unused code — closing it as "the opponent never
arrived" because the creator's original ten minutes had since passed would be
exactly the wrong thing to say.

**A player who vanished is waited for** — `RELAY_REJOIN_WAIT_MS`, fifteen
minutes. Their seat is *held*, not given up: the member record stays, and only
their presence goes. So the player who reloads, or gets their network back, and
returns with the same member id is recognized as the person who was sitting
there and gets their own seat and role back — rather than being seated as
somebody new, or refused a seat in their own game. The player still at the table
sees a live countdown. If the wait runs out the room closes for whoever is left,
with **"Room closed: player did not rejoin"**.

The two are deliberately different sizes. A player who *chose* to leave ends the
game at once — there is nothing to wait for — and a player who merely
disappeared is given long enough to come back.

### A deploy closes the rooms it replaces

A room is a live game, and the code playing it is the code that was deployed
when it was created. A restart therefore **ends the games in progress**: rooms
are stamped with the deployment's epoch (`VERCEL_GIT_COMMIT_SHA` on Vercel, a
random id per server boot in development) and any read that finds a different
stamp treats the room as finished, deleting it and telling its members the game
closed. The stamp rides in the room metadata that every read already fetches, so
checking it costs no extra store command.

This is deliberate: replaying an old room's events into a new build is the
failure it prevents, and the trade is that a deploy during a game ends that
game. The alternative — letting the room continue against handlers it was not
written for — fails in ways that are much harder to see.

### The idle prompt

A room where nothing has been *done* for `RELAY_IDLE_MS` is asked whether
anybody is still playing: a centred prompt with a countdown and a **Still
playing** button. Nobody answering within `RELAY_PROMPT_MS` closes the room.
Either player can answer, and one click takes the prompt off both screens.

Three things about it are deliberate:

- **Activity means appended events, not presence.** Two players sitting on a
  board are present and idle, which is exactly the case worth asking about. So
  the clock runs from `meta.lastActionAt`, stamped into the pipeline that
  already runs when an event is appended (one `SET` that carries its own TTL, so
  the room's expiry follows its metadata as it always did).
- **The players' own polls are the timer — there is no cron and no scheduler.**
  Vercel's Hobby cron runs about daily and every-five-minutes needs Pro, so the
  check rides on the read the poll already does on its way out. It is free:
  the room has been fetched anyway to describe the seats. A room nobody is
  polling is therefore never swept, and that is a known limit rather than an
  oversight: a clean tab close removes its member and, when it was the last
  player, closes the room on the way; a crashed tab leaves a room the 6-hour TTL
  collects.
- **The prompt is a normal relayed event.** Polls deliver it and a late joiner
  replays into it, so a spectator arriving mid-prompt sees the time actually
  left rather than a fresh window — the countdown is computed against the
  relay's clock from the event's own timestamp, exactly as the game timer is.

The same routine sweeps members whose presence has gone stale
(`RELAY_MEMBER_STALE_MS`), which is what stops a killed tab from inflating the
spectator count for the rest of the room's life. A player who goes stale is
treated differently from a spectator: the seat is **held** for them (see above)
and the rejoin wait starts, while a stale spectator is simply removed. If the
sweep leaves nobody actually sitting in a seat — and no seat being held — the
room closes.

### Environment variables

All are **optional**. The `VITE_*` ones are **client-side** and the rest are
server-side. Vite inlines the `VITE_*` values into the JavaScript during
`npm run build`, so they must never hold secrets and changing one requires a
redeploy; the others are read at request time and can be changed in the Vercel
dashboard (a new deployment is still needed, since the functions restart).

| Variable | What it controls | Default |
| --- | --- | --- |
| `VITE_PVP_SERVER` | Base URL for the relay. Leave unset to use the relay in this same project (`/api/relay`). Set it only to serve the relay from another origin, which must implement the same three routes. | unset (same origin) |
| `VITE_LIMITLESS_WEB` | Limitless TCG API used by "Import Deck" / "Import Random Deck". | `https://limitlesstcg.com` |
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

Under the turn row, and only in a room: a table clock, shown as `MM:SS`, or
`HH:MM:SS` once there is an hour or more. A room's clock starts at **50:00**,
paused. A player clicks the clock to set it — a centred prompt with minutes and
seconds, each taking up to 60, and an OK and a Cancel — and the one button beside
it starts and pauses. A spectator sees the clock and none of the controls.

It is shared as a **value**, not a tick: "this many milliseconds left as of this
timestamp". Every client counts down from that itself, so a running clock costs
**no store commands at all** — only starting, pausing and setting it are events.

Three things about it are deliberate, and each was a bug first:

- It is the **table's** clock, so every client reads the one copy, spectator
  included — its own board tracks it from the relayed events. Reading it from a
  mirror meant two opinions, which disagreed the moment one was behind.
- `at` travels with the value and must arrive unchanged. Stamping each event with
  the relay's arrival time made two clients each think the other had changed the
  clock; they answered each other for ever, 96 events deep in a minute.
- No client re-shares it. The relay logs the event for everyone, so every client
  sees it first-hand, and a second-hand echo of an older value is how the two
  clocks ended up pausing and restarting each other.

A board reset — setup, importing a deck, adopting an opponent's board state — does
not touch the clock. Entering a room sets it back to the default 50:00 instead.

The clock's keyboard shortcuts are the board's own (`C` next turn and so on), so
the board ignores keys typed into a field: the timer's minutes and seconds are
digits, and one of those would otherwise draw that many cards as it was typed.

The timestamp travels as the relay's clock — learned from each poll and the join
response — because two players' own clocks may not agree, which is what lets a
spectator arriving halfway through work out the right amount left from the event
history. Locally it is **converted once, on arrival, into this browser's clock**,
and the countdown runs from that: the relay's clock here is an estimate
re-estimated on every poll, and a second that stretches by a round trip makes the
display stutter.

In solo, the opponent's half is laid out with the same `upright` class a
spectator's top half uses — same bar and count placement, cards turned back up.

Crossing fifteen minutes makes the clock glow briefly (a clock *set* below
fifteen does not — the glow is for passing the mark). At zero it stops, the words
*Time on the Round!* cross the screen once, and the host writes a single line to
the game log.

### Solo mode

**Play Solo** on the front panel starts a game against yourself: no room, no code
and no relay, so it costs **no store commands at all** — the browser's socket is
never connected. Leaving goes back to the front panel.

The game log stays, writing locally instead of relaying, and without the Game /
Chat tabs or the message box above it — there is nobody to talk to. The timer and
Hide Pokémon are hidden too: one is a clock against yourself, the other is about
what the other player can see. The spectator-style **flip** is available, and
swaps your own board with the other side's.

Both halves of the board are yours, so the second one is playable the same way
the first is:

- **Edit Deck 2**, beside **Edit Deck**, gives the opponent's half its own deck
  through the same panel, the same import. Both panels start closed; the button is
  how you ask for one.
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

For reference, one idle client at the default settings — a player alone in a room,
nobody watching — costs **0.75 commands/second** (~2,700 an hour), measured over
whole long-polls:

| per 20s poll | commands |
| --- | --- |
| the cursor check, every 2s | 10 |
| "still here" (one HSET) | 1 |
| assembling the reply (room meta, events, members) | 4 |

The idle check rides on that last row rather than adding to it: the room has
already been read to describe the seats, so `RELAY_IDLE_MS` and the stale-member
sweep cost a comparison rather than a command. An appended event is still **ten
commands** too — the activity stamp (`meta.lastActionAt`) is written into the
metadata the append path already read, in the same `SET` that used to be a plain
existence check, so it costs nothing either.

Presence is a field of its own in the members hash, so refreshing it is a single
HSET rather than a read-modify-write of the member record: three commands became
one, and two clients touching at once can no longer lose each other's role or
name. `GET /api/relay/health` reports the settings a deployment is running with,
so a change in the dashboard is visible from outside:

```json
{ "ok": true, "relay": true, "store": "redis-rest", "from": "KV_REST_API_URL",
  "epoch": "sha:1f2e3d4c…",
  "poll": { "waitMs": 20000, "intervalMs": 2000 },
  "idle": { "idleMs": 600000, "promptMs": 600000, "memberStaleMs": 140000 } }
```
A tab nobody is looking at costs far less. While the document is hidden the
client asks the server to check its cursor every 20s instead of on the default
beat, and re-polls the moment the tab is looked at again, so the board is up to
date by the time it is read. Measured: **~0.27 commands/second** hidden against
~1.7 visible at the old one-second default, with presence still kept fresh and a
missed event on screen within milliseconds of
regaining focus.

### Spam, and what a burst costs

Every relayed event costs the store ten commands, and there is no batching: ten
actions fired at once cost ten times one action. Measured, a client emitting as
fast as it could — 240 events in six seconds — cost **2,722 commands**, which is a
month's allowance in minutes. A player leaning on a control is, to the store, a
runaway script.

Two things bound that now, and neither discards an action:

- **Coalescing.** Events carrying an *absolute value* — the turn number, damage on
  a slot, the clock, the markers and toggles — wait 200 ms before being sent, so a
  second press replaces the one still waiting instead of adding to it. Ten presses
  of `+1` on the clock relay as **one** event carrying all ten minutes. The key
  includes the slot, not just the event name, so damaging two different Pokémon
  keeps both.
- **Pacing.** Everything else goes out at a sustained six events a second, which is
  about three player actions a second — most actions relay two events, the change
  and the log line describing it. Anything over that waits in a queue **on the
  client** and follows a moment later, in order. Nothing is dropped, and the
  diagnostics panel shows how many are waiting.

The same burst now costs **472 commands instead of 2,722**.

The relay also refuses more than eight events a second from one member — a backstop
for what a client cannot cover, such as an old bundle still open in a browser. It
costs no extra commands: the room's recent events were read a moment earlier to
check membership, and each carries its sender and time, so the count is free.
Being derived from a read rather than an atomic counter it is approximate when
requests arrive together; the client's own queue is what keeps it from being
needed, since rejecting an action server-side would mean losing it.

## Troubleshooting and diagnostics

Five tools, for the five questions that are expensive to answer by hand. Each of
them exists because the hand-written version of it produced a wrong answer at
least once.

| Question | Where the answer is |
| --- | --- |
| "What actually happened in that room?" | `node tools/room-log.mjs <ROOM>` |
| "Is it the state or the client?" | Settings -> Diagnostics (also at `/diagnostics`) |
| "Has my change actually shipped?" | `node tools/deployed.mjs --url <app> <marker>` |
| "Does the relay still enforce its own rules?" | `node tools/relay-check.mjs` |
| "Does the app really do that, in a browser?" | `node tools/browser-check.mjs` |

### Verifying a change: `tools/relay-check.mjs` and `tools/browser-check.mjs`

`relay-check.mjs` asks the relay directly about the things this project has
got wrong before — leaving, the two waits, restarts, the idle prompt and the
stale-member sweep — and prints a line per check. It needs no browser and no
network beyond the deployment, so it runs against a Vercel preview as happily as
against `vite dev`:

```sh
node tools/relay-check.mjs                              # against localhost:3005
BASE=https://your-app.vercel.app node tools/relay-check.mjs
```

It reads the windows out of `/api/relay/health` and, against a deployment
running the production ten- and fifteen-minute ones, **skips** the timing checks
and says so rather than either failing or pretending to have run them. Point it
at a server started with second-scale windows and it exercises the whole
lifecycle:

```sh
node tools/fake-redis.mjs &
RELAY_IDLE_MS=3000 RELAY_PROMPT_MS=5000 RELAY_MEMBER_STALE_MS=8000 \
RELAY_HOST_WAIT_MS=3000 RELAY_REJOIN_WAIT_MS=10000 \
RELAY_POLL_WAIT_MS=1000 RELAY_POLL_INTERVAL_MS=300 \
KV_REST_API_URL=http://127.0.0.1:6390 KV_REST_API_TOKEN=local npm run dev &
node tools/relay-check.mjs
```

`browser-check.mjs` drives the same behaviours through **three real browsers** —
two players and a spectator, the arrangement that caught the spectator bugs — and
checks what is actually on screen: the centred dialogs, the board behind them,
the watcher count in the header, the countdown. It attaches to browsers you
started yourself, one per page on ports 9222/9223/9224, because a helper that
spawns its own browsers has twice put an error dialog on somebody's screen. Its
header comment has the commands.

Its `panel` section covers the board panel's own changes, which nothing else can
see because none of them cross the wire — the Hide Pokémon glow that stays until
it is clicked, the clock in both directions, the Chat tab lit by a message that
arrived while the log was showing, and both markers at once with the settings
panel around them:

```sh
node tools/browser-check.mjs --only panel     # just that section
```

### A room's story: `tools/room-log.mjs`

The relay keeps a room as an ordered event log, so every question about a broken
game is really a question about that log. Reading it by hand - fetch
`/api/relay/poll?since=0`, scan for the last `boardState`, look for a
`boardReset` - is easy to do badly, and a bad read is how a wrong conclusion gets
drawn.

```sh
node tools/room-log.mjs ABC123                       # against the dev server
node tools/room-log.mjs ABC123 --tail 40             # just the end of the log
node tools/room-log.mjs ABC123 --json > room.json    # attach it to a bug report
BASE=https://your-app.vercel.app node tools/room-log.mjs ABC123
```

It prints the seats in join order, a timeline with the seconds since the first
event, the counts per event name and per sender, and then a **verdict**:

```
what this log says
  [ok] the last full board state (#6) holds 67 cards (deck 45, hand 7, prizes 6, discard 4, active 2, bench 3)
  [ok] the last full board state (#6) is newer than the last spectator change (#5)
  [-] 11 events over 0s (first #1 at 2026-09-18 17:44:21Z, last #11 at 2026-09-18 17:44:21Z)

verdict: no problem visible in the log - if the board is wrong, suspect the client
```

That last line is the point. `[x]` findings mean the **state** is wrong and the log
says so - a board reset with nothing published after it, a full state that is
empty, a sequence gap, an event burst from two clients echoing each other. No
`[x]` at all means the relay's own record is sound, which moves the suspicion to
the client - and that is what `/diagnostics` is for.

It is **read-only**, and deliberately so: it never sends a `memberId`, so the
relay records no presence for it and spends no writes. Reading a small room costs
four commands (two `GET`, one `LRANGE`, one `HGETALL`) and a room larger than one
poll page costs one extra round.

### The diagnostics panel

Open it from **Settings -> Diagnostics**. It appears as a dialog over the board,
which is deliberate: diagnostics are wanted while a game looks wrong, and going to
another page reloads the app and rebuilds the board - so the thing being diagnosed
would be gone. Pressing the cog, Escape or a click outside closes it.

The same panel is also served at `/diagnostics` as a standalone page, which is
handy for a bug report or for looking at things with no game open. Both render one
component, so they cannot drift apart.

It is a live snapshot of *this browser*: relay health and the poll settings the
deployment is running, the room and its role, the seats in join order, the
spectator count, the clock skew against the relay, the boards' zone counts, and
the last events the transport delivered.

The section that earns its place is the event list:

```
age   seq   event              from          handled
2s    41    boardState         Alice         yes
2s    42    damageUpdated      Bob           yes
1s    43    prizeToggle        relay         IGNORED
```

`IGNORED` means the relay delivered that event and **no handler in this client
was listening for it**. That is the shape of the spectator bugs: the log was
healthy, the poll delivered everything, the board stayed empty and nothing on
screen or in the console said why. An event with no listener used to disappear
without a trace; now it is a line here.

The zone counts are read through `exportBoard()`, the same shape a player sends
the relay - so "deck 45, hand 7, bench 3" here is the number this client is
*publishing*, not a second opinion about the board. If that disagrees with what
the other half shows, the fault is in between.

There is also a **Copy report** button, which puts the whole snapshot on the
clipboard as JSON.

### Claiming a deploy: `tools/deployed.mjs`

Merged is not deployed. A build can lag a merge by minutes, and checking by eye
twice is how "deployed" gets claimed when it is not. This asks the deployment
itself:

```sh
node tools/deployed.mjs --url https://your-app.vercel.app
node tools/deployed.mjs --url https://your-app.vercel.app "some literal from your change"
node tools/deployed.mjs --local            # just this build, no network
```

It answers two ways, because either alone can mislead:

- **the fingerprint** - SvelteKit writes `/_app/version.json`, and each asset
  carries a content hash in its filename. It prints both versions and compares the
  module graph file by file. Assets are discovered the way a browser discovers
  them, by following `import()` from the served HTML, so a route chunk that is not
  preloaded still counts as present.
- **the marker** - a literal string you know is in your change, searched in both
  the local build and the served bundle. `local yes, deployment no` is the exact
  answer to "has my merge shipped?":

```
verdict: NOT DEPLOYED - "last relay error" is in the local build but not in the
served bundle, so the deployment is behind this build.
```

A marker must survive minification, so pick a string literal, a route path, an
event name or a CSS class - not an identifier you invented, which the minifier may
rename.

Three answers are refused deliberately, because each would otherwise be a
confident guess:

- **a marker in neither build** - it proves nothing, so the tool says so rather
  than reporting "not deployed" from no evidence
- **a deployment that cannot be read** - a wrong URL, a 404, or a login wall
  produces "cannot tell", naming what actually came back. Reading a login page
  and calling it an empty deployment is the mistake this avoids
- **a fingerprint that differs** - a deployment built somewhere else (Vercel, CI)
  compiles the same source into different content hashes, so its fingerprint can
  never match a local build and the asset diff is noise. When every marker is
  present the answer is "deployed", with the differing hashes explained rather
  than reported as drift:

```
verdict: deployed - every marker is in the served bundle, so this change is live.
The fingerprint differs (local 1789755944145, live 1789756230756) because the
deployment was built separately, which is normal and not a sign of drift.
```

The version fingerprint is most useful for comparing **one deployment against
itself over time** - before and after a release, or two preview URLs - rather than
a local build against a remote one.

### Failures that used to be silent

A relay fault used to end at `console.error` and nowhere else, so a board could
sit there quietly wrong with nothing to explain it. The transport now keeps the
last 40 faults - failed sends, failed polls, handlers that threw, and events
dropped with nowhere to send them - and the connection panel shows the most
recent one as `relay: <kind> - <reason>`. The full list is on `/diagnostics`.

Solo mode is excluded from "dropped event" reports on purpose: having no room is
the design there, so it is not a fault.

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
  and never touches the transport directly. That direction is deliberate: the
  transport must not import gameplay, or the two modules evaluate while each
  other is half-built (it is a 500 on every page load, not a subtle bug). What
  the transport needs back — "empty this board, the room is gone" — gameplay
  registers with `onBoardCleanup()` instead.
- `src/lib/relay/maintain.js` is everything the poll decides on the room it has
  already read: whether the room is still a game, who has gone stale, and whether
  to prompt or close. It runs on the poll's one exit path, so all four ways a
  poll can end are maintained identically.
- `.github/workflows/ci.yml` runs `tools/relay-check.mjs` against a dev server
  with second-scale idle windows, then `npm run build`. It never touches a real
  database, so a push cannot spend a metered quota.
