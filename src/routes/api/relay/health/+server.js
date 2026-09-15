import { json } from '@sveltejs/kit'
import { getStore, getStoreSource } from '$lib/relay/store.js'

/*
   Health probe. The client uses this to tell "the relay is broken" apart from
   "you are not in a room yet", so it deliberately touches no room.

   It does report which environment variables the store came from: setting up a
   Redis integration is mostly a question of whether the app found it, and the
   variable name is not a secret (the token is, and stays here).
*/

/** @type {import('./$types').RequestHandler} */
export async function GET () {
   try {
      const store = getStore()
      return json({ ok: true, relay: true, store: store.kind, from: getStoreSource() || 'memory' })
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
