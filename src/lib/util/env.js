/*
   Build-time configuration.

   SvelteKit inlines these values while building, so they have to be present in
   the environment that runs `npm run build` (a local `.env`, or the Vercel
   project's Environment Variables). Changing one needs a rebuild/redeploy.

   Both values have working defaults: the relay now ships inside this project,
   so a fresh deploy needs no configuration at all.
*/

const DEFAULT_LIMITLESS_WEB = 'https://limitlesstcg.com'

/*
   Base URL for the game relay.
   - unset (recommended): the relay served by this same project, under
     /api/relay. Works locally and on Vercel with no configuration.
   - an absolute URL: serve the relay from somewhere else. The same three
     routes must exist there (/api/relay/room, /events, /poll) - this is *not*
     a socket.io client, so a socket.io server will not satisfy it.
*/
export const PVP_SERVER = import.meta.env.VITE_PVP_SERVER || ''

/* true when the relay is being served from a different origin */
export const HAS_EXTERNAL_SERVER = Boolean(import.meta.env.VITE_PVP_SERVER)

/* the Limitless TCG API used to import decklists */
export const LIMITLESS_WEB = import.meta.env.VITE_LIMITLESS_WEB || DEFAULT_LIMITLESS_WEB

/* 'dev' logs every shared event to the console; local builds default to it */
export const APP_ENV = import.meta.env.VITE_ENV || (import.meta.env.DEV ? 'dev' : 'prod')
