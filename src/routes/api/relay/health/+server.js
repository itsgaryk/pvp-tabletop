import { json } from '@sveltejs/kit'
import { getStore, getStoreSource, pingStore, roomEpoch } from '$lib/relay/store.js'
import { WAIT_MS, POLL_INTERVAL_MS } from '$lib/relay/config.js'
import { RELAY_IDLE_MS, RELAY_PROMPT_MS, RELAY_MEMBER_STALE_MS } from '$lib/relay/timing.js'

/*
   Health probe. The client uses this to tell "the relay is broken" apart from
   "you are not in a room yet", so it deliberately touches no room and, by
   default, makes no store command at all: nobody should spend a command just by
   looking at the lobby. It reports which environment variables the store came
   from and the timing this deployment runs with, and that is free.

   Add ?probe=1 to make it ask the store a question - a write of a key that
   expires by itself, because a database over its quota still answers reads and
   refuses writes, and a read-only probe would call it healthy while every room
   action failed. That is for setting up and troubleshooting an integration, not
   for page loads.
*/

const POLL_SETTINGS = { waitMs: WAIT_MS, intervalMs: POLL_INTERVAL_MS }

/*
   When an idle room is prompted, and when the prompt gives up. Reported for the
   same reason the poll settings are: they decide behaviour a test or a
   troubleshooting session needs to know, and they are environment variables, so
   reading them from outside is the only way to see what a deployment really runs
   with. They are not secrets.
*/
const IDLE_SETTINGS = {
   idleMs: RELAY_IDLE_MS,
   promptMs: RELAY_PROMPT_MS,
   memberStaleMs: RELAY_MEMBER_STALE_MS
}

/*
   Which deployment this is, as the relay stamps it on rooms. Reported because it
   is otherwise invisible, and it is the thing to check when asking "did this
   restart really close the old rooms?": two health reads that name the same
   epoch are the same deployment, and a room made under a different one is closed
   the next time anybody reads it.
*/
const EPOCH = roomEpoch()

/** @type {import('./$types').RequestHandler} */
export async function GET ({ url }) {
   const probe = url.searchParams.get('probe') === '1'

   let store
   let from
   try {
      store = getStore()
      from = getStoreSource() || 'memory'
   } catch (err) {
      return json(
         {
            ok: false,
            relay: false,
            store: 'none',
            checked: false,
            epoch: EPOCH,
            poll: POLL_SETTINGS,
            idle: IDLE_SETTINGS,
            error: err.message,
            hint: 'Add a Redis/KV integration in the Vercel dashboard, then redeploy.'
         },
         { status: 503 }
      )
   }

   if (!probe) {
      return json({ ok: true, relay: true, store: store.kind, from, checked: false, epoch: EPOCH, poll: POLL_SETTINGS, idle: IDLE_SETTINGS })
   }

   try {
      await pingStore()
      return json({ ok: true, relay: true, store: store.kind, from, checked: true, epoch: EPOCH, poll: POLL_SETTINGS, idle: IDLE_SETTINGS })
   } catch (err) {
      return json(
         {
            ok: false,
            relay: false,
            store: store.kind,
            from,
            checked: true,
            epoch: EPOCH,
            poll: POLL_SETTINGS,
            idle: IDLE_SETTINGS,
            error: err.message,
            hint: 'The database is configured but not answering - check its quota and status in Vercel → Storage.'
         },
         { status: 503 }
      )
   }
}
