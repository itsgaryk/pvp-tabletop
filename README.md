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

**Leaving takes the room's code and its lobby status with it.** The lobby watches
the code you typed (`roomSummary`), and a room whose two seats are taken comes
back `locked` — which disables **Join Room**. That status describes a room, not
the menu, and it is fetched a moment *after* the code is submitted, so the join it
belongs to has often filled the second seat by the time it lands: the player sees
`locked` for their own room. Kept across leaving, it disabled the one control that
opens the code prompt, and the menu became a dead end — for the player who joined,
and equally for a spectator, who only ever watches full rooms. `leftRoom` — which
every way out of a room raises, the button, the closing tab and the closed game
alike — now forgets both the code and its status.

The buttons that do these things are disabled while a request is in flight, and
that flag is released in a `finally`: `busy` stuck on is the same dead end reached
another way, and it also stranded the code prompt, whose OK, Cancel and Escape all
refuse while it is set.

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
digits, and one of those would otherwise draw that many cards as it was typed. A
shortcut is a bare key as well: the deck's View All is `V`, and the paste chord —
`Ctrl+V`, or `Cmd+V` on a Mac — stays with the browser, which is how a room code
or a message gets pasted in.

#### How the two clocks are kept together

The value travels with the moment it was set, in the **relay's** clock — because
two players' machines may not agree on what time it is. Locally it is converted
**once**, as it arrives, into this browser's own reading, and from then on the
countdown is local: `src/lib/stores/timer.js` owns that arithmetic, and every
caller asks it (`remainingAt`) rather than working out a running clock itself.

There are two separate problems in "sync the timer", and the old code only
addressed the first:

- **The offset between the relay's clock and this browser's.** It was measured by
  subtracting the reply's timestamp at the moment it was read, which dates the
  relay's clock by the whole round trip rather than by none of it — and the round
  trip differs from poll to poll, so the estimate moved by a whole second between
  two of them. Whenever a value was converted through it, the clock on screen
  stuck, then skipped. The offset is now taken from the two readings that *are*
  comparable: the relay stamped its moment one round trip before the reply was
  read, so it is subtracted from `Date.now() - rtt` — and of the samples taken
  **the quickest round trip wins**, because it is the one whose two legs are most
  nearly equal, which is the assumption the estimate rests on. Ties are not
  averaged, and the winning sample is kept until it is five minutes old, so a
  corrected clock or a redeploy cannot leave a stale offset in place.
- **Two browsers drifting apart.** Each counts with its own crystal, so over fifty
  minutes they diverge — and correcting *that* is not something an event can do,
  because an event is a moment in the past. So the relay owns the anchor: it
  stamps each `timerUpdated` with **its own** moment into the room's metadata, and
  every poll reply carries what the clock reads **now**. Players and spectators
  alike re-anchor to one number, and a client whose clock is a little fast is put
  back rather than being left to finish the round a second early. This costs
  **nothing**: it rides on a reply the poll was assembling anyway, and a clock
  nobody has set adds four small fields to a `SET` that was already being paid for.

A few consequences worth knowing:

- A client's own clock is never used to describe the clock to anyone else. What is
  published is the relay's reading; what is counted down is local.
- The countdown is measured against a monotonic reading (`performance.now()`), not
  the wall clock, so a machine whose clock is corrected mid-round does not make the
  time on screen jump.
- A snapshot never moves the clock **backwards** on screen, and a change this
  browser has just made is not overwritten by a reply that was already in flight
  when it was made. Both are only about what is displayed: within one round trip
  the re-anchor is the same value it already had, so nothing visibly jumps.
- The fix for a stuttering clock is **not** a slower poll. Polling more often would
  not have helped — the estimate was wrong by the round trip, not out of date — and
  `RELAY_POLL_INTERVAL_MS` is what the relay costs per idle client, so it is the
  wrong dial to turn for a display problem.

`tools/relay-check.mjs` covers the relay's half of this: that an unset clock reads
as none, that a running one counts down, that the anchor does not move while it
runs, that a late spectator is told the time actually left, and that a clock which
runs out reaches zero rather than going negative. `tools/clock-check.mjs` covers
the half no server can: two real browsers, twelve seconds of a running clock, and
a wall clock moved underneath one of them.

In solo the whole question does not arise — there is one browser and no relay — so
the clock is hidden along with the rest of what only matters in a room.

Crossing fifteen minutes makes the clock glow briefly (a clock *set* below
fifteen does not — the glow is for passing the mark). At zero it stops, the words
*Time on the Round!* cross the screen once, and the host writes a single line to
the game log.

### Solo mode

**Play Solo** on the main menu starts a game against yourself: no room, no code
and no relay, so it costs **no store commands at all** — the browser's socket is
never connected. Leaving goes back to the main menu.

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

The opponent's half is laid out with the same `upright` class a spectator's top
half uses — same bar and count placement, cards turned back up.

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

## The board

One grid, two halves. The bottom half is always the near side — a player's own
board; the top half is the other side of the table, either the opponent's mirror or,
for a spectator, the second player's. `src/lib/play/Board.svelte` owns the grid and
that assignment; the zones themselves are components under `src/lib/play/board/`
(drawn for the player sitting at the bottom) and `src/lib/play/opponent/` (the same
zones drawn for a half that is rotated, so their cards face the player on that side).

### The zones

A zone is a place a card can be dropped on and clicked in. It is a cell of the
board's grid — and it is not the same thing as the name written inside it (see
below), nor as what it holds: the deck, hand, prizes, discard, lost zone and table
are piles, while the active spot and the bench are *slots*. A slot holds up to three
lists (Pokémon, energy, trainer) plus the state that belongs to them — damage,
status, ability used.

| Zone | Grid area | Near half | Far half | Board field |
| --- | --- | --- | --- | --- |
| Hand | `hand` / `hand2` | `board/Hand.svelte` | `opponent/Hand.svelte` | `hand` |
| Prizes | `prizes` / `prizes2` | `board/Prizes.svelte` | `opponent/Prizes.svelte` | `prizes` |
| Deck | `deck` / `deck2` | `board/Deck.svelte` | `opponent/Deck.svelte` | `deck` |
| Discard | `discard` / `discard2` | `board/Discard.svelte` | `opponent/Discard.svelte` | `discard` |
| Lost Zone | `lz` / `lz2` | `board/LostZone.svelte` | `opponent/LostZone.svelte` | `lz` |
| Bench | `bench` / `bench2` | `board/Bench.svelte` | `opponent/Bench.svelte` | `bench` (slots) |
| Active | `active` (`active1`, `active2`) | `board/Active.svelte` | `opponent/Active.svelte` | `active` (one slot) |
| Table | `play` / `play2` | `board/Temp.svelte` | `opponent/Temp.svelte` | `table` |
| Stadium | `stadium` / `stadium2` | `board/Stadium.svelte` | `opponent/Stadium.svelte` | `stadium` |
| Pokemon Power | `power` / `power2` | `PowerZone.svelte` | `PowerZone.svelte` | `powerMarker` |

The board fields are the ones `src/lib/stores/custom/board.js` creates and
`player.js` re-exports; `opponent.js` builds the same shape as a mirror. The `2`
suffix on the far half's class names is the whole of the difference between the two
halves' markup, and `play2` and `stadium2` deliberately resolve to the *same* grid
area as `play` and `stadium`.

**Pokemon Power** is the one zone that holds no cards: it holds the player's VSTAR /
GX marker, the tokens a deck's own power is tracked with. It is why
`PowerZone.svelte` is a single component rather than the board/opponent pair every
other zone needs — it shows no cards and reads no board store, so what it shows is
handed to it. It is also why the marker is no longer a token floating in the free
space past the opponent's deck: a token belongs to a zone, and this is the zone for
it. The marks are sized by the band rather than by Settings' card size, so a short
window takes them with it instead of letting them spill over the Stadium.

Four cells are not one zone to one component:

- **The table, and the Stadium's cell, are shared.** Both players play into the same
  cell, so each half's component is placed in it and the near one is on top (`.play`
  at `z-index: 11`, `.stadium` at `10`). In solo the near table stands aside while it
  is empty and nothing is being dragged (`pointer-events: none` on `.play.empty`),
  which is what lets a click reach the far half's table lying underneath. The near
  stadium passes clicks through the same way until it has a card in play, and it stays
  the player's own whichever way the board is flipped.
- **The Stadium's cell is three bands.** `.stadium-area` is itself a grid of
  `1fr 2fr 1fr`: `power2` in the top quarter, the two stadiums sharing the middle
  half, `power` in the bottom quarter. So each player's Pokemon Power zone is the
  quarter of the cell between their own bench and the Stadium, the two Power zones
  take half the cell between them, and each name is centred in its own band rather
  than in the cell.
- **The active spot holds two zones.** `.active` is itself a two-row grid: `active2`
  in row 1 for the top half and `active1` in row 2 for the bottom, with the pokeball
  watermark (`:before`) belonging to the cell rather than to either zone.
- **The veil is not a zone at all.** It is the shading drawn while Hide Pokémon is
  on (`pokemonHidden`), placed by named lines rather than declared as an area, so it
  is deliberately outside both the zone outlines and the zone names.

The grid is seven columns by six rows, with every track floored at `minmax(0, …)`:
plain `fr` has an automatic minimum, so a zone with more in it — a full hand, a pile
of prizes — grew its row and squeezed the others, which is how two views ended up
disagreeing about where a zone was. Zones are placed by `grid-template-areas`, so the
whole layout is one declaration and a zone's position is its area name; `grep` for
that name to find the cell, and the table above to find the component.

`pickup` is the one pile with no zone on the board: cards wait there while a
multi-card selection is being resolved (the *in hand (moving)* line in the
diagnostics panel), so it is state rather than board furniture.

A pile draws its own count badge in the corner, except the table's, which asks for
none: the stack there is read by looking at it, and a number on top of it was noise.
Deck, hand, prizes, discard and lost zone carry one; the stadium (a single card), the
active spot and the bench (slots) never did.

### Zone borders and names

**Settings → Board zones** (`zoneBorders`, persisted as `zone_borders`, off by
default) outlines every zone of both halves and — only while it is on — writes each
zone's name in the middle of it. The two are a pair: a line says where a zone begins
and ends, a word says which zone it is. It is a development and teaching aid as much
as a setting, and `node tools/browser-check.mjs --only panel` is what reads it.

The names are the game's words rather than the components' — the discard pile is a
*Discard*, the prize cards *Prizes*, the active spot an *Active*, and `Temp.svelte` is
the *Table* — which is why the list is written out in `Board.svelte` instead of being
derived from the files. A two-word name is broken over its words (`white-space:
pre-line`), so *Lost Zone* reads as a small centred block rather than one long line
across the zone.

Four things about them are deliberate, and each was a bug first:

- **A name is drawn under the cards, not over them.** The labels come first in the
  board, before the zones they name, so whatever a zone draws comes after them and a
  card in the middle of a zone covers its name. A caption belongs on the empty part
  of a zone, not read through the cards.
- **A name takes no pointer events and cannot be selected.** A zone is what the board
  reacts to; a label that swallowed a click would be a hole in the middle of every
  zone.
- **Half strength is the colour's alpha, not the element's `opacity`.** `opacity`
  gives the name a layer of its own, and it is then drawn over the cards in any zone
  whose own markup is not positioned — the stadium's is not.
- **A name is sized by its own words.** The rule that makes a zone's component fill
  its zone caught the first of the active area's two names and stretched it to the
  whole cell, which put its words at the top of the zone while its box still measured
  as the zone — so it read as centred and looked wrong.

The active area is the one cell holding a zone per player, so it carries the name
**Active** twice, each centred in its own row of that cell; the Stadium's cell carries
three, one per band, so **Pokemon Power** is written twice — once for each player's
zone — with the **Stadium** between them. Eighteen names for fourteen cells, for that
reason, is the number the browser check asserts.

### Flipping the board

The flip button sits beside the settings cog, and only a **spectator** or **solo**
gets it: a player in a room already sits on their own side, so there is nothing to
swap.

One control and one store — `spectatorFlipped` in `opponent.js` — with two meanings,
because the two modes have the same problem from opposite ends:

- **A spectator** swaps which player is on which half of its screen. A spectator
  keeps a mirror per player, and flipping re-points the two mirrors. It is a *local
  view change*: nothing is sent to the relay and neither player's own board moves.
- **In solo** both halves are the same person, so the flip swaps your own board with
  the other side's: your half moves to the top and the other side's comes down, where
  you can play it. `Board.svelte` states it as `soloSwapped = $solo &&
  $spectatorFlipped`, and it is the same button and the same store as a spectator's
  flip. The button's tooltip names which of the two it means.

What travels with a half when it flips is whatever belongs to the player shown on it:
for a spectator, the two nameplates (`topName` / `bottomName`, taken from the relay's
seats in join order) and each half's VSTAR/GX marker; for anyone, the hand's
*revealed* tint, which follows the hand that is at the bottom *now* (`soloSwapped ?
$oppHandRevealed : $handRevealed`) because a flipped solo board has the other side's
hand down there. A solo board has only one name to write — its own — because solo
never joins a room and so has no seats.

The two shared cells are the one thing a flip does not move. The table and the
stadium are a single cell each with the near copy on top, and the near copy stays the
player's own however the board is flipped; the other half's is the one behind it.
Handing the player's own table or stadium to the other side of the screen is the one
thing a flip must not do.

What does not travel is everything else. No card moves, no event is relayed and no
board state is touched: the turn, the clock, the decks and the piles are all where
they were. It is a view, not an action — which is why a spectator can flip a game it
cannot touch, and why the flip is safe to reach for mid-turn.

The half being flipped is also the one piece of rendering that turns:

- The top half is drawn rotated (`transform: scale(-1, -1)`) because it is the far
  side of the table, so its cards face the player sitting opposite. A spectator's and
  solo's top half uses the same layout, but the cards are turned back up again (the
  `upright` class), because both halves are read by the same pair of eyes.
- Anything that has to stay readable by whoever is looking at a rotated half — a
  pile's count, a damage counter, a status marker, the ability stripe — is rotated
  back in `Board.svelte`, the one place that knows the half is flipped. An element
  added to the far half that carries words needs putting on that list, and there is no
  error if it is forgotten: it simply arrives upside down.
- The hand row is never rotated, for a player or a spectator, because its pile menu
  renders inside it.
- Flipping is not remembered. `spectatorFlipped` is a plain writable rather than a
  `storable`, so a reload starts unflipped, and it is set back to false when a room is
  left and when solo starts or ends.

### Spectating

**Spectate Game** on the main menu joins a room without taking a seat. A spectator is
read-only, and the enforcement is not in the UI: every state change in the app funnels
through `share()`, which refuses to act while `spectating`, and the relay answers any
event but `chatMessage` from a spectator member with *"spectators cannot change the
game"*. So the board's menus and shortcuts cannot touch the game however they are
reached. Chat is the one thing a spectator may send, which is why it does not go
through `share()`.

On screen a spectator gets the whole board and none of the play:

- **Two mirrors, one per player**, created once at module level (`spectatorOpponents`
  in `opponent.js`) and seated from the relay's `seated` event. The normal single
  mirror is switched off while spectating rather than unmounted, because it would
  otherwise quietly collect both players' cards into one set of slots.
- **No game actions.** The Setup / Hide Pokémon / Flip Coin / End Turn row is not
  rendered and its shortcuts are not bound, so End Turn and New Game are not one
  keystroke away for somebody who is only watching.
- **Both hands and both sets of prizes are face up** (`$spectating` reveals them
  outright), which is the deliberate difference from a player, who sees a hidden hand
  and hidden prizes.
- **The clock, without its controls**, no VSTAR/GX marker of its own, and no deck
  panels — a spectator has no deck to edit.
- **A spectator is not a seat.** A spectator leaving never closes the room, and a
  spectator's presence going stale is only a count change (see *Leaving, and what
  closes a room*).

### Keyboard shortcuts

Two document-level listeners, and both refuse while somebody is typing
(`$lib/util/typing.js`, which also keeps Enter and Space for a focused button). No
board shortcut uses the command modifier, on purpose: that combination belongs to the
browser and the clipboard, so `Ctrl+V` / `Cmd+V` pastes a room code or a message and
View All is `V` and only `V`.

The board's own shortcuts, from `Board.svelte`:

| Key | Does |
| --- | --- |
| `1`–`9` | draw that many cards |
| `Alt`+`1`–`9` | look at that many from the top of the deck (the deck menu's *View Top X*) |
| `D` `H` `L` `P` | the selection to discard / hand / lost zone / prizes |
| `B` `A` | the selected Pokémon to the bench / the active spot |
| `G` | the selection to the stadium, or log the stadium already in play |
| `S` | shuffle: the selection into the deck, or the deck itself |
| `T` `M` | the selection to the top / bottom of the deck |
| `Q` `E` | attach / evolve with the selected card |
| `U` | mark the selected Pokémon's ability used, or take that back |
| `Space` | the selected card's details, and again to put them away |
| `V` `W` | View All of the deck / of the table |
| `X` | the selection to the table, or pick the table back up |
| `Esc` | clear the selection |

The game actions, from `GameActions.svelte`, which a spectator does not get at all:
`Enter` ends the turn, `C` starts the next one, `N` starts a new game (after asking),
`F` flips a coin, `Z` shows or hides Pokémon.

In solo both halves are playable, so every key that moves a selection first asks which
board it is meant for (`farSelected()`): the same key moves the far half's own cards
into the far half's own zones, and never carries a card across the table into yours.

### What the browser remembers

Only two kinds of thing are persisted, both in `localStorage`, and nothing else
survives a reload:

- **The room and the seat** (`pvp_session`, written by `src/lib/relay/client.js`), so
  a reload lands back in the same game as the same member. Leaving a room, or finding
  it gone, forgets it.
- **The settings** (`auto_mulligan`, `scale`, `zone_borders`, `player_name`), through
  `storable()` in `src/lib/stores/custom/storable.js`.

The board itself is persisted nowhere. In a room it is rebuilt by replaying the relay's
event log, which is why a stale `pvp_session` matters and a stale board does not. In
solo there is no relay and so no log: a reload returns to the main menu and the game
is gone. That also makes the settings a debug lever — a board that looks wrong because
of `zone_borders` or `scale` is fixed by clearing those keys, without touching the
game.

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
| "Is the clock still smooth and still shared?" | `node tools/clock-check.mjs` |

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
arrived while the log was showing, the zone names that come with the zone
outlines and the number the table does not carry, and both markers at once, each
with its own click, its own used state and its own log line:

```sh
node tools/browser-check.mjs --only panel     # just that section
```

It answers the relay's "Still playing?" while it works. The idle windows are the
room's clock rather than one section's, and they are set in seconds for the idle
section's sake — and this is the section that spends longer than that reading the
board without appending anything to the relay. Unanswered, the prompt closed the
room halfway through and every check after it read the main menu: eighteen
failures with one dialog behind them, and three that passed because an empty list
satisfies "none of them do X". Its checks that assert an absence — the deck is
shut, nobody has been told the time is up, no marks are left — now ask for the
board as well, so a room that has gone cannot pass them.

Its `lobby` section covers the way in — the **main menu**. The menu is the logo and
the four buttons and nothing else on the window: the board, the settings cog and
Edit Deck all stand aside while it is up. The logo sits to the left of the buttons,
the buttons are a column of equal widths evenly spaced down it, and the pair is
centred in the window. There is no name field and no Room ID field either, so every
button opens a centred prompt for whatever that button needs — the name, and for
joining or spectating the room code.

```sh
node tools/browser-check.mjs --only lobby     # just that section
```

### Is the clock smooth, and the same on both boards?

The clock is the one thing here that is about *time*, so it gets its own tool
rather than a section of `browser-check`: it needs twenty quiet seconds on two
browsers, and it makes the room it uses itself. A section that continued in
whatever room another section left open was a check that could be skipped for the
wrong reason — and the fault it exists for, a client-side crash while a board is
being built, shows up as *every* later section failing instead.

```sh
node tools/clock-check.mjs
```

It says whether the room opened at all (which is what a crash in the clock
component looks like from outside), then samples both boards every 700 ms for
twelve seconds of a running clock: never counting up, never stuck, never dropping
several seconds at once, and the two players never drifting apart. Then it moves
one browser's wall clock +8 s and then −9 s underneath it and checks that nothing
on screen moved — a machine clock being corrected by NTP is not time passing on
the table.

Its dev server needs idle windows longer than the run (two minutes is
comfortable), since a clock sits still for twenty seconds at a time on purpose.

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
