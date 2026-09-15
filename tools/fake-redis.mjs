/*
 * A stand-in for Upstash's Redis REST API that counts what the relay asks of it.
 *
 * The relay talks to Redis over Upstash's REST protocol, which bills per
 * command. Point the app at this instead and you can watch the cost of a board
 * sitting still, without touching a real database:
 *
 *   node tools/fake-redis.mjs                       # terminal 1
 *   KV_REST_API_URL=http://127.0.0.1:6390 \
 *   KV_REST_API_TOKEN=local npm run dev             # terminal 2
 *
 * Then:  curl localhost:6390/__stats    -> { commands, byName }
 *        curl localhost:6390/__keys     -> what keys are held
 *        curl localhost:6390/__reset    -> zero the counters
 *
 * Only the commands the relay actually uses are implemented; anything else
 * answers null, which is enough to notice a call that should not be there
 * (KEYS, for instance - a healthy relay never runs it).
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_REDIS_PORT || 6390)

const strings = new Map()
const hashes = new Map()
const lists = new Map()

let stats = { commands: 0, byName: {} }

const listOf = (key) => {
   if (!lists.has(key)) lists.set(key, [])
   return lists.get(key)
}

const hashOf = (key) => {
   if (!hashes.has(key)) hashes.set(key, new Map())
   return hashes.get(key)
}

function run (args) {
   const name = String(args[0]).toUpperCase()
   stats.commands++
   stats.byName[name] = (stats.byName[name] || 0) + 1

   const [, key, ...rest] = args

   switch (name) {
      case 'GET':
         return strings.has(key) ? strings.get(key) : null

      case 'SET': {
         const flags = rest.map((a) => String(a).toUpperCase())
         if (flags.includes('NX') && strings.has(key)) return null
         strings.set(key, rest[0])
         return 'OK'
      }

      case 'DEL': {
         let removed = 0
         for (const k of [key, ...rest]) {
            if (strings.delete(k)) removed++
            if (hashes.delete(k)) removed++
            if (lists.delete(k)) removed++
         }
         return removed
      }

      case 'INCR': {
         const next = Number(strings.get(key) || 0) + 1
         strings.set(key, String(next))
         return next
      }

      case 'EXPIRE':
         return 1

      case 'LPUSH': {
         const l = listOf(key)
         l.unshift(rest[0])
         return l.length
      }

      case 'LTRIM': {
         const l = listOf(key)
         const [start, stop] = rest.map(Number)
         lists.set(key, l.slice(start, stop + 1))
         return 'OK'
      }

      case 'LRANGE': {
         const l = listOf(key)
         const [start, stop] = rest.map(Number)
         return l.slice(start, stop === -1 ? undefined : stop + 1)
      }

      case 'HSET': {
         const h = hashOf(key)
         for (let i = 0; i < rest.length; i += 2) h.set(rest[i], rest[i + 1])
         return 1
      }

      case 'HGET': {
         const h = hashOf(key)
         return h.has(rest[0]) ? h.get(rest[0]) : null
      }

      case 'HDEL': {
         const h = hashOf(key)
         return h.delete(rest[0]) ? 1 : 0
      }

      case 'HGETALL':
         return [...hashOf(key).entries()].flat()

      /* nothing should call this any more; implemented so a stray call shows up */
      case 'KEYS': {
         const prefix = String(key).replace(/\*$/, '')
         const all = [...strings.keys(), ...hashes.keys(), ...lists.keys()]
         return all.filter((k) => k.startsWith(prefix))
      }

      default:
         return null
   }
}

createServer((req, res) => {
   const send = (value) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
   }

   if (req.url.startsWith('/__stats')) return send(stats)
   if (req.url.startsWith('/__keys')) {
      return send({ strings: [...strings.keys()], hashes: [...hashes.keys()], lists: [...lists.keys()] })
   }
   if (req.url.startsWith('/__reset')) {
      stats = { commands: 0, byName: {} }
      return send(stats)
   }

   let raw = ''
   req.on('data', (chunk) => { raw += chunk })
   req.on('end', () => {
      let commands
      try {
         commands = JSON.parse(raw || '[]')
      } catch {
         res.writeHead(400)
         return res.end('expected a JSON command array')
      }

      if (req.url.startsWith('/pipeline')) {
         return send(commands.map((args) => ({ result: run(args) })))
      }
      send({ result: run(commands) })
   })
}).listen(PORT, '127.0.0.1', () => {
   console.log(`fake redis (command counter) on http://127.0.0.1:${PORT}`)
   console.log('  /__stats  /__keys  /__reset')
})
