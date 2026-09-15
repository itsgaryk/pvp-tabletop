import { json } from '@sveltejs/kit'
import { getStore, getStoreSource, pingStore } from '$lib/relay/store.js'

/*
   Health probe. The client uses this to tell "the relay is broken" apart from
   "you are not in a room yet", so it deliberately touches no room.

   It does report which environment variables the store came from - setting up a
   Redis integration is mostly a question of whether the app found it, and the
   variable name is not a secret (the token is, and stays here) - and it asks the
   store one question to tell "configured" apart from "working", because a
   database that has run out of quota, been paused or been deleted still looks
   configured from the outside.
*/

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
            error: err.message,
            hint: 'Add a Redis/KV integration in the Vercel dashboard, then redeploy.'
         },
         { status: 503 }
      )
   }

   try {
      await pingStore()
      return json({ ok: true, relay: true, store: store.kind, from })
   } catch (err) {
      return json(
         {
            ok: false,
            relay: false,
            store: store.kind,
            from,
            error: err.message,
            hint: 'The database is configured but not answering - check its quota and status in Vercel → Storage.'
         },
         { status: 503 }
      )
   }
}
