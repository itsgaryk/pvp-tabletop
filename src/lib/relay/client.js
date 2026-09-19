/*
   HTTP transport for the relay endpoints in src/routes/api/relay.

   The app was written against socket.io, where a client emits named events and
   receives named events back. This keeps that shape exactly - `on`, `off`,
   `emit`, `connect`, `disconnect` - but the wire protocol is HTTP:

      emit  -> POST /api/relay/events   (server stamps seq/ts and stores it)
      on    -> GET  /api/relay/poll     (long poll; returns events after cursor)

   Because a serverless function cannot hold a socket open, delivery happens on
   poll. Every POST triggers an immediate re-poll, so both sides see an event as
   soon as the request round-trips instead of waiting out the poll interval.

   The app also relied on socket.io echoing an emitted event back to its sender
   (that is how a player's own move lands in their log), so POST responses are
   fed through the same listener path as polled events.
*/

const POLL_WAIT_MS = 20000 // server holds the request this long (Hobby cap is 5 min)
const POLL_TIMEOUT_MS = 26000 // client aborts just after the server gives up
const POLL_IDLE_MS = 300 // pause before re-polling after an error
const EVENT_BUFFER = 200 // events fetched per poll

/*
   How many things that went wrong to keep. They are kept because a relay fault
   is otherwise invisible: a failed send, a poll that 500s and an event that
   arrives with no handler all used to end at console.error and nowhere else, so
   "the log was healthy and nothing was on screen" had no answer. Bounded, so a
   long session cannot grow it.
*/
const MAX_RELAY_ERRORS = 40

/*
   How fast this client may relay events.

   Every event costs the store ten commands and there is no batching, so a player
   leaning on a control is, from the relay's point of view, indistinguishable from
   a runaway script: measured, a burst of 240 events cost 2,722 commands, which is
   a month of quota in minutes. So sending is paced here, and anything over the
   pace waits in a queue rather than being dropped.

   Six events a second is about three player actions a second, because most
   actions relay two events - the state change and the log line that describes it
   ("Drew 2 cards"). A few actions of that per second is already fast play.

   BURST is the allowance for a quick legitimate sequence - benching four Pokemon
   in one go should not be slowed down - and the sustained rate is what actually
   bounds the cost.
*/
const SEND_PER_SECOND = 6
const SEND_BURST = 12
const MAX_QUEUE = 60
/*
   How long a coalescable event waits before it is sent.

   This is what makes coalescing work at all. Without it the burst allowance sends
   each event the instant it is queued, nothing is ever *waiting* to be merged, and
   mashing a control still costs one event per press - which is exactly what the
   measurement showed before this was added.

   Two hundred milliseconds is not perceptible on a value that is already applied
   locally (the damage number, the turn counter, the clock), and it is long enough
   that a repeated press folds into the one already waiting.
*/
const COALESCE_SETTLE_MS = 200
/* how long to wait before retrying a send the relay refused */
const RETRY_BACKOFF_MS = 500
const MAX_SEND_RETRIES = 4

/*
   Events that carry an absolute value, where a newer one makes an older one
   pointless: sending only the latest is correct, not lossy.

   The key matters. Coalescing by name alone would be a bug for the per-slot
   events - damaging Pikachu and then Bulbasaur in the same tick would keep only
   one of them, silently losing the other. So anything with a slot in it is keyed
   by that slot.

   Nothing here is a step or a member of a sequence: a card move, a bench, a
   discard and a chat message are all left alone, because each of them means
   something on its own.
*/
const COALESCE = {
   turnChanged: () => 'turnChanged',
   timerUpdated: () => 'timerUpdated',
   powerMarker: () => 'powerMarker',
   powerMarkerUsed: () => 'powerMarkerUsed',
   pokemonToggle: () => 'pokemonToggle',
   prizeToggle: () => 'prizeToggle',
   handToggle: () => 'handToggle',
   damageUpdated: (data) => `damageUpdated:${data?.slotId}`,
   statusUpdated: (data) => `statusUpdated:${data?.slotId}`,
   abilityUpdated: (data) => `abilityUpdated:${data?.slotId}`
}

const coalesceKey = (event, data) => (COALESCE[event] ? COALESCE[event](data) : null)

/*
   A board in a tab nobody is looking at does not need news by the second. While
   the document is hidden the poll asks the server to check its cursor far less
   often - that check is where the relay's Redis commands come from - which takes
   a hidden tab to roughly a fifth of the cost. It still holds the request open,
   so presence stays fresh and news still arrives, just checked for lazily; a
   glance back at the tab re-polls at once, so the board is up to date by the time
   it is read.
*/
const HIDDEN_INTERVAL_MS = 20000

/*
   A board nobody has touched for this long gets the same treatment: checked on
   lazily rather than every couple of seconds, and the app is told, so it can say
   so on screen. Any input - a click, a key, an action of our own, or news from
   the other side - puts it straight back on the normal beat.
*/
const IDLE_AFTER_MS = 10 * 60 * 1000
const IDLE_INTERVAL_MS = 30000

/* where a room and a seat are remembered between page loads */
const SESSION_KEY = 'pvp_session'

function readSession () {
   try {
      const raw = globalThis.localStorage?.getItem(SESSION_KEY)
      return raw ? JSON.parse(raw) : null
   } catch {
      return null
   }
}

function writeSession (session) {
   try {
      if (session) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(session))
      else globalThis.localStorage?.removeItem(SESSION_KEY)
   } catch {
      /* private mode, or storage disabled: reconnecting is a convenience, not a promise */
   }
}

async function readJson (res) {
   const text = await res.text()
   if (!text) return {}
   try {
      return JSON.parse(text)
   } catch {
      throw new Error(`relay returned non-JSON response (${res.status})`)
   }
}

export class HttpSocket {
   constructor ({ baseUrl = '', wait = POLL_WAIT_MS, fetchImpl = null } = {}) {
      this.base = baseUrl
      this.wait = wait
      this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args))

      this.id = null // member id, set once a room is created or joined
      this.roomId = null
      this.role = null // 'host' | 'guest' | 'spectator'
      this.cursor = 0
      this.connected = false
      this.active = false

      this.listeners = new Map() // event name -> Set<fn>
      this.anyListeners = new Set()
      this.opponentPresent = null // null = not yet known
      this.players = [] // members holding the two playing seats, in join order
      this.seats = [] // the seats `seated` was last raised with

      this.controller = null
      this.loop = null

      /*
         Told "this room is not there any more", with the relay's reason, before
         the socket forgets it. The transport is what finds out - a poll comes
         back gone - but what that means (a game that ended, and the board to
         clear) belongs to the app, so it is handed over rather than decided
         here.
      */
      this.goneListeners = new Set()

      /* when this client last did, or heard, anything */
      this.lastActivity = Date.now()
      this.isIdle = false

      /* the wait a room is under, so the same one is not announced twice */
      this.waitKey = 0

      /* this browser's clock against the relay's, for events that arrive late */
      this.skew = 0

      /*
         The last few faults, newest last, for the diagnostics screen and for a
         bug report. Nothing here is delivered as an event: this is a record, not
         a signal, so recording a failure can never cause another one.
      */
      this.errors = []

      /*
         Outbound pacing. Everything share()/publishLog() sends goes through this
         queue, so a burst of actions cannot outrun the relay's cost.
      */
      this.queue = []
      this.tokens = SEND_BURST
      this.lastRefill = Date.now()
      this.drainTimer = null
      this.blockedUntil = 0
   }

   /*
      Note something that went wrong, or something that was quietly ignored.
      `kind` is short and greppable ('poll', 'send', 'handler:boardState').
   */
   recordError (kind, message) {
      this.errors.push({
         at: Date.now(),
         kind: String(kind),
         message: String(message ?? 'no message').slice(0, 300)
      })
      if (this.errors.length > MAX_RELAY_ERRORS) {
         this.errors.splice(0, this.errors.length - MAX_RELAY_ERRORS)
      }
      return this
   }

   /* the newest fault, for a one-line "relay: ..." note in the connection panel */
   lastError () {
      return this.errors.length ? this.errors[this.errors.length - 1] : null
   }

   /*
      Watch for the room going away. Called with the relay's reason, of which
      these matter: 'closed' (a player left, or an idle room went unanswered) and
      'idle' are games that ended, which is worth saying on screen; 'expired' is
      the 6h TTL and is not news.
   */
   onGone (cb) {
      this.goneListeners.add(cb)
      return () => this.goneListeners.delete(cb)
   }

   raiseGone (reason) {
      for (const cb of [...this.goneListeners]) {
         try {
            cb(reason)
         } catch (err) {
            console.error('[relay] gone handler threw', err)
            this.recordError('gone', err.message)
         }
      }
   }

   /* ------------------------------------------------------------ lifecycle -- */

   connect () {
      if (this.active) return
      this.active = true

      /* one listener each, so a hidden tab slows down and a visible one catches up */
      if (typeof document !== 'undefined' && !this.onVisibility) {
         this.onVisibility = () => { if (!this.hidden()) this.touch() }
         document.addEventListener('visibilitychange', this.onVisibility)

         /*
            Anything the person does counts as activity: it means somebody is
            looking at the board, so the lazy beat is no longer appropriate.
         */
         this.onInput = () => this.touch()
         document.addEventListener('pointerdown', this.onInput, true)
         document.addEventListener('keydown', this.onInput, true)
      }

      /*
         Watched for on its own timer rather than only when a poll starts, which
         can be most of a long-poll away: the point of the notice is that it
         arrives soon after the board goes quiet.
      */
      if (!this.idleTimer) {
         this.idleTimer = setInterval(() => { if (this.roomId) this.markIdle() }, 5000)
      }

      /*
         pagehide, not unload: it is the event that actually fires on a tab
         close, a navigation away and a bfcache store, and unlike unload it does
         not disable the back/forward cache. The room and the seat are read from
         this socket at the moment it fires, because by then the app's stores may
         already have been torn down.
      */
      if (typeof window !== 'undefined' && !this.onPageHide) {
         this.onPageHide = () => { this.beaconAway() }
         window.addEventListener('pagehide', this.onPageHide)
      }

      this.loop = this.run()
      if (this.roomId) this.kick()
   }

   markIdle () {
      if (this.isIdle || this.idleFor() < IDLE_AFTER_MS) return
      this.isIdle = true
      this.deliver('idle', { idle: true })
   }

   hidden () {
      return typeof document !== 'undefined' && document.hidden === true
   }

   /*
      The relay's clock, as this browser understands it: polls carry the server's
      own `now`, so a client can age a timer that was set elsewhere and count it
      down in step with everyone else, whatever the two machines' clocks say. Only
      the difference matters, and it is re-estimated on every poll.
   */
   serverNow () {
      return Date.now() + this.skew
   }

   /* somebody is here: back to the normal rhythm, and catch up at once */
   touch () {
      this.lastActivity = Date.now()

      if (this.isIdle) {
         this.isIdle = false
         this.deliver('idle', { idle: false })
      }

      this.kick()
   }

   /* the app's "Reconnect" button, and what any input does anyway */
   resume () {
      this.touch()
      return { ok: true }
   }

   idleFor () {
      return Date.now() - this.lastActivity
   }

   disconnect () {
      this.active = false
      this.setConnected(false)
      this.abortPoll()
      this.clearQueue()
      if (typeof document !== 'undefined') {
         if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility)
         if (this.onInput) {
            document.removeEventListener('pointerdown', this.onInput, true)
            document.removeEventListener('keydown', this.onInput, true)
         }
      }
      if (typeof window !== 'undefined' && this.onPageHide) {
         window.removeEventListener('pagehide', this.onPageHide)
      }
      this.onVisibility = null
      this.onInput = null
      this.onPageHide = null
      if (this.idleTimer) {
         clearInterval(this.idleTimer)
         this.idleTimer = null
      }
      if (this.loop) {
         this.loop.catch(() => {})
         this.loop = null
      }
   }

   /* ----------------------------------------------------------------- events -- */

   on (event, cb) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event).add(cb)
      return this
   }

   off (event, cb) {
      if (cb && this.listeners.has(event)) this.listeners.get(event).delete(cb)
      else this.listeners.delete(event)
      return this
   }

   onAny (cb) {
      this.anyListeners.add(cb)
      return this
   }

   /*
      Send an event to the rest of the room. Fire-and-forget, matching
      socket.io's signature.

      A sent event is deliberately NOT delivered to local listeners. The app
      registers its opponent-side handlers with `socket.on(...)`, so echoing our
      own event back would run them against our own action: drawing a card made
      the *opponent's* hand grow, and pressing Setup applied our board state to
      the opponent's board. The original socket.io server never echoed to the
      sender either.
   */
   emit (event, data) {
      /* nothing to relay to; share() is where that is reported */
      if (!this.roomId) return null

      const item = { event, data: data ?? {}, retries: 0 }
      const key = coalesceKey(event, item.data)

      if (key) {
         /*
            An event for the same thing is still waiting its turn. This one carries
            a value rather than a step, so it simply replaces it - the newest is
            the only one that matters, and nothing is lost.
         */
         const pending = this.queue.find((queued) => queued.key === key)
         if (pending) {
            pending.data = item.data
            this.drain()
            return null
         }
         item.key = key
         /* held briefly so another press of the same thing can replace it */
         item.notBefore = Date.now() + COALESCE_SETTLE_MS
      }

      if (this.queue.length >= MAX_QUEUE) {
         /*
            Only reachable from a client ignoring the pace, since coalescing means
            a human mashing one control never grows the queue. Dropping the oldest
            keeps the newest actions, which are the ones the player is waiting on.
         */
         this.queue.shift()
         this.recordError(`send:${event}`, `outbound queue is full (${MAX_QUEUE}); the oldest queued event was dropped`)
      }

      this.queue.push(item)
      this.drain()
      return null
   }

   /* how many actions are waiting to go out, for the diagnostics panel */
   get pending () {
      return this.queue.length
   }

   /*
      Send as much as the pace allows, then arrange to come back when it allows
      more. Called on every emit and whenever a send finishes or fails.
   */
   drain () {
      if (this.drainTimer) {
         clearTimeout(this.drainTimer)
         this.drainTimer = null
      }

      const now = Date.now()

      /* a send was refused: wait out the backoff before trying again */
      if (now < this.blockedUntil) {
         this.scheduleDrain(this.blockedUntil - now)
         return
      }

      const elapsed = now - this.lastRefill
      if (elapsed > 0) {
         this.tokens = Math.min(SEND_BURST, this.tokens + (elapsed / 1000) * SEND_PER_SECOND)
         this.lastRefill = now
      }

      while (this.queue.length && this.tokens >= 1) {
         const head = this.queue[0]

         /* still inside its settle window, so a later press can still replace it */
         const held = (head.notBefore || 0) - Date.now()
         if (held > 0) {
            this.scheduleDrain(held)
            return
         }

         this.tokens -= 1
         this.sendOne(this.queue.shift())
      }

      if (this.queue.length) {
         /* whichever comes first: the head's settle window, or the next token */
         const held = Math.max(0, (this.queue[0].notBefore || 0) - Date.now())
         const tokenIn = Math.ceil(((1 - this.tokens) / SEND_PER_SECOND) * 1000)
         this.scheduleDrain(Math.max(held, tokenIn, 1))
      }
   }

   scheduleDrain (ms) {
      if (this.drainTimer) return
      this.drainTimer = setTimeout(() => {
         this.drainTimer = null
         this.drain()
      }, Math.max(1, ms))
   }

   sendOne (item) {
      this.post(item.event, item.data).catch((err) => {
         console.error('[relay] send failed', err)
         this.recordError(`send:${item.event}`, err.message)

         /*
            Not dropped: put it back at the front so the action survives, and pause
            before trying again. A 429 from the relay's own ceiling lands here too,
            which is what makes the two limits work together instead of fighting -
            the relay is the backstop, and this queue is what stops it being needed.
         */
         if (item.retries < MAX_SEND_RETRIES) {
            item.retries += 1
            this.queue.unshift(item)
            this.blockedUntil = Date.now() + RETRY_BACKOFF_MS
         } else {
            this.recordError(`send:${item.event}`, 'gave up after repeated failures; that action was not relayed')
         }

         this.drain()
      })
   }

   /* leaving a room: whatever was queued belonged to it */
   clearQueue () {
      if (this.drainTimer) {
         clearTimeout(this.drainTimer)
         this.drainTimer = null
      }
      this.queue = []
      this.blockedUntil = 0
      this.tokens = SEND_BURST
      this.lastRefill = Date.now()
   }

   /* ------------------------------------------------------------------ rooms -- */

   async createRoom (name = null) {
      return this.room('create', { name })
   }

   async joinRoom (roomId, name = null) {
      return this.room('join', { roomId, name })
   }

   /* watch only - never takes a playing seat */
   async spectateRoom (roomId, name = null) {
      return this.room('join', { roomId, role: 'spectator', name })
   }

   get spectating () {
      return this.role === 'spectator'
   }

   async leaveRoom (roomId) {
      const id = roomId || this.roomId
      this.abortPoll()
      try {
         await this.request('/api/relay/room', {
            method: 'POST',
            body: { action: 'leave', roomId: id, memberId: this.id }
         })
      } catch (err) {
         console.error('[relay] leave failed', err)
         this.recordError('leave', err.message)
      }
      this.forget()
      return { ok: true }
   }

   /*
      Leaving because the tab is going away, which cannot wait for a reply.

      sendBeacon is the only request a browser promises to finish while a page is
      unloading - a normal fetch is cancelled with the page. It is a plain POST of
      the same body the leave call sends, plus one field that says which of the
      two this was, so the relay needs no special case for the request itself. A
      text/plain content type is used deliberately: it is a CORS-simple
      request, so a beacon to a relay on another origin is not turned into a
      preflight the browser will not wait for. The server parses the JSON body
      either way.

      `agentOffline` is what tells the relay that nobody chose this: the tab was
      closed, refreshed, or lost its network. A player who clicks Leave Room uses
      the normal call and does not send it, and the two mean opposite things - so
      the relay ends the game for one and holds the seat for the other. Without
      the flag a beacon and a button press would be indistinguishable, and an
      opponent who deliberately walked out would be waited for instead of told
      about.

      What this is for: a spectator closing the tab is a leave that no button
      ever sees, and without it their member record lingers - and so does the
      spectator count in everybody else's header - until the sweep notices.
   */
   beaconAway () {
      if (!this.roomId || !this.id) return false
      if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false

      const body = JSON.stringify({
         action: 'leave',
         roomId: this.roomId,
         memberId: this.id,
         agentOffline: true
      })

      /*
         The remembered session goes with it. A tab that closed is not a seat
         anybody can come back to, and leaving it in localStorage is what would
         make the next page load try to rejoin a room this browser has just
         walked out of.
      */
      writeSession(null)

      try {
         return navigator.sendBeacon(
            `${this.base}/api/relay/room`,
            new Blob([body], { type: 'text/plain;charset=UTF-8' })
         )
      } catch (err) {
         this.recordError('leave', `could not send the closing beacon: ${err.message}`)
         return false
      }
   }

   /*
      Out of the room, and no longer worth reconnecting to. The session is what
      lets a reload come back to the same seat, so it goes when the player leaves
      on purpose or the room itself is gone.
   */
   forget () {
      writeSession(null)
      this.clearQueue()
      this.id = null
      this.roomId = null
      this.cursor = 0
      this.role = null
      this.players = []
      this.seats = []
      this.opponentPresent = null
      this.waitKey = 0
      this.deliver('leftRoom', {})
   }

   /*
      Back to the room this browser was last in, as the same member: the relay
      knows the id, so it hands back the same seat and role rather than seating
      somebody new (or refusing a player their own seat because the room is full).
      The board itself is rebuilt from the event log, which the poll replays from
      the start of the room's history.
   */
   async resumeSession (name = null) {
      const saved = readSession()
      if (!saved?.roomId || !saved?.memberId) return null

      this.id = saved.memberId
      this.connect()

      try {
         return saved.role === 'spectator'
            ? await this.spectateRoom(saved.roomId, name)
            : await this.joinRoom(saved.roomId, name)
      } catch (err) {
         console.error('[relay] could not rejoin the last room', err)
         this.forget()
         return null
      }
   }

   remember () {
      writeSession({ roomId: this.roomId, memberId: this.id, role: this.role })
   }

   async room (action, extra = {}) {
      this.connect()

      const res = await this.request('/api/relay/room', {
         method: 'POST',
         body: {
            action,
            memberId: this.id,
            ...extra
         }
      })
      if (res.error) throw new Error(res.error)

      if (typeof res.now === 'number') this.skew = res.now - Date.now()

      this.id = res.memberId
      this.roomId = res.roomId
      this.role = res.role || 'guest'
      this.players = res.players || []
      this.seats = this.players.map((player) => player?.id ?? null)
      this.cursor = res.seq || 0
      this.opponentPresent = false
      this.setConnected(true)
      this.lastActivity = Date.now()
      this.remember()

      /*
         Tell the app it is in a room. Under socket.io the server sent these,
         so the store relied on them; here the client has to raise them itself,
         otherwise `room` stays null and the UI never leaves the lobby.
      */
      if (this.spectating) this.deliver('spectatingRoom', { roomId: res.roomId, role: this.role })
      else this.deliver(action === 'create' ? 'createdRoom' : 'joinedRoom', { roomId: res.roomId, role: this.role })

      /*
         How long this room will wait for a second player. Only a creator is
         told, and only once: it arrives with the room they just made, not on
         every poll.
      */
      this.deliver('roomWait', { hostWait: res.hostWait || null, rejoin: res.rejoin || null })

      /* who holds the two playing seats - a spectator seats them on screen */
      this.deliver('seated', { players: this.players })

      // Replay anything already in the room (the opponent's board state, their
      // deck, chat) through the same path polled events take. Our own events are
      // skipped: they were applied when we sent them, and the opponent re-sends
      // a full board state on join anyway.
      for (const event of res.events || []) {
         this.cursor = Math.max(this.cursor, event.seq)
         if (event.from && event.from === this.id) continue
         this.apply(event)
      }

      return res
   }

   /*
      Apply one relayed event.

      A member's own events come back on the poll (the room is a single ordered
      log, so there is no way to receive the opponent's events without also
      seeing your own). They are handed to listeners with `self: true` so a
      handler can choose to ignore its own action instead of applying it twice
      - which is what made a message appear twice in the log.
   */
   apply (event) {
      /*
         Not in a room: apply nothing.
         A poll already in flight when this client left, or a reply that crossed
         the leave, carries the room's events - and applying them rebuilds the
         board this browser has just walked away from. The case that made this
         necessary: a player left a room, their board was correctly emptied, and
         the other player's next full board state then landed in the mirror for
         an opponent who no longer had a room - so the lobby showed a game still
         in progress, with somebody else's cards on it.
      */
      if (!this.roomId) return

      const self = Boolean(event.from) && event.from === this.id
      /*
         The event's own data goes through untouched. It has to: a game timer
         arrives carrying `at`, the moment it was set, and overwriting that with
         the event's timestamp made two clients each think the other had changed
         the clock - so they answered each other, for ever.
      */
      this.deliver(event.name, event.data, { meta: event, self })
   }

   /* ------------------------------------------------------------------- wire -- */

   async request (url, { method = 'GET', body } = {}) {
      const options = {
         method,
         headers: {}
      }
      if (body !== undefined) {
         options.headers['Content-Type'] = 'application/json'
         options.body = JSON.stringify(body)
      }

      const res = await this.fetch(this.base + url, options)
      const payload = await readJson(res)
      if (!res.ok) {
         const err = new Error(payload.error || `relay request failed (${res.status})`)
         /* kept so a caller can tell "slow down" from "broken" */
         err.status = res.status
         throw err
      }
      return payload
   }

   async post (event, data) {
      if (!this.roomId) {
         // Not in a room yet: nothing to relay to, but keep local behaviour.
         return null
      }

      const res = await this.request('/api/relay/events', {
         method: 'POST',
         body: {
            roomId: this.roomId,
            memberId: this.id,
            event,
            data: data ?? {}
         }
      })
      if (res.error) throw new Error(res.error)

      /* our own action: certainly not idle, and worth checking for news at once */
      this.touch()
      return res.event
   }

   /* --------------------------------------------------------------- polling -- */

   abortPoll () {
      if (this.controller) {
         this.controller.abort()
         this.controller = null
      }
   }

   /* Abort the in-flight long poll so the loop re-polls immediately. */
   kick () {
      this.abortPoll()
   }

   async run () {
      while (this.active) {
         if (!this.roomId) {
            await this.sleep(POLL_IDLE_MS)
            continue
         }

         try {
            await this.poll()
         } catch (err) {
            if (err && err.name === 'AbortError') continue
            this.setConnected(false)
            console.error('[relay] poll failed', err)
            this.recordError('poll', err.message)
            await this.sleep(POLL_IDLE_MS)
         }
      }
   }

   async poll () {
      const controller = new AbortController()
      this.controller = controller

      const timer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS)

      const params = new URLSearchParams({
         roomId: this.roomId,
         memberId: this.id,
         since: String(this.cursor),
         wait: String(this.wait)
      })

      /*
         Ask to be checked for lazily when nobody is looking at this board: a
         hidden tab, or one that has been left alone for ten minutes. The server
         only ever honours a slower interval than its own default.
      */
      if (this.hidden()) params.set('interval', String(HIDDEN_INTERVAL_MS))
      else if (this.isIdle || this.idleFor() >= IDLE_AFTER_MS) {
         this.markIdle()
         params.set('interval', String(IDLE_INTERVAL_MS))
      }

      let res
      try {
         res = await this.fetch(`${this.base}/api/relay/poll?${params}`, { signal: controller.signal })
      } finally {
         clearTimeout(timer)
         if (this.controller === controller) this.controller = null
      }

      const payload = await readJson(res)
      if (!res.ok) throw new Error(payload.error || `poll failed (${res.status})`)

      if (typeof payload.now === 'number') this.skew = payload.now - Date.now()

      if (payload.gone) {
         /*
            The room has been closed or expired. Say why before letting go of it:
            the app decides whether that is a dialog, and it cannot decide after
            the room id is gone.
         */
         const reason = payload.reason || 'expired'
         this.raiseGone(reason)
         this.forget()
         return
      }

      this.setConnected(true)
      this.trackPresence(payload.opponent)
      this.trackSeats(payload.players)
      this.trackWait(payload)

      for (const event of payload.events || []) {
         this.cursor = Math.max(this.cursor, event.seq)
         if (event.from && event.from === this.id) {
            // our own action: already applied locally when it was sent
            continue
         }
         /*
            News from the other side counts as life: a board the opponent is
            playing on should not be checked for lazily, or their move would sit
            unseen for half a minute.
         */
         this.lastActivity = Date.now()
         this.apply(event)
      }
      if (payload.seq) this.cursor = Math.max(this.cursor, payload.seq)

      /*
         The server already held this request open for `wait` milliseconds after
         the last event, so return straight into the next long poll. `kick()`
         aborts that poll the moment we emit, which is what keeps a move between
         the two players near-instant rather than poll-interval bound.
      */
   }

   sleep (ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
   }

   /* -------------------------------------------------------------- internal -- */

   trackPresence (opponent) {
      if (!opponent) return
      const present = Boolean(opponent.present)

      if (this.opponentPresent === null) {
         this.opponentPresent = present
         if (present) {
            this.deliver('opponentJoined', {})
            this.deliver('opponentPresent', { present })
         }
         return
      }

      if (present !== this.opponentPresent) {
         this.opponentPresent = present
         this.deliver(present ? 'opponentJoined' : 'opponentLeft', {})
         this.deliver('opponentPresent', { present })
      }
   }

   /*
      The two playing seats, as reported by the relay: each is { id, name }. They
      are not fixed when a spectator arrives - the second player may sit down
      later - so every poll carries them, and `seated` is raised whenever the
      seats actually change.
   */
   trackSeats (players) {
      if (!Array.isArray(players)) return

      const ids = players.map((player) => player?.id ?? null)
      const same = ids.length === this.seats.length &&
         ids.every((id, index) => id === this.seats[index])
      if (same) return

      this.seats = ids
      this.deliver('seated', { players })
   }

   /*
      The waits a room can be under: for a second player to arrive, and for one
      who vanished to come back. Both are carried on every poll but only raised
      when they change, because the poll is the only thing that runs often
      enough to notice - and a countdown that was re-announced several times a
      minute would restart a render every time for no new information.

      `deadlineAt` is on the relay's clock, like the game timer's `at`, so the
      component counts down against `serverNow()` and two browsers with
      different clocks agree on what is left.
   */
   trackWait (payload) {
      const rejoin = payload?.rejoin || null
      const key = rejoin ? Number(rejoin.deadlineAt) || 0 : 0
      if (key === this.waitKey) return

      this.waitKey = key
      this.deliver('roomWait', { hostWait: null, rejoin })
   }

   setConnected (value) {
      if (this.connected === value) return
      this.connected = value
      this.deliver(value ? 'connect' : 'disconnect', {})
   }

   deliver (event, data, { meta = null, local = false } = {}) {
      /*
         Whether anything is listening for this event at all. An event that
         arrives and is applied by nobody is the failure that took the longest to
         find in the spectator bugs - the relay was healthy, the poll delivered
         everything, and the client silently dropped it - so the answer is
         computed here and handed to the observers below rather than guessed at
         afterwards.
      */
      const handlers = this.listeners.get(event)
      const handled = Boolean(handlers && handlers.size)

      for (const cb of this.anyListeners) {
         try {
            cb(event, data, meta, local, handled)
         } catch (err) {
            console.error(`[relay] onAny handler for "${event}" threw`, err)
            this.recordError(`onAny:${event}`, err.message)
         }
      }

      if (!handled) return

      for (const cb of [...handlers]) {
         try {
            cb(data, meta, { local })
         } catch (err) {
            console.error(`[relay] handler for "${event}" threw`, err)
            this.recordError(`handler:${event}`, err.message)
         }
      }
   }
}

export function createHttpSocket (options) {
   return new HttpSocket({ baseUrl: '', ...options })
}
