import adapter from '@sveltejs/adapter-vercel'
import 'dotenv/config'

/** @type {import('@sveltejs/kit').Config} */
const config = {
   kit: {
      adapter: adapter({
         /*
            adapter-vercel only auto-detects Node 16/18/20 and this project is
            built on newer Node locally, so pin the runtime explicitly.

            maxDuration has to clear the relay's long-poll window
            (RELAY_POLL_WAIT_MS, 20s by default) or idle polls would be killed
            mid-flight. Hobby allows up to 300s.
         */
         runtime: 'nodejs20.x',
         maxDuration: 60
      })
   },
   onwarn (warning, handler) {
      /*
         The board is a mouse-driven tabletop: cards, piles and the hand are
         plain elements with click/drag handlers, which trips the a11y warnings
         on every build. They are expected here, so keep the build log readable
         and only surface everything else.
      */
      if (warning.code.startsWith('a11y')) return

      handler(warning)
   }
}

export default config
