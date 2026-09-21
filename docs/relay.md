# How the relay works

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

## A request that never answers

The long poll has had its own deadline since it was written, because it is
*supposed* to be held open: the client gives up a little after the server's own
window. Every other call — create, join, spectate, leave, and appending an event —
had none, and a connection that answers nothing left the promise unsettled for
ever: a relay that is up with its database unreachable, a black-holing proxy, a
machine asleep. A poll that hangs costs a poll; a *request* that hangs is a dead
dialog, because the prompt that asks for a name disables OK **and** Cancel and
refuses Escape while its action is in flight — so an action that never settles
leaves the player looking at *"Working…"* with no button left to press.

So `HttpSocket.request()` now aborts at `REQUEST_TIMEOUT_MS` (20s) and rejects with
a sentence the form can show: *"the relay did not answer within 20s"*. Three things
about it are deliberate:

- **It is only on `request()`**, which the long poll does not go through — the poll
  sets its own signal against the server's window, which is longer. A deadline that
  governed both would cut off every poll and turn each game into a reconnecting one,
  which is why `tools/relay-timeout-check.mjs` asserts the two windows and their
  order rather than only the timeout itself.
- **The number is far above any healthy latency** (twenty seconds to create a room).
  A deadline that fires early is worse than none: it abandons work that was about to
  succeed, so the check also asserts that a slow-but-answering relay still lands.
- **The message does not claim the request failed.** An abort is not a guarantee the
  server did nothing, so it says no answer came. Retrying a *create* may therefore
  leave one abandoned room behind, which the room TTL reaps.

`tools/relay-timeout-check.mjs` drives all of that against the real transport with a
stand-in `fetch` — no server, no network, no browser.

While a poll waits it reads **one key** - the room's event cursor - per turn, and
only reads the rest of the room when that cursor moves. Members live in a single
hash, so a poll fetches them with one `HGETALL` and nothing ever runs `KEYS` over
the keyspace. On a metered Redis (Upstash bills per command) that is what keeps an
idle client near one command per poll turn instead of four.

## Measuring what the relay costs

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

## Spam, and what a burst costs

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
