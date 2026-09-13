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

      this.controller = null
      this.loop = null
   }

   /* ------------------------------------------------------------ lifecycle -- */

   connect () {
      if (this.active) return
      this.active = true
      this.loop = this.run()
      if (this.roomId) this.kick()
   }

   disconnect () {
      this.active = false
      this.setConnected(false)
      this.abortPoll()
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

   async createRoom () {
      return this.room('create')
   }

   async joinRoom (roomId) {
      return this.room('join', { roomId })
   }

   /* watch only - never takes a playing seat */
   async spectateRoom (roomId) {
      return this.room('join', { roomId, role: 'spectator' })
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
      this.roomId = null
      this.cursor = 0
      this.role = null
      this.players = []
      this.opponentPresent = null
      this.deliver('leftRoom', {})
      return { ok: true }
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
      this.cursor = res.seq || 0
      this.opponentPresent = false
      this.setConnected(true)

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

      this.kick() // re-poll now instead of waiting out the interval
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
         this.roomId = null
         this.deliver('leftRoom', {})
         return
      }

      this.setConnected(true)
      this.trackPresence(payload.opponent)

      for (const event of payload.events || []) {
         this.cursor = Math.max(this.cursor, event.seq)
         if (event.from && event.from === this.id) {
            // our own action: already applied locally when it was sent
            continue
         }
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
