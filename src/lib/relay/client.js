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

      /* when this client last did, or heard, anything */
      this.lastActivity = Date.now()
      this.isIdle = false
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
      if (typeof document !== 'undefined') {
         if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility)
         if (this.onInput) {
            document.removeEventListener('pointerdown', this.onInput, true)
            document.removeEventListener('keydown', this.onInput, true)
         }
      }
      this.onVisibility = null
      this.onInput = null
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
      this.post(event, data).catch((err) => console.error('[relay] send failed', err))
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
      }
      this.forget()
      return { ok: true }
   }

   /*
      Out of the room, and no longer worth reconnecting to. The session is what
      lets a reload come back to the same seat, so it goes when the player leaves
      on purpose or the room itself is gone.
   */
   forget () {
      writeSession(null)
      this.id = null
      this.roomId = null
      this.cursor = 0
      this.role = null
      this.players = []
      this.seats = []
      this.opponentPresent = null
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
      const self = Boolean(event.from) && event.from === this.id
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
         throw new Error(payload.error || `relay request failed (${res.status})`)
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

      if (payload.gone) {
         // The room expired or no longer exists; drop back to the lobby.
         this.forget()
         return
      }

      this.setConnected(true)
      this.trackPresence(payload.opponent)
      this.trackSeats(payload.players)

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

   setConnected (value) {
      if (this.connected === value) return
      this.connected = value
      this.deliver(value ? 'connect' : 'disconnect', {})
   }

   deliver (event, data, { meta = null, local = false } = {}) {
      for (const cb of this.anyListeners) {
         try {
            cb(event, data, meta, local)
         } catch (err) {
            console.error(`[relay] onAny handler for "${event}" threw`, err)
         }
      }

      const handlers = this.listeners.get(event)
      if (!handlers) return

      for (const cb of [...handlers]) {
         try {
            cb(data, meta, { local })
         } catch (err) {
            console.error(`[relay] handler for "${event}" threw`, err)
         }
      }
   }
}

export function createHttpSocket (options) {
   return new HttpSocket({ baseUrl: '', ...options })
}
