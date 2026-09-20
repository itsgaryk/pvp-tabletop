# A room's life

## Reconnecting, and idle boards

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

## Leaving, and what closes a room

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

Rooms expire 6 hours after their last event, and each room keeps its most recent
400 events.

## Waiting: for an opponent, and for one who vanished

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

## A deploy closes the rooms it replaces

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

## The idle prompt

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
treated differently from a spectator: the seat is **held** for them (see [Waiting: for an opponent, and for one who vanished](#waiting-for-an-opponent-and-for-one-who-vanished))
and the rejoin wait starts, while a stale spectator is simply removed. If the
sweep leaves nobody actually sitting in a seat — and no seat being held — the
room closes.
