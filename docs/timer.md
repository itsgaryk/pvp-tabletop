# The game timer

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
The clock's [keyboard shortcuts](board.md#keyboard-shortcuts) are the board's own (`C` next turn and so on), so
the board ignores keys typed into a field: the timer's minutes and seconds are
digits, and one of those would otherwise draw that many cards as it was typed. A
shortcut is a bare key as well: the deck's View All is `V`, and the paste chord —
`Ctrl+V`, or `Cmd+V` on a Mac — stays with the browser, which is how a room code
or a message gets pasted in.

## How the two clocks are kept together

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
