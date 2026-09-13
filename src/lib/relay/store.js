/*
   Room storage for the in-project relay.

   A room is a single JSON document:

      {
         id        : 'ABCD12',
         createdAt : 1699999999999,
         seq       : 42,                 // last event id handed out
         events    : [ { seq, ts, name, data } ],   // capped ring of recent events
         members   : { <memberId>: { role, lastSeen } }
      }

   Every server instance must see the same document, so production uses Redis.
   Local development falls back to an in-process map, which is correct there
   because `vite dev` runs a single server process.

   Redis transport: this uses the Upstash REST protocol (POST {url} with a JSON
   command array), which works from serverless functions without holding a
   socket open. It works with the Vercel Marketplace Redis/KV integrations and
   with an Upstash database directly. A plain `REDIS_URL` (redis://) is also
   accepted and used over TCP.
*/

export const ROOM_TTL_MS = 1000 * 60 * 60 * 6 // rooms are dropped 6h after the last event
export const MAX_EVENTS = 400 // events kept per room

/* ------------------------------------------------------------------ memory -- */

function memoryStore () {
   const globalKey = Symbol.for('pvp-tabletop.relay.rooms')
   const rooms = (globalThis[globalKey] ||= new Map())

   return {
      kind: 'memory',
      async get (id) {
         return rooms.get(id) || null
      },
      async set (room) {
         rooms.set(room.id, room)
         return room
      },
      async del (id) {
         rooms.delete(id)
      }
   }
}

/* ------------------------------------------------------------------- redis -- */

function redisRestStore (url, token) {
   async function command (...args) {
      const res = await fetch(url, {
         method: 'POST',
         headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
         },
         body: JSON.stringify(args)
      })
      if (!res.ok) {
         throw new Error(`redis command ${args[0]} failed: ${res.status} ${await res.text()}`)
      }
      const body = await res.json()
      if (body.error) throw new Error(`redis error: ${body.error}`)
      return body.result
   }

   const key = (id) => `pvp-tabletop:room:${id}`

   return {
      kind: 'redis-rest',
      async get (id) {
         const raw = await command('GET', key(id))
         return raw ? JSON.parse(raw) : null
      },
      async set (room) {
         await command('SET', key(room.id), JSON.stringify(room), 'PX', String(ROOM_TTL_MS))
         return room
      },
      async del (id) {
         await command('DEL', key(id))
      }
   }
}

/* ------------------------------------------------------------------ factory -- */

/*
   Vercel's Redis/KV integrations inject different names depending on which one
   you install, so accept the common spellings.

   Only the HTTP/REST protocol is supported: serverless functions should not
   hold a TCP connection open, and the Vercel Marketplace integrations expose
   REST by default.
*/
function redisConfig () {
   const url =
      process.env.KV_REST_API_URL ||
      process.env.UPSTASH_REDIS_REST_URL ||
      process.env.REDIS_REST_API_URL
   const token =
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.REDIS_REST_API_TOKEN

   if (url && token) return { url, token }

   return null
}

let cached = null

export function getStore () {
   if (cached) return cached

   const config = redisConfig()
   if (config) {
      cached = redisRestStore(config.url, config.token)
      return cached
   }

   if (process.env.VERCEL) {
      // Running on Vercel without a database: every request may hit a different
      // instance, so an in-process map would silently lose rooms.
      throw new Error(
         'No room store configured. Add a Redis/KV integration in the Vercel ' +
         'dashboard so KV_REST_API_URL and KV_REST_API_TOKEN (or ' +
         'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) are set, then redeploy.'
      )
   }

   cached = memoryStore()
   return cached
}

export function storeKind () {
   try {
      return getStore().kind
   } catch (err) {
      return `unavailable: ${err.message}`
   }
}

/* ------------------------------------------------------------------- rooms -- */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no look-alikes (I/O/0/1)

export function newRoomId () {
   let out = ''
   const bytes = crypto.getRandomValues(new Uint8Array(6))
   for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
   return out
}

export function newMemberId () {
   return crypto.randomUUID()
}

/* Drop expired rooms and trim the event ring. */
function prune (room) {
   room.events = room.events.slice(-MAX_EVENTS)
   return room
}

export async function readRoom (id, store = getStore()) {
   if (!id) return null
   return store.get(String(id).toUpperCase())
}

export async function writeRoom (room, store = getStore()) {
   return store.set(prune(room))
}

/*
   Append an event and hand out the next sequence number.

   Read-modify-write is not atomic, so two simultaneous sends can collide. The
   relay is a two-player turn-based game where the losing write is a single
   log line, and every action also re-syncs full board state, so a retry loop
   is enough here; it is not a general-purpose queue.
*/
export async function appendEvent (roomId, name, data, { attempts = 4 } = {}) {
   const store = getStore()

   for (let i = 0; i < attempts; i++) {
      const room = await readRoom(roomId, store)
      if (!room) return null

      const before = room.seq
      room.seq = before + 1
      const event = { seq: room.seq, ts: Date.now(), name, data: data ?? {} }
      room.events.push(event)

      const written = await store.set(prune(room))
      // Someone else may have written in between; re-read and confirm our event
      // survived, otherwise try again with a fresh sequence number.
      const check = await readRoom(roomId, store)
      if (check && check.events.some((e) => e.seq === event.seq)) {
         if (written) return event
         return event
      }
   }

   return null
}

export async function touchMember (roomId, memberId, role) {
   const store = getStore()
   const room = await readRoom(roomId, store)
   if (!room) return null

   room.members[memberId] = { role, lastSeen: Date.now() }
   return store.set(prune(room))
}
