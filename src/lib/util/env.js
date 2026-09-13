/*
   Build-time configuration.

   SvelteKit (`adapter-static`) ships a static bundle, so every value below is
   inlined by Vite while building. That means these variables must exist in the
   environment that runs `npm run build` (locally via `.env`, or in the Vercel
   project's Environment Variables) and that changing one requires a rebuild.

   Fallbacks are provided so a deployment works out of the box without any
   environment variables being configured. The fallbacks point at the public
   demo game server / card API that the project already uses for development.
*/

const DEFAULT_PVP_SERVER = 'https://pvp-tabletop-27e7a.ondigitalocean.app'
const DEFAULT_LIMITLESS_WEB = 'https://limitlesstcg.com'

/* the socket.io server that relays actions between the two players */
export const PVP_SERVER = import.meta.env.VITE_PVP_SERVER || DEFAULT_PVP_SERVER

/* the Limitless TCG API used to import decklists */
export const LIMITLESS_WEB = import.meta.env.VITE_LIMITLESS_WEB || DEFAULT_LIMITLESS_WEB

/* 'dev' enables extra console logging for shared socket events */
export const APP_ENV = import.meta.env.VITE_ENV || 'prod'

/* true when the deployment was explicitly given its own game server */
export const HAS_CUSTOM_SERVER = Boolean(import.meta.env.VITE_PVP_SERVER)

if (!HAS_CUSTOM_SERVER) {
   console.warn(
      `[pvp-tabletop] VITE_PVP_SERVER is not set, falling back to the public demo server ` +
      `(${DEFAULT_PVP_SERVER}). Set VITE_PVP_SERVER to use your own server.`
   )
}
