/*
   Build-time configuration.

   SvelteKit (`adapter-static`) ships a static bundle, so every value below is
   inlined by Vite while building. That means these variables must exist in the
   environment that runs `npm run build` (locally via `.env`, or in the Vercel
   project's Environment Variables) and that changing one requires a rebuild.

   Fallbacks are provided so a deployment always has a value to use without any
   environment variables being configured. The game-server fallback points at
   this app's own deployed origin, so it relays games once a socket.io server is
   hosted there; the card API falls back to the public Limitless TCG API that
   the project already uses for development.
*/

const DEFAULT_PVP_SERVER = 'https://pvp-tabletop.vercel.app'
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
      `[pvp-tabletop] VITE_PVP_SERVER is not set, falling back to ${DEFAULT_PVP_SERVER}. ` +
      `Rooms will only work if a socket.io relay server is hosted there - set ` +
      `VITE_PVP_SERVER to your own server otherwise.`
   )
}
