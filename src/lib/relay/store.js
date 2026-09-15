/*
   Room storage for the in-project relay.

   Keys (all namespaced under the room):

      pvp:room:<id>:meta      JSON { id, createdAt }      room existence
      pvp:room:<id>:seq       integer                     last event number
      pvp:room:<id>:events    list of JSON events, newest first
      pvp:room:<id>:members   hash: memberId -> JSON { role, name, lastSeen }

   Every room mutation is a *single-key* atomic Redis command (INCR, LPUSH,
   HSET, SET, DEL). That matters: Vercel runs each request on its own instance
   and a player's long poll is always in flight, so anything that reads the
   whole room, mutates and writes it back loses concurrent updates. An earlier
   version stored the room as one JSON document and did exactly that, which
   silently dropped events and made the room look like it had vanished.

   Members live in one hash rather than a key each: a poll then reads them with
   a single HGETALL, and nothing anywhere has to run KEYS over the keyspace.

   Production uses Redis over the Upstash REST protocol (POST {url} with a JSON
   command array), which works from serverless functions without holding a
   socket open. Local development falls back to an in-process map, which is
   correct because `vite dev` serves one request at a time.
*/

export const ROOM_TTL_S = 60 * 60 * 6 // rooms are dropped 6h after the last write
export const MAX_EVENTS = 400 // events kept per room

/* ------------------------------------------------------------------ memory -- */

function memoryStore () {
   const globalKey = Symbol.for('pvp-tabletop.relay.rooms2')
   const db = (globalThis[globalKey] ||= { meta: new Map(), seq: new Map(), events: new Map(), members: new Map() })

   const mkey = (id, mid) => `${id}|${mid}`

   return {
      kind: 'memory',

      async getMeta (id) {
         return db.meta.get(id) || null
      },
      async setMeta (id, meta, { nx = false } = {}) {
         if (nx && db.meta.has(id)) return false
         db.meta.set(id, meta)
         return true
      },
      async delRoom (id) {
         db.meta.delete(id)
         db.seq.delete(id)
         db.events.delete(id)
         for (const key of [...db.members.keys()]) {
            if (key.startsWith(id + '|')) db.members.delete(key)
         }
      },

      async nextSeq (id) {
         const next = (db.seq.get(id) || 0) + 1
         db.seq.set(id, next)
         return next
      },
      /* null means "no event yet", which is also how redis answers a missing key */
      async getSeq (id) {
         return db.seq.has(id) ? db.seq.get(id) : null
      },
      async pushEvent (id, event) {
         const list = db.events.get(id) || []
         list.unshift(event)
         db.events.set(id, list.slice(0, MAX_EVENTS))
      },
      async listEvents (id) {
         return (db.events.get(id) || []).slice(0, MAX_EVENTS)
      },

      async setMember (id, mid, member) {
         db.members.set(mkey(id, mid), member)
      },
      async getMember (id, mid) {
         return db.members.get(mkey(id, mid)) || null
      },
      async delMember (id, mid) {
         db.members.delete(mkey(id, mid))
      },
      async listMembers (id) {
         const out = []
         for (const [key, member] of db.members) {
            if (key.startsWith(id + '|')) out.push({ id: key.slice(id.length + 1), ...member })
         }
         return out
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
         throw new Error(`redis ${args[0]} failed: ${res.status} ${await res.text()}`)
      }
      const body = await res.json()
      if (body.error) throw new Error(`redis error: ${body.error}`)
      return body.result
   }

   /* MULTI/EXEC so a seq bump and its LPUSH/LTRIM land together */
   async function pipeline (commands) {
      const res = await fetch(`${url}/pipeline`, {
         method: 'POST',
         headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
         },
         body: JSON.stringify(commands)
      })
      if (!res.ok) {
         throw new Error(`redis pipeline failed: ${res.status} ${await res.text()}`)
      }
      const body = await res.json()
      for (const step of body) {
         if (step.error) throw new Error(`redis error: ${step.error}`)
      }
      return body.map((step) => step.result)
   }

   const k = {
      meta: (id) => `pvp:room:${id}:meta`,
      seq: (id) => `pvp:room:${id}:seq`,
      events: (id) => `pvp:room:${id}:events`,
      members: (id) => `pvp:room:${id}:members`
   }

   return {
      kind: 'redis-rest',

      async getMeta (id) {
         const raw = await command('GET', k.meta(id))
         return raw ? JSON.parse(raw) : null
      },
      async setMeta (id, meta, { nx = false } = {}) {
         const args = ['SET', k.meta(id), JSON.stringify(meta), 'EX', String(ROOM_TTL_S)]
         if (nx) args.push('NX')
         const result = await command(...args)
         /* with NX, redis replies OK on write and nil when the key existed */
         return nx ? result === 'OK' : true
      },
      async delRoom (id) {
         await command('DEL', k.meta(id), k.seq(id), k.events(id), k.members(id))
      },

      async nextSeq (id) {
         const next = await command('INCR', k.seq(id))
         await command('EXPIRE', k.seq(id), String(ROOM_TTL_S))
         return next
      },
      async getSeq (id) {
         const raw = await command('GET', k.seq(id))
         return raw === null || raw === undefined ? null : Number(raw)
      },
      async pushEvent (id, event) {
         await pipeline([
            ['LPUSH', k.events(id), JSON.stringify(event)],
            ['LTRIM', k.events(id), '0', String(MAX_EVENTS - 1)],
            ['EXPIRE', k.events(id), String(ROOM_TTL_S)]
         ])
      },
      async listEvents (id) {
         const raw = await command('LRANGE', k.events(id), '0', String(MAX_EVENTS - 1))
         return (raw || []).map((line) => JSON.parse(line))
      },

      /* one hash, written field by field; the TTL rides along in a pipeline */
      async setMember (id, mid, member) {
         await pipeline([
            ['HSET', k.members(id), mid, JSON.stringify(member)],
            ['EXPIRE', k.members(id), String(ROOM_TTL_S)]
         ])
      },
      async getMember (id, mid) {
         const raw = await command('HGET', k.members(id), mid)
         return raw ? JSON.parse(raw) : null
      },
      async delMember (id, mid) {
         await command('HDEL', k.members(id), mid)
      },
      async listMembers (id) {
         const flat = await command('HGETALL', k.members(id))
         if (!flat || !flat.length) return []

         const out = []
         for (let i = 0; i < flat.length; i += 2) {
            out.push({ id: flat[i], ...(flat[i + 1] ? JSON.parse(flat[i + 1]) : {}) })
         }
         return out
      }
   }
}

/* ------------------------------------------------------------------ factory -- */

/*
   Vercel's Redis/KV integrations inject different names depending on which one
   you install, so accept the common spellings.
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

export function normalizeRoomId (id) {
   return String(id || '').toUpperCase().trim()
}

/*
   Create a room. SET NX guards against the (unlikely) id collision, so two
   simultaneous creates can never adopt each other's room.
*/
export async function createRoom (name = null) {
   const store = getStore()

   for (let attempt = 0; attempt < 5; attempt++) {
      const id = newRoomId()
      const meta = { id, createdAt: Date.now() }
      const created = await store.setMeta(id, meta, { nx: true })
      if (!created) continue

      const memberId = newMemberId()
      await store.setMember(id, memberId, { role: 'host', name: cleanName(name), lastSeen: Date.now() })
      return { roomId: id, memberId, role: 'host' }
   }

   throw new Error('could not allocate a room id')
}

/* display names are short and never empty (null means "no name given") */
export const MAX_NAME_LENGTH = 24

export function cleanName (name) {
   if (typeof name !== 'string') return null
   const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
   return trimmed || null
}

export async function getRoom (roomId) {
   const store = getStore()
   const id = normalizeRoomId(roomId)
   const meta = await store.getMeta(id)
   if (!meta) return null

   const [events, members] = await Promise.all([
      store.listEvents(id),
      store.listMembers(id)
   ])

   return { ...meta, events: events.reverse(), members }
}

/*
   Just the event cursor. A poll that is only waiting for something to happen
   reads this one key per turn of its loop instead of the whole room.
*/
export async function getRoomSeq (roomId) {
   const store = getStore()
   return store.getSeq(normalizeRoomId(roomId))
}

/* Roles that occupy one of the two playing seats. */
export const PLAYER_ROLES = ['host', 'guest']

export async function roomSummary (roomId) {
   const room = await getRoom(roomId)
   if (!room) return null

   const players = room.members.filter((m) => PLAYER_ROLES.includes(m.role))
   const spectators = room.members.filter((m) => m.role === 'spectator')

   return {
      roomId: room.id,
      players: players.length,
      maxPlayers: 2,
      locked: players.length >= 2,
      spectators: spectators.length
   }
}

/*
   Add the caller to a room.

   `role` defaults to a playing seat ('guest'), which is only granted while one
   is free - once two players have joined the lobby is locked and further
   arrivals are spectators. A spectator never takes a seat, so they can join a
   full room and any number of them may watch at once.
*/
export async function joinRoom (roomId, { memberId = null, role = 'guest', name = null } = {}) {
   const store = getStore()
   const id = normalizeRoomId(roomId)

   const room = await getRoom(id)
   if (!room) return { error: `room ${id} not found`, status: 404 }

   const existing = memberId ? room.members.find((m) => m.id === memberId) : null
   if (existing) {
      await addMember(id, memberId, existing.role, name ?? existing.name)
      return { roomId: id, memberId, role: existing.role, room: await getRoom(id) }
   }

   let assigned

   if (role === 'spectator') {
      assigned = 'spectator'
   } else {
      const players = room.members.filter((m) => PLAYER_ROLES.includes(m.role))
      if (players.length >= 2) {
         return { error: `room ${id} is full - only spectating is available`, status: 409, locked: true }
      }
      assigned = players.length === 0 ? 'host' : 'guest'
   }

   const newId = newMemberId()
   await addMember(id, newId, assigned, name)

   /*
      Re-read after adding the caller so `room.members` includes them; the route
      builds the `players` list from it and a joiner must see themselves seated.
   */
   return { roomId: id, memberId: newId, role: assigned, room: await getRoom(id) }
}

export async function roomExists (roomId) {
   const store = getStore()
   return Boolean(await store.getMeta(normalizeRoomId(roomId)))
}

/*
   Append one event. The sequence number comes from an atomic INCR, so two
   simultaneous sends get distinct numbers instead of overwriting each other.
*/
export async function appendEvent (roomId, name, data, { from = null } = {}) {
   const store = getStore()
   const id = normalizeRoomId(roomId)

   if (!(await store.getMeta(id))) return null

   const seq = await store.nextSeq(id)
   const event = { seq, ts: Date.now(), name, from, data: data ?? {} }
   await store.pushEvent(id, event)
   return event
}

export async function addMember (roomId, memberId, role, name = null) {
   const store = getStore()
   const id = normalizeRoomId(roomId)
   await store.setMember(id, memberId, { role, name: cleanName(name), lastSeen: Date.now() })
}

export async function touchMember (roomId, memberId) {
   if (!memberId) return
   const store = getStore()
   const id = normalizeRoomId(roomId)

   const member = await store.getMember(id, memberId)
   if (!member) return
   await store.setMember(id, memberId, { ...member, lastSeen: Date.now() })
}

export async function removeMember (roomId, memberId) {
   if (!memberId) return 0
   const store = getStore()
   const id = normalizeRoomId(roomId)

   await store.delMember(id, memberId)
   const members = await store.listMembers(id)
   if (!members.length) {
      await store.delRoom(id)
      return 0
   }
   return members.length
}
