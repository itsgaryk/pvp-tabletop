import { json } from '@sveltejs/kit'
import { getStore, getStoreSource, pingStore } from '$lib/relay/store.js'
import { WAIT_MS, POLL_INTERVAL_MS } from '$lib/relay/config.js'

/*
   Health probe. The client uses this to tell "the relay is broken" apart from
   "you are not in a room yet", so it deliberately touches no room.

   It reports:
     - which environment variables the store came from (setting up a Redis
       integration is mostly a question of whether the app found it, and a
       variable name is not a secret - the token is, and stays here);
     - whether the store is not just configured but working, by making it write a
       key that expires by itself. A database over its quota still answers reads
       and refuses writes, so a read-only probe would call it healthy while every
       room action failed;
     - the timing a deployment is running with, because the poll interval is what
       the relay costs and an environment variable set in the dashboard is not
       otherwise visible from outside.
*/

const POLL_SETTINGS = { waitMs: WAIT_MS, intervalMs: POLL_INTERVAL_MS }

/** @type {import('./$types').RequestHandler} */
export async function GET () {
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
            poll: POLL_SETTINGS,
            error: err.message,
            hint: 'Add a Redis/KV integration in the Vercel dashboard, then redeploy.'
         },
         { status: 503 }
      )
   }

   try {
      await pingStore()
      return json({ ok: true, relay: true, store: store.kind, from, poll: POLL_SETTINGS })
   } catch (err) {
      return json(
         {
            ok: false,
            relay: false,
            store: store.kind,
            from,
            poll: POLL_SETTINGS,
            error: err.message,
            hint: 'The database is configured but not answering - check its quota and status in Vercel → Storage.'
         },
         { status: 503 }
      )
   }
}
