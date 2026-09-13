import { json } from '@sveltejs/kit'
import { getStore } from '$lib/relay/store.js'

/*
   Health probe. The client uses this to tell "the relay is broken" apart from
   "you are not in a room yet", so it deliberately touches no room.
*/

/** @type {import('./$types').RequestHandler} */
export async function GET () {
   try {
      const store = getStore()
      return json({ ok: true, relay: true, store: store.kind })
   } catch (err) {
      return json(
         {
            ok: false,
            relay: false,
            error: err.message,
            hint: 'Add a Redis/KV integration in the Vercel dashboard, then redeploy.'
         },
         { status: 503 }
      )
   }
}
