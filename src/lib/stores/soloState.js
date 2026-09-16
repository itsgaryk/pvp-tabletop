import { writable } from './custom/writable.js'

/*
   Whether the app is in solo mode. Its own module, with no imports of its own,
   so both the relay-facing stores and the board can ask without any chance of an
   import cycle - connection.js is imported by solo.js, so it must not import it
   back.
*/
export const solo = writable(false)
