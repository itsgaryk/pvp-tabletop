import adapter from '@sveltejs/adapter-static'
import 'dotenv/config'

/** @type {import('@sveltejs/kit').Config} */
const config = {
   kit: {
      adapter: adapter({
         pages: process.env.BUILD_DIR || 'build'
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
