/*
   Room storage for the in-project relay.

   Keys (all namespaced under the room):

      pvp:room:<id>:meta      JSON { id, createdAt, lastActionAt, idlePromptedAt, epoch }
      pvp:room:<id>:seq       integer                     last event number
      pvp:room:<id>:events    list of JSON events, newest first
      pvp:room:<id>:members   hash: memberId -> JSON { role, name, lastSeen }
      pvp:room:<id>:closed    why a room that has just gone, went (2 min TTL)

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

/*
   How long the note of why a room closed outlives the room itself. Long enough
   for every member's in-flight poll to come back and find it, short enough that
   a closed room leaves nothing meaningful behind.
*/
export const CLOSED_TTL_S = 120

/*
   Which deployment a room belongs to.

   A room is a live game, and the code that plays it is the code that was
   deployed when it was created. After a deploy that code is gone - a room
   replayed into a new build can be rendered by handlers the events were never
   written for - so rooms are stamped with the deployment that made them and any
   read that finds a different stamp treats the room as finished. That is what
   stops a restart from handing a stale room to a new build.

   The stamp has to be identical for every instance of one deployment, and
   different for the next. On Vercel the commit SHA is exactly that. In
   development there is no deploy, so it is a random value per server boot: a
   restart of `vite dev` is the local equivalent of a deploy, and restarting is
   how you would expect a stale room to go.

   Note this means an in-flight game does not survive a deploy. That is the
   intended trade (see the README), and the members of those rooms are told the
   game closed rather than being left on a board nothing will update.
*/
function newEpoch () {
   if (process.env.VERCEL_GIT_COMMIT_SHA) return `sha:${process.env.VERCEL_GIT_COMMIT_SHA}`
   /* a fallback for a Vercel deploy without git metadata attached */
   if (process.env.VERCEL_DEPLOYMENT_ID) return `deploy:${process.env.VERCEL_DEPLOYMENT_ID}`
   return `boot:${crypto.randomUUID()}`
}

/* one per process, fixed at the first ask: every request in this instance agrees */
const globalEpochKey = Symbol.for('pvp-tabletop.relay.epoch')
export function roomEpoch () {
   return (globalThis[globalEpochKey] ||= newEpoch())
}

/*
   Presence lives in the members hash beside the members themselves, under a
   prefixed field name, so a poll's "still here" is one HSET and nothing else.
*/
/*
   Seats are decided by the order members come back in, so that order has to be
   the same every time. A Redis hash does not promise one - HGETALL is arbitrary -
   and two clients asking at different moments were told different things, which
   swapped the two halves of a spectator's board and cleared the mirrors as it
   did so. Host first, then guest, then spectators, and by id within a role.
*/
const ROLE_ORDER = { host: 0, guest: 1, spectator: 2 }

function bySeat (a, b) {
   const role = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
   return role || String(a.id).localeCompare(String(b.id))
}

const SEEN_PREFIX = 'seen:'
const seenField = (memberId) => SEEN_PREFIX + memberId

/* ------------------------------------------------------------------ memory -- */

function memoryStore () {
   const globalKey = Symbol.for('pvp-tabletop.relay.rooms2')
   const db = (globalThis[globalKey] ||= { meta: new Map(), seq: new Map(), events: new Map(), members: new Map(), seen: new Map(), closed: new Map() })

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
      /*
         Why a room that has just gone, went. Kept for a couple of minutes under
         its own key (see the redis store) so a member's next poll can tell "a
         player left, so the game is over" from "the 6h TTL collected it".
      */
      async setClosed (id, reason) {
         db.closed.set(id, String(reason || 'closed'))
      },
      async getClosed (id) {
         return db.closed.get(id) || null
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
      async ping () {
         return 'OK'
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
         db.seen.delete(mkey(id, mid))
      },
      /* presence is its own mark, so refreshing it never rewrites the member */
      async touchMember (id, mid, at) {
         db.seen.set(mkey(id, mid), at)
      },
      async listMembers (id) {
         const out = []
         for (const [key, member] of db.members) {
            if (key.startsWith(id + '|')) {
               out.push({ id: key.slice(id.length + 1), ...member, lastSeen: Math.max(member.lastSeen || 0, db.seen.get(key) || 0) })
            }
         }

         return out.sort(bySeat)
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
      members: (id) => `pvp:room:${id}:members`,
      closed: (id) => `pvp:room:${id}:closed`
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
      /*
         A short-lived note of why the room went, written just before it is
         deleted. One command, on a path that already spends several, and it
         expires by itself - so a member whose next poll finds the room missing
         learns whether a player closed it (the game is over) or the 6h TTL
         collected it (nobody was there).
      */
      async setClosed (id, reason) {
         await command('SET', k.closed(id), String(reason || 'closed'), 'EX', String(CLOSED_TTL_S))
      },
      async getClosed (id) {
         return command('GET', k.closed(id))
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
      /*
         A write, deliberately: a database that has run out of quota answers
         reads and refuses writes, so a read-only probe would call it healthy
         while every room action failed. The key expires by itself.
      */
      async ping () {
         return command('SET', 'pvp:health', String(Date.now()), 'EX', '60')
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
         await command('HDEL', k.members(id), mid, seenField(mid))
      },
      /*
         One command, not three. Presence changes on every poll of every client,
         so it is kept as its own field rather than read-modify-writing the whole
         member record: touching it is a single HSET, and two clients touching at
         once cannot lose each other's role or name.
      */
      async touchMember (id, mid, at) {
         await command('HSET', k.members(id), seenField(mid), String(at))
      },
      async listMembers (id) {
         const flat = await command('HGETALL', k.members(id))
         if (!flat || !flat.length) return []

         const members = []
         const seen = new Map()
         for (let i = 0; i < flat.length; i += 2) {
            const field = flat[i]
            if (field.startsWith(SEEN_PREFIX)) {
               seen.set(field.slice(SEEN_PREFIX.length), Number(flat[i + 1]) || 0)
               continue
            }
            members.push({ id: field, ...(flat[i + 1] ? JSON.parse(flat[i + 1]) : {}) })
         }

         for (const member of members) {
            member.lastSeen = Math.max(member.lastSeen || 0, seen.get(member.id) || 0)
         }

         return members.sort(bySeat)
      }
   }
}

/* ------------------------------------------------------------------ factory -- */

/*
   Vercel's Redis/KV integrations inject different names depending on which one
   you install - and a marketplace integration installed with a "custom prefix"
   renames both variables to <prefix>_URL and <prefix>_TOKEN. So: try the well
   known spellings first, then look for a pair by shape, which means any prefix
   works without the app having to know it.
*/
const KNOWN_REDIS_NAMES = [
   ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
   ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
   ['REDIS_REST_API_URL', 'REDIS_REST_API_TOKEN'],
   ['REDIS_REST_URL', 'REDIS_REST_TOKEN'],
   ['UPSTASH_REDIS_URL', 'UPSTASH_REDIS_TOKEN']
]

/* a credential pair is only ever a private URL with its token beside it */
function looksLikeRedisUrl (value) {
   return /^https?:\/\/\S+$/i.test(String(value || '').trim())
}

function findRedisConfig () {
   for (const [urlName, tokenName] of KNOWN_REDIS_NAMES) {
      const url = process.env[urlName]
      const token = process.env[tokenName]
      if (looksLikeRedisUrl(url) && token) return { url: url.trim(), token, source: urlName }
   }

   /*
      Nothing familiar: look for any <name>_URL with a matching <name>_TOKEN.
      Names mentioning redis/rest/kv are preferred, a public URL is never a
      credential, and the pair has to be complete.
   */
   const candidates = Object.keys(process.env)
      .filter((name) => /_URL$/i.test(name) && !/PUBLIC/i.test(name))
      .filter((name) => looksLikeRedisUrl(process.env[name]) && process.env[name.replace(/_URL$/i, '_TOKEN')])
      .sort((a, b) => {
         const score = (name) => (/REDIS|UPSTASH|KV|REST/i.test(name) ? 0 : 1)
         return score(a) - score(b) || a.localeCompare(b)
      })

   if (candidates.length) {
      const urlName = candidates[0]
      return { url: process.env[urlName].trim(), token: process.env[urlName.replace(/_URL$/i, '_TOKEN')], source: urlName }
   }

   return null
}

let cached = null
let cachedSource = null

export function getStoreSource () {
   getStore()
   return cachedSource
}

/*
   Is the store not just configured but working? Whether it is depends on what it
   does, not on the environment variables: a database that is over its quota,
   paused or deleted still looks configured from the outside, and one that is
   over its quota may well answer reads while refusing writes. So this writes a
   key that expires by itself - one command, no cleanup, and the same kind of
   operation every room action needs.
*/
export async function pingStore () {
   const store = getStore()
   await store.ping()
   return true
}

export function getStore () {
   if (cached) return cached

   const config = findRedisConfig()
   if (config) {
      cached = redisRestStore(config.url, config.token)
      cachedSource = config.source
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
      const now = Date.now()
      /*
         `lastActionAt` starts at creation: a room nobody has done anything in
         is idle from the moment it exists, which is what the idle prompt wants
         to be true. `idlePromptedAt` is 0 - nothing asked yet. `epoch` is the
         deployment that made it, and is what makes a restart close it.
      */
      const meta = { id, createdAt: now, lastActionAt: now, idlePromptedAt: 0, epoch: roomEpoch() }
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

   /*
      A room from another deployment is not this deployment's room. Read every
      time, because this is the one funnel every route already goes through -
      join, poll, summary, append - so nothing has to remember to check.

      The delete is a courtesy rather than the mechanism: the room was already
      unreachable to this build, and the tombstone says why so a member's next
      poll can say something better than "gone". If two requests arrive together
      both will try, and the second is a no-op.
   */
   if (meta.epoch !== roomEpoch()) {
      await closeRoom(id, 'restart')
      return null
   }

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

export const isPlayer = (member) => Boolean(member) && PLAYER_ROLES.includes(member.role)

export const playersOf = (members) => (members || []).filter(isPlayer)

export const spectatorsOf = (members) => (members || []).filter((m) => m.role === 'spectator')

/*
   A room is a game, and a game needs at least one player in it. Spectators are
   watchers: they may outnumber the players, but they must never be the reason a
   room is still open, or a single watcher who never closes their tab holds a dead
   game (and its keys) until the 6h TTL notices.
*/
export const roomIsAlive = (members) => playersOf(members).length > 0

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

   `meta` is the room's metadata when the caller already read it. Passing it in
   is what lets the activity stamp below ride in the same write the event
   already costs: without it, one read and one write per event would be spent
   only to say "something happened just now", on the hottest path in the relay.
   Callers that have not read the room (the relay's own idle prompt) leave it
   out and pay for the read.

   The event log is also the record of when the room last saw activity, but not
   the thing we can ask: reading the newest event costs the same LRANGE that
   fetch already does, while meta.lastActionAt is a field of a key this function
   must touch anyway.
*/
export async function appendEvent (roomId, name, data, { from = null, meta = null } = {}) {
   const store = getStore()
   const id = normalizeRoomId(roomId)
   const now = Date.now()

   const room = meta || await store.getMeta(id)
   if (!room) return null

   const seq = await store.nextSeq(id)
   const event = { seq, ts: now, name, from, data: data ?? {} }
   await store.pushEvent(id, event)

   await saveMeta(id, room, { lastActionAt: now })
   return event
}

/*
   Write a room's metadata back with `patch` merged in - one SET, which carries
   its own TTL, so the room's expiry follows its metadata as it did before.
   Used by the event path (activity) and by the idle prompt (asked-at, cleared).
*/
export async function saveMeta (roomId, meta, patch = {}) {
   const store = getStore()
   const id = normalizeRoomId(roomId)
   const next = { ...meta, ...patch }
   delete next.events
   delete next.members

   await store.setMeta(id, next)
   return next
}

/* when the room last saw a real action, as opposed to somebody sitting there */
export const lastActionAt = (room) => Number(room?.lastActionAt || room?.createdAt || 0)

/*
   Raise (or clear, with 0) the mark saying an idle prompt is outstanding, and
   answer with the moment it now reads.

   Read-modify-write is right here, unlike on the event path: this runs at most
   once per idle window. The room's own `idlePrompt` event carries the same
   instant, so the marker and the event agree on the clock a late joiner counts
   down from.

   If a prompt is already marked, this does nothing and answers with the mark
   that is there - so two polls arriving together produce one prompt rather than
   resetting each other's countdown.
*/
export async function setIdlePrompted (roomId, at = 0) {
   const store = getStore()
   const id = normalizeRoomId(roomId)
   const meta = await store.getMeta(id)
   if (!meta) return null

   const existing = Number(meta.idlePromptedAt || 0)
   if (at !== 0 && existing) return existing

   const next = Number(at) || 0
   await saveMeta(id, meta, { idlePromptedAt: next })
   return next
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

   await store.touchMember(id, memberId, Date.now())
}

/*
   Take one member out of a room and say what is left, without deciding anything
   yet: the caller is what knows whether this was a leave (close the room) or a
   stale presence being swept (close it only if no player is left).
*/
export async function removeMember (roomId, memberId) {
   if (!memberId) return { removed: false, members: [], players: [] }
   const store = getStore()
   const id = normalizeRoomId(roomId)

   await store.delMember(id, memberId)
   const members = await store.listMembers(id)

   return { removed: true, members, players: playersOf(members) }
}

/*
   Close a room on purpose, and leave a note saying why.

   The note is what lets a member's next poll tell a game that ended from a room
   the 6h TTL quietly collected - the two look identical from a key that has
   simply stopped existing, and only one of them is worth saying something about.

   `reason` is for the relay's own record; the poll translates it for clients
   into a single 'closed', because every one of these - a player leaving, a
   restart, an idle prompt nobody answered - means the same thing to the people
   in the room: the game is over and they are in the lobby.
*/
export async function closeRoom (roomId, reason = 'closed') {
   const store = getStore()
   const id = normalizeRoomId(roomId)

   try {
      await store.setClosed(id, reason)
   } catch (err) {
      /*
         The note is a courtesy. A room that cannot be annotated still has to be
         deleted, or a restart would leave every stale room in place.
      */
      console.error('[relay] could not record why a room closed', err)
   }

   await store.delRoom(id)
   return { closed: true, reason }
}

/*
   Why a room that is not there any more is not there, as the poll reports it.
   Read only when a room is already missing, so it costs nothing on any path
   where the room exists.
*/
export async function closedReason (roomId) {
   const store = getStore()
   const stored = await store.getClosed(normalizeRoomId(roomId))

   /* 'idle' has its own meaning on screen; everything else is a game that ended */
   return stored === 'idle' ? 'idle' : stored ? 'closed' : 'expired'
}
